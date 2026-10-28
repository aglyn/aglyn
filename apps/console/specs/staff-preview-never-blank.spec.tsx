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
 *
 * @jest-environment jsdom
 */

/**
 * The staff preview never paints a blank page while it reads the site
 * (AGL-4089). Before it mounts the preview, the route reads the site and its
 * organization for the site's own plugins. Those were plain `getDoc` reads,
 * and the route rendered `null` until they settled: while another tab held
 * the shared cache, that was a blank grey page for half a minute, and the
 * preview's own "Preparing the page preview…" spinner was never reached.
 *
 * Now the reads are bounded, and the wait is the preview's spinner.
 */

import { render, screen, waitFor } from '@testing-library/react'

const mockGetDocBounded = jest.fn()

jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ hostId: 'h1', kind: 'screen', docId: 's1' }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  // One instance, as the app's provider gives: a new one each render re-runs the read.
  const firestore = {}
  return { __esModule: true, useFirestore: () => firestore }
})

jest.mock('@aglyn/tenant-feature-instance/hooks/firebase/firestore-bounded-read', () => ({
  __esModule: true,
  getDocBounded: (...args: unknown[]) => mockGetDocBounded(...args),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: jest.fn((_firestore: unknown, ...path: string[]) => ({ path: path.join('/') })),
  // A plain read would hang here: the route must not make one.
  getDoc: jest.fn(() => new Promise(() => undefined)),
}))

jest.mock('../constants/app-setup', () => ({ __esModule: true }))

jest.mock('../constants/console-plugin-loader', () => ({
  __esModule: true,
  consolePluginLoader: { ensure: jest.fn(async () => undefined) },
}))

jest.mock('../components/document-preview.component', () => {
  const actualReact = jest.requireActual('react')
  return {
    __esModule: true,
    default: () => actualReact.createElement('div', { 'data-testid': 'preview' }, 'preview'),
    DocumentPreviewPreparing: ({ kind }: { kind?: string }) =>
      actualReact.createElement('div', { role: 'status' }, `preparing ${kind ?? 'screen'}`),
  }
})

import StaffSitePreviewPage from '../app/(editor)/admin/sites/[hostId]/preview/[kind]/[docId]/page'

const snapshot = (data: Record<string, unknown>) => ({
  snapshot: { get: (field: string) => data[field], data: () => data },
  stale: false,
})

describe('the staff preview while it reads the site (AGL-4089)', () => {
  afterEach(() => mockGetDocBounded.mockReset())

  it('shows the preview’s spinner, not a blank page, while the site read is pending', () => {
    mockGetDocBounded.mockReturnValue(new Promise(() => undefined))
    render(<StaffSitePreviewPage />)
    expect(screen.getByRole('status').textContent).toBe('preparing screen')
    expect(screen.queryByTestId('preview')).toBeNull()
  })

  it('reads the site and its organization bounded, then mounts the preview', async () => {
    mockGetDocBounded.mockImplementation(async (ref: { path: string }) =>
      ref.path === 'hosts/h1' ? snapshot({ orgId: 'o1' }) : snapshot({}),
    )
    render(<StaffSitePreviewPage />)
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy())
    expect(mockGetDocBounded.mock.calls.map(([ref]) => ref.path)).toEqual(['hosts/h1', 'orgs/o1'])
  })

  it('says it could not read the site when the bounded read gives up', async () => {
    mockGetDocBounded.mockRejectedValue(new Error('The server did not answer in time and nothing is cached for this read.'))
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<StaffSitePreviewPage />)
    await waitFor(() => expect(screen.getByText('Could not read this site to preview it.')).toBeTruthy())
  })
})
