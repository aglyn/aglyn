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
 * The workspace time zone — the one every site inherits unless it sets its
 * own — is edited on Settings → General, and saved by `set-time-zone`.
 *
 * It sat at the bottom of the Profile card, under the logo and contact
 * details, where an owner looking for "the org's time zone" on General did not
 * find it. Pinned by the REQUEST the card makes, not by its words: the zone
 * must reach the route under its own action, and a name-only save must not
 * post a zone at all.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** The org DOCUMENT, where `timeZone` lives. */
let mockOrgDoc: Record<string, unknown> = {}
let mockOrgReady = true
/** Every body handed to `/api/orgs/settings`, in order. */
let mockRequests: Array<Record<string, unknown>> = []

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/acme/settings/general',
  useParams: () => ({ orgSlug: 'acme' }),
}))

jest.mock('../hooks/use-org-scope', () => {
  const scope = {
    currentOrg: { $id: 'org-7', role: 'owner', orgName: 'Acme', slug: 'acme' },
  }
  return {
    __esModule: true,
    useOrgSlug: () => 'acme',
    useOrgScope: () => scope,
    default: () => scope,
  }
})

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrgDoc, orgId: 'org-7', ready: mockOrgReady }),
  useCurrentOrg: () => ({ org: mockOrgDoc, orgId: 'org-7', ready: mockOrgReady }),
}))

jest.mock('../hooks/use-org-settings-request', () => {
  const send = async (body: Record<string, unknown>) => {
    mockRequests.push(body)
    return { ok: true }
  }
  return {
    __esModule: true,
    default: () => send,
    useOrgSettingsRequest: () => send,
  }
})

import OrgGeneralCard from '../components/settings/org-general-card.component'

const chooseZone = (label: RegExp) => {
  fireEvent.mouseDown(screen.getByLabelText(/time zone/i))
  fireEvent.click(screen.getByRole('option', { name: label }))
}

beforeEach(() => {
  mockRequests = []
  mockOrgReady = true
  mockOrgDoc = { $id: 'org-7' }
})

describe('the workspace time zone on Settings → General', () => {
  it('shows the zone stored on the org document', () => {
    mockOrgDoc = { $id: 'org-7', timeZone: 'America/Chicago' }
    render(<OrgGeneralCard />)
    expect(screen.getByLabelText(/time zone/i).textContent).toMatch(
      /America\/Chicago/,
    )
  })

  it('an org that never set one reads UTC (default)', () => {
    render(<OrgGeneralCard />)
    expect(screen.getByLabelText(/time zone/i).textContent).toMatch(
      /UTC \(default\)/,
    )
  })

  it('saves a chosen zone by set-time-zone, and renames nothing', async () => {
    render(<OrgGeneralCard />)
    chooseZone(/^America\/Chicago$/)
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockRequests).toHaveLength(1))
    expect(mockRequests[0]).toEqual({
      action: 'set-time-zone',
      timeZone: 'America/Chicago',
    })
  })

  it('NEGATIVE CONTROL: a rename alone posts no zone', async () => {
    mockOrgDoc = { $id: 'org-7', timeZone: 'America/Chicago' }
    render(<OrgGeneralCard />)
    fireEvent.change(screen.getByLabelText(/organization name/i), {
      target: { value: 'Acme Two' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockRequests).toHaveLength(1))
    expect(mockRequests[0]).toEqual({ action: 'rename', name: 'Acme Two' })
  })

  /*
   * Empty is UTC, so a zone saved before the org document loads is a reset,
   * not a no-op. The field is locked until there is something loaded.
   */
  it('cannot be changed while the org document is still loading', () => {
    mockOrgReady = false
    render(<OrgGeneralCard />)
    expect(
      screen.getByLabelText(/time zone/i).getAttribute('aria-disabled'),
    ).toBe('true')
    expect(screen.getByRole('button', { name: /^save$/i })).toHaveProperty(
      'disabled',
      true,
    )
  })
})
