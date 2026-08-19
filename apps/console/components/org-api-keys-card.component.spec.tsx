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
 * AGL-1380: the API keys card makes two claims, and both used to be answered
 * before anything was asked.
 *
 * 1. **The plan.** `checkEntitlement(undefined)` answers "no" and `org` is
 *    undefined both in flight and on a failed read, so a Business org was
 *    told the REST API is something it should upgrade to buy.
 * 2. **The keys.** `refresh` did `if (payload?.keys) setKeys(payload.keys)`,
 *    so a failed list left `keys` at its initial `[]` — and `[]` renders as
 *    "No API keys yet.", a statement about what can currently authenticate
 *    against this org's data. Wrong in the direction that stops an admin
 *    going to revoke a key.
 *
 * The MIDDLE case carries each pair: the failed read, not the pending one and
 * not the genuinely-empty one.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Swapped per case; the card reads it through `useCurrentOrg`. */
const mockOrgState: { org: Record<string, unknown>; ready: boolean } = {
  org: { plan: 'business' },
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
  useConfirmationContext: () => ({ confirm: () => Promise.resolve() }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'admin-1', getIdToken: async () => 'tok' } }),
}))

// A closed world: this mock replaces the WHOLE module, so the card's new
// `buildDocsUrl` call threw "is not a function" until it was added (AGL-2186).
// The real implementation, not a stub — the card renders the returned string
// into an href, and a double that ignored configuration would let a hardcoded
// origin come back without any assertion here noticing.
jest.mock('../constants/docs-links', () => ({
  docsHelp: () => undefined,
  buildDocsUrl: (
    jest.requireActual('../constants/docs-links') as {
      buildDocsUrl: (path?: string) => string
    }
  ).buildDocsUrl,
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ ...mockOrgState, orgId: 'org-1' }),
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: 'org-1', role: 'admin' } }),
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', role: 'admin' } }),
}))

import { OrgApiKeysCard } from './org-api-keys-card.component'

/**
 * Hand-built rather than `new Response(...)`: this project's jsdom has a
 * `Response` that is not constructible, so the real thing throws inside the
 * fetch mock and every case lands in the failure branch it meant to avoid.
 */
const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

const UPGRADE_COPY = /The REST API and API keys are included on the/

beforeEach(() => {
  mockOrgState.org = { plan: 'business' }
  mockOrgState.ready = true
  mockEntitled = true
})

describe('OrgApiKeysCard plan claim (AGL-1380)', () => {
  it('does not tell an org to upgrade while the billing doc is loading', () => {
    // `ready: false` with `entitled: false` is exactly the pair an unresolved
    // org doc produces.
    mockOrgState.ready = false
    mockEntitled = false
    global.fetch = jest.fn(async () =>
      jsonResponse({ keys: [] }),
    ) as unknown as typeof fetch

    render(<OrgApiKeysCard />)

    expect(screen.getByText('Checking your plan…')).toBeTruthy()
    expect(screen.queryByText(UPGRADE_COPY)).toBeNull()
  })

  it('still shows the upsell to an org that genuinely lacks the plan', () => {
    // The claim is not banned, it is earned.
    mockEntitled = false
    global.fetch = jest.fn(async () =>
      jsonResponse({ keys: [] }),
    ) as unknown as typeof fetch

    render(<OrgApiKeysCard />)

    expect(screen.getByText(UPGRADE_COPY)).toBeTruthy()
    expect(screen.queryByText('Checking your plan…')).toBeNull()
  })
})

describe('OrgApiKeysCard key-list claims (AGL-1380)', () => {
  it('claims nothing while the list request is still in flight', async () => {
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<OrgApiKeysCard />)

    expect(await screen.findByText('Checking your API keys…')).toBeTruthy()
    expect(screen.queryByText('No API keys yet.')).toBeNull()
  })

  it('reports a failed list as a failure, not as "No API keys yet."', async () => {
    // THE MIDDLE CASE. `request` returns null on a non-ok response, `refresh`
    // left `keys` at `[]`, and `[]` is indistinguishable from an org that has
    // never minted a key.
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'API key request failed' }, 500),
    ) as unknown as typeof fetch

    render(<OrgApiKeysCard />)

    await screen.findByText(/We couldn.t load your API keys/)
    expect(screen.queryByText('No API keys yet.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('reports a rejected list request the same way', async () => {
    // The other half: a rejected fetch threw straight past the snackbar
    // inside `request`, so nothing caught it at all.
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    render(<OrgApiKeysCard />)

    await screen.findByText(/We couldn.t load your API keys/)
    expect(screen.queryByText('No API keys yet.')).toBeNull()
  })

  it('recovers through Retry once the list answers', async () => {
    let failNext = true
    global.fetch = jest.fn(async () => {
      if (failNext) {
        failNext = false
        return jsonResponse({ error: 'nope' }, 500)
      }
      return jsonResponse({
        keys: [
          { keyId: 'k1', name: 'CI', keyPrefix: 'agl_live_ab', scopes: [] },
        ],
      })
    }) as unknown as typeof fetch

    render(<OrgApiKeysCard />)
    await screen.findByText(/We couldn.t load your API keys/)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('CI')).toBeTruthy())
    expect(screen.queryByText(/We couldn.t load your API keys/)).toBeNull()
  })

  it('still says "No API keys yet." on a genuinely empty list', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ keys: [] }),
    ) as unknown as typeof fetch

    render(<OrgApiKeysCard />)

    expect(await screen.findByText('No API keys yet.')).toBeTruthy()
  })

  it('lists the keys a successful response carries', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        keys: [
          { keyId: 'k1', name: 'CI', keyPrefix: 'agl_live_ab', scopes: [] },
        ],
      }),
    ) as unknown as typeof fetch

    render(<OrgApiKeysCard />)

    expect(await screen.findByText('CI')).toBeTruthy()
    expect(screen.queryByText('No API keys yet.')).toBeNull()
  })
})
