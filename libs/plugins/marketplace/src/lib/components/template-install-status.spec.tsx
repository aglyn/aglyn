/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * "Update available" on a template this plugin installed (AGL-671, AGL-3080).
 *
 * The site's Templates library used to read this plugin's listings to say
 * so, and post to its install route to apply it. It hands each installed
 * row to the `templateInstallStatus` zone now, and this chip holds what the
 * library held:
 *
 *  - offered only when the listing publishes a NEWER version than the one
 *    installed, by the real comparison (`model/update-state`);
 *  - never for a template installed by something else, nor from a listing
 *    that is gone or unpublished;
 *  - an edited copy asks before an update replaces it (AGL-681), and a no
 *    posts nothing.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Listings by id; an id absent here reads as a missing document. */
let mockListings: Record<string, Record<string, unknown>> = {}
const mockFetch = jest.fn()
const mockSnack = jest.fn()
const mockConfirm = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  parseLockdownRefusal: () => null,
  lockdownRefusalText: () => '',
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1' } }),
  useFirestoreDoc: (factory: () => { path: string } | null) => {
    const ref = factory()
    return { data: ref ? mockListings[ref.path.split('/').at(-1) ?? ''] : undefined }
  },
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnack }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { TEMPLATE_SOURCE_TYPE } from '../constants/template-source'
import { TemplateInstallStatus } from './template-install-status.component'

const installed = (extra: Record<string, unknown> = {}) => ({
  $id: 'tpl-1',
  displayName: 'Bakery home',
  source: { type: TEMPLATE_SOURCE_TYPE, listingId: 'listing-1', version: 2 },
  ...extra,
})

const draw = (template: Record<string, unknown>) =>
  render(<TemplateInstallStatus hostId="host-1" template={template} />)

beforeEach(() => {
  mockFetch.mockReset()
  mockSnack.mockReset()
  mockConfirm.mockReset()
  mockListings = { 'listing-1': { latestVersion: 3 } }
})

describe('the update chip on an installed template', () => {
  it('offers a newer published version', () => {
    draw(installed())
    expect(screen.getByText('Update available')).toBeTruthy()
  })

  it('says nothing when the copy is current, or ahead', () => {
    mockListings['listing-1'] = { latestVersion: 2 }
    expect(draw(installed()).container.textContent).toBe('')
    mockListings['listing-1'] = { latestVersion: 1 }
    expect(draw(installed()).container.textContent).toBe('')
  })

  it('says nothing for a listing that is gone or unpublished', () => {
    mockListings = {}
    expect(draw(installed()).container.textContent).toBe('')
    mockListings = { 'listing-1': { latestVersion: 3, deletedAt: 1 } }
    expect(draw(installed()).container.textContent).toBe('')
  })

  it('says nothing for a template something else installed', () => {
    const other = installed({ source: { type: 'elsewhere', listingId: 'listing-1', version: 2 } })
    expect(draw(other).container.textContent).toBe('')
  })

  it('re-installs through its own route', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: 3 }) })
    draw(installed())
    fireEvent.click(screen.getByText('Update available'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/marketplace/install-template')
    expect(JSON.parse(init.body)).toEqual({ listingId: 'listing-1', hostId: 'host-1' })
    expect(mockConfirm).not.toHaveBeenCalled()
    await waitFor(() => expect(mockSnack.mock.calls[0]?.[0]).toContain('Updated to v3'))
  })

  it('asks before replacing an edited copy, and a no posts nothing', async () => {
    mockConfirm.mockRejectedValue(new Error('cancelled'))
    draw(installed({ editedAt: 1 }))
    fireEvent.click(screen.getByText('Update available'))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
