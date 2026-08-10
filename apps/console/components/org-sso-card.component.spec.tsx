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
 * AGL-1376: what the card is allowed to SAY about an org's SSO.
 *
 * "Not set up" is a statement about an organization's security posture, and
 * the card used to make it whenever `sso` was empty — which is also its value
 * before the status request has answered, and after the request has failed.
 * So every case here fixes the transport and asserts the CLAIM, not the
 * spinner: the point is not that a loading state exists, it is that no wrong
 * status is asserted while one does.
 *
 * Each negative assertion is paired with a positive one. "Not set up is
 * absent" passes just as well on a card that rendered nothing at all, which
 * would be a different bug with the same test result.
 */

import { render, screen } from '@testing-library/react'

/** Swapped per case; the card reads it through `useCurrentOrg`. */
const mockOrgState: { org: Record<string, unknown>; ready: boolean } = {
  org: { plan: 'enterprise' },
  ready: true,
}
let mockEntitled = true

jest.mock('@aglyn/aglyn', () => ({
  canManageOrg: () => true,
  checkEntitlement: () => mockEntitled,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'admin-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ ...mockOrgState, orgId: 'org-1' }),
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: 'org-1', role: 'admin' } }),
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', role: 'admin' } }),
}))

import { OrgSsoCard } from './org-sso-card.component'

/** The three things the status chip can assert about a real org. */
const statusClaims = () => [
  screen.queryByText('Not set up'),
  screen.queryByText('On'),
  screen.queryByText('Off'),
]

/**
 * The two things `request` reads off a response. Hand-built rather than
 * `new Response(...)`: this project's jsdom environment has a `Response` that
 * is not constructible, so the real thing throws inside the fetch mock and
 * every case lands in the failure branch it was meant to distinguish from.
 */
const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

beforeEach(() => {
  mockOrgState.org = { plan: 'enterprise' }
  mockOrgState.ready = true
  mockEntitled = true
})

describe('OrgSsoCard status claims (AGL-1376)', () => {
  it('claims nothing while the status request is still in flight', async () => {
    // A request that never settles — the wedged-route case, which used to
    // render "Not set up" and wait there forever.
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<OrgSsoCard />)

    await screen.findByText('Checking…')
    expect(statusClaims()).toEqual([null, null, null])
  })

  it('reports a rejected status request as a failure, not as "Not set up"', async () => {
    // The regression guard. A rejected fetch throws straight past the
    // snackbar in `request`, so before the fix nothing caught it and the card
    // rendered the unconfigured copy over an org whose SSO was live.
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    render(<OrgSsoCard />)

    await screen.findByText(/We couldn.t load your single sign-on settings/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(statusClaims()).toEqual([null, null, null])
  })

  it('reports a failed status response as a failure, not as "Not set up"', async () => {
    // The other half of the same shape: the request resolves, but not ok, so
    // `request` returns null and `refresh` used to return early over an
    // untouched `sso = {}`.
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'Single sign-on update failed' }, 500),
    ) as unknown as typeof fetch

    render(<OrgSsoCard />)

    await screen.findByText(/We couldn.t load your single sign-on settings/)
    expect(statusClaims()).toEqual([null, null, null])
  })

  it('still says "Not set up" when the org genuinely has no config', async () => {
    // The claim is not banned, it is earned: a successful, empty answer is
    // exactly when the card SHOULD say it.
    global.fetch = jest.fn(async () =>
      jsonResponse({ ok: true, sso: {}, claims: [], metadata: null }),
    ) as unknown as typeof fetch

    render(<OrgSsoCard />)

    expect(await screen.findByText('Not set up')).toBeTruthy()
  })

  it('says "On" for a live org', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        ok: true,
        sso: { status: 'active', tenantId: 't-1', providerId: 'p-1' },
        claims: [],
        metadata: null,
      }),
    ) as unknown as typeof fetch

    render(<OrgSsoCard />)

    expect(await screen.findByText('On')).toBeTruthy()
    expect(screen.queryByText('Not set up')).toBeNull()
  })

  it('does not deny the feature while the billing doc is still loading', async () => {
    // `checkEntitlement(undefined)` answers "no", so an unready org doc used
    // to render the Enterprise upsell at an org already paying for SSO.
    mockOrgState.ready = false
    mockEntitled = false
    global.fetch = jest.fn(async () =>
      jsonResponse({ ok: true, sso: {}, claims: [], metadata: null }),
    ) as unknown as typeof fetch

    render(<OrgSsoCard />)

    await screen.findByText('Checking your plan…')
    expect(screen.queryByText('Single sign-on is part of Enterprise.')).toBeNull()
    expect(statusClaims()).toEqual([null, null, null])
  })
})
