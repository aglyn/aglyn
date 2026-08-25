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

import { fireEvent, render, screen } from '@testing-library/react'
import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'

/** Every `confirm()` the card opened, in order (AGL-1375). */
const mockConfirmCalls: Array<{ title?: string; description?: string }> = []

/**
 * Whether the mocked `confirm()` accepts (AGL-1888).
 *
 * Cancelling is the default because most cases here assert what the user was
 * TOLD without carrying out the destructive thing they were warned about. The
 * enforcement cases need the other half — the refusal only exists on the far
 * side of the confirmation.
 */
let mockConfirmOutcome: 'cancel' | 'accept' = 'cancel'

/** Swapped per case; the card reads it through `useCurrentOrg`. */
const mockOrgState: { org: Record<string, unknown>; ready: boolean } = {
  org: { plan: 'enterprise' },
  ready: true,
}
let mockEntitled = true

/**
 * `useBranding` (AGL-2319 gave this surface its brand-aware copy). Mocked
 * NARROWLY — the module's one default export and one named export — for the
 * reason `white-label-tab-title.spec.tsx` states: the real hook reaches
 * `use-secondary-nav`, which pulls in the console plugin gate, the Firebase
 * services provider and `next/navigation`, a module graph a card's unit test
 * has no business loading. The value is `PLATFORM_BRANDING_PROFILE` rebuilt
 * from its own two constants — literally what `resolveBrandingProfile` returns
 * for an org that is not white-label — and it is a module-level singleton, so
 * a consumer memoizing on the object cannot be made to loop (AGL-2365).
 */
const mockBranding = {
  branding: {
    productName: PLATFORM_BRAND_NAME,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    supportUrl: PLATFORM_SUPPORT_URL,
    fromName: PLATFORM_BRAND_NAME,
    emailLogoUrl: null,
    customConsoleDomain: null,
  },
  whiteLabel: false,
  ready: true,
}

jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

jest.mock('@aglyn/aglyn', () => ({
  canManageOrg: () => true,
  checkEntitlement: () => mockEntitled,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  useConfirmationContext: () => ({
    // Records the prompt and then CANCELS — `confirm()` rejects on cancel, so
    // rejecting lets a case assert what the user was told without carrying
    // out the destructive action it was warning about.
    confirm: (options: { title?: string; description?: string }) => {
      mockConfirmCalls.push(options)
      return mockConfirmOutcome === 'accept'
        ? Promise.resolve()
        : Promise.reject(new Error('cancelled'))
    },
  }),
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
  mockConfirmCalls.length = 0
  mockConfirmOutcome = 'cancel'
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

/**
 * AGL-1375: the card must not offer an action the server will refuse.
 *
 * `activate` publishes through `publishSsoDomains`, which re-reads each claim
 * document and skips anything without `verified === true`. A domain that is
 * only ATTESTED — governing sign-in today because a human wrote it onto the
 * org before self-serve existed — publishes nothing, and the route answers
 * 400. The card gated "Turn on" on the wider governed set, so for those orgs
 * the off switch worked and the on switch could not: a one-way door.
 *
 * These cases are about the GATE and the WARNING, which is all part 1 can fix
 * from the client. Restoring an attested org is part 2 and is asserted
 * server-side, where it is still red on purpose.
 */
const claim = (over: Partial<Record<string, unknown>> = {}) => ({
  domain: 'acme.com',
  verified: false,
  attested: false,
  /**
   * What the SERVER says it will publish (AGL-1887 part 2), defaulted the way
   * the server defaults it: a verified claim publishes.
   *
   * An attested fixture has to state this explicitly, because `attested: true`
   * covers TWO shapes that differ on exactly this field — a claim document
   * carrying `attestedBy` (publishable) and a bare `sso.domains` entry with no
   * claim document at all (not publishable). Collapsing them is the bug these
   * cases exist to keep out.
   */
  publishable: over['verified'] === true,
  recordHost: '_aglyn-challenge.acme.com',
  recordValue: 'aglyn-domain-verification=tok',
  lastRecords: null,
  ...over,
})

const statusPayload = (
  claims: unknown[],
  sso: Record<string, unknown> = {},
) => ({
  ok: true,
  sso: { tenantId: 't-1', providerId: 'p-1', domains: ['acme.com'], ...sso },
  claims,
  metadata: null,
})

const serve = (payload: unknown) => {
  global.fetch = jest.fn(async () =>
    jsonResponse(payload),
  ) as unknown as typeof fetch
}

const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement

describe('OrgSsoCard activation gate (AGL-1375)', () => {
  it('does not offer Turn on for a domain the server would refuse to publish', async () => {
    // `aglyn-org` exactly: live SSO, an empty `ssoDomains` subcollection, and
    // a domain that exists only in `sso.domains`.
    serve(
      statusPayload([claim({ attested: true })], { status: 'disabled' }),
    )

    render(<OrgSsoCard />)

    await screen.findByText('Off')
    expect(button('Turn on').disabled).toBe(true)
    expect(
      screen.getByText(/cannot be turned on until one of your domains/),
    ).toBeTruthy()
  })

  it('offers Turn on once a domain has DNS proof', async () => {
    // The paired positive: the gate has to still open, or "disabled" would
    // pass on a card that never enables the button at all.
    serve(statusPayload([claim({ verified: true })], { status: 'disabled' }))

    render(<OrgSsoCard />)

    await screen.findByText('Off')
    expect(button('Turn on').disabled).toBe(false)
  })

  it('warns that Turn off is one-way for an attested org', async () => {
    serve(statusPayload([claim({ attested: true })], { status: 'active' }))

    render(<OrgSsoCard />)

    await screen.findByText('On')
    // The alert is on screen before anyone reaches for the button.
    expect(screen.getByText(/Turning it off would be permanent for now/)).toBeTruthy()

    fireEvent.click(button('Turn off'))

    expect(mockConfirmCalls).toHaveLength(1)
    expect(mockConfirmCalls[0].title).toMatch(/not be able to turn it back on/)
    expect(mockConfirmCalls[0].description).toMatch(/cannot be undone here/)
    // The promise that turning it back on is free is precisely the claim that
    // does not hold for this org.
    expect(mockConfirmCalls[0].description).not.toMatch(/turn it back on without/)
  })

  it('keeps the reassuring Turn off copy for a verified org', async () => {
    // Because for a verified org it is true — publishing again republishes
    // the same routing doc from the same claim.
    serve(statusPayload([claim({ verified: true })], { status: 'active' }))

    render(<OrgSsoCard />)

    await screen.findByText('On')
    fireEvent.click(button('Turn off'))

    expect(mockConfirmCalls).toHaveLength(1)
    expect(mockConfirmCalls[0].title).toBe('Turn single sign-on off?')
    expect(mockConfirmCalls[0].description).toMatch(/turn it back on without/)
  })
})

/**
 * AGL-1887 part 2: the door has to open from HERE, or it is still a one-way door.
 *
 * Part 2 widened the server — `publishSsoDomains` now admits a staff-attested
 * claim as well as a DNS-verified one — and shipped without moving the card,
 * which was still gated on `verified` because that was the server's rule when
 * part 1 wrote it. The result: staff attest the domain, the server would
 * publish it, and the admin looks at a disabled "Turn on" and a warning saying
 * they cannot. The mechanism was reachable only by a route no customer has.
 *
 * The gate is now the server's own per-domain verdict, `publishable`. These
 * cases pin both sides of it, because widening the gate to `attested` — the
 * obvious-looking fix — would re-open part 1's bug for the orgs that have no
 * claim document, whom the server still refuses.
 */
describe('OrgSsoCard restores an attested org (AGL-1887)', () => {
  it('THE FIX: offers Turn on once staff have attested the domain', async () => {
    // A claim document carrying `attestedBy`: no DNS proof, and the server
    // publishes it anyway. Gating on `verified` reddens exactly this case.
    serve(
      statusPayload([claim({ attested: true, publishable: true })], {
        status: 'disabled',
      }),
    )

    render(<OrgSsoCard />)

    await screen.findByText('Off')
    expect(button('Turn on').disabled).toBe(false)
    // And the sentence telling them they cannot is gone with it. Leaving the
    // warning beside a working button is its own bug — the card would be
    // contradicting itself about whether the org is stranded.
    expect(screen.queryByText(/cannot be turned on until one of your domains/)).toBe(
      null,
    )
  })

  it('THE NEGATIVE: the same domain with no claim document is still refused', async () => {
    // `attested: true`, `publishable: false` — the pre-self-serve org nobody
    // has attested yet, surfaced from `sso.domains` with no claim behind it.
    // The server skips it (`!claim.exists`), so the card must keep refusing.
    // This is what stops the fix being "accept anything attested".
    serve(
      statusPayload([claim({ attested: true, publishable: false })], {
        status: 'disabled',
      }),
    )

    render(<OrgSsoCard />)

    await screen.findByText('Off')
    expect(button('Turn on').disabled).toBe(true)
    expect(
      screen.getByText(/cannot be turned on until one of your domains/),
    ).toBeTruthy()
  })

  it('stops threatening that Turn off is permanent once an attestation exists', async () => {
    // The copy is downstream of the same verdict, and it has to move with it.
    // Telling an org it can never turn SSO back on, while the button that does
    // so is enabled, is the AGL-1375 sentence inverted — false in the other
    // direction, and this time it scares them off an action that works.
    serve(
      statusPayload([claim({ attested: true, publishable: true })], {
        status: 'active',
      }),
    )

    render(<OrgSsoCard />)

    await screen.findByText('On')
    expect(screen.queryByText(/Turning it off would be permanent for now/)).toBe(null)

    fireEvent.click(button('Turn off'))

    expect(mockConfirmCalls).toHaveLength(1)
    expect(mockConfirmCalls[0].title).toBe('Turn single sign-on off?')
    expect(mockConfirmCalls[0].description).toMatch(/turn it back on without/)
  })
})

/**
 * AGL-1888 / AGL-1210: enforcement has to be REACHABLE from the console.
 *
 * `enforce-apply` re-plans the whole pool and refuses whenever no designated
 * account keeps a method other than the org's IdP — a refusal no amount of
 * clicking can clear, because the thing it asks for (`sso.breakGlassUids`)
 * had no control anywhere in the product. The route action existed, the
 * enforcement engine read it, the refusal named it, and an admin who reached
 * step 4 of a self-serve setup could only email us. A capability that exists
 * but cannot be reached from the console does not count.
 *
 * Each case pairs the refusal with the state that clears it: "disabled" on
 * its own passes just as well on a button that is never enabled.
 */
const account = (over: Partial<Record<string, unknown>> = {}) => ({
  uid: 'u-1',
  email: 'owner@acme.com',
  unlinked: ['password'],
  kept: ['saml.acme'],
  ...over,
})

/**
 * A fetch that answers per ACTION rather than returning one body for
 * everything: the enforcement flow is three different requests and a mock
 * that cannot tell them apart proves nothing about which one was refused.
 */
const serveByAction = (
  responses: Record<string, { body: unknown; status?: number }>,
) => {
  const calls: string[] = []
  global.fetch = jest.fn(async (_url: unknown, init: { body?: string } = {}) => {
    const action = String(JSON.parse(init.body ?? '{}').action ?? 'status')
    calls.push(action)
    const match = responses[action] ?? responses['status']
    return jsonResponse(match.body, match.status ?? 200)
  }) as unknown as typeof fetch
  return calls
}

const liveOrg = (sso: Record<string, unknown> = {}) => ({
  ok: true,
  sso: {
    tenantId: 't-1',
    providerId: 'saml.acme',
    status: 'active',
    domains: ['acme.com'],
    ...sso,
  },
  claims: [claim({ verified: true })],
  metadata: null,
})

describe('OrgSsoCard break-glass designation (AGL-1888)', () => {
  it('refuses to offer Enforce while nothing is designated, and says why', async () => {
    serveByAction({ status: { body: liveOrg() } })

    render(<OrgSsoCard />)

    await screen.findByText('On')
    expect(button('Enforce').disabled).toBe(true)
    // The requirement is on screen BEFORE the button is reached for — the
    // refusal used to be the first time anyone heard of it. It names BOTH
    // ways out, because for a pool we provisioned only one of them is
    // reachable (AGL-1888 option (a)).
    const requirement = screen.getByText(
      /needs one way in that survives your identity provider failing/i,
    )
    expect(requirement.textContent).toMatch(/owner who signs in outside/i)
    expect(requirement.textContent).toMatch(/break-glass account inside the pool/i)
  })

  it('offers Enforce once an account is designated', async () => {
    serveByAction({ status: { body: liveOrg({ breakGlassUids: ['u-1'] }) } })

    render(<OrgSsoCard />)

    await screen.findByText('On')
    expect(button('Enforce').disabled).toBe(false)
    expect(screen.getByText(/1 break-glass account\(s\) designated/)).toBeTruthy()
  })

  it('lets an account that holds a password be ticked, and refuses one that does not', async () => {
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': {
        body: {
          ok: true,
          preview: {
            scanned: 2,
            changed: 1,
            accounts: [
              account(),
              // Nothing but the SAML link: designating it would look like
              // protection and provide none, since it fails in exactly the
              // situation break-glass exists for.
              account({
                uid: 'u-2',
                email: 'samlonly@acme.com',
                unlinked: [],
                kept: ['saml.acme'],
              }),
            ],
          },
        },
      },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    fireEvent.click(button('Rehearse'))

    const eligible = (await screen.findByLabelText(
      'Break-glass: owner@acme.com',
    )) as HTMLInputElement
    const useless = screen.getByLabelText(
      'Break-glass: samlonly@acme.com',
    ) as HTMLInputElement
    expect(eligible.disabled).toBe(false)
    expect(useless.disabled).toBe(true)

    // And ticking it is what enables saving — the designation is the point,
    // not the checkbox.
    expect(button('Save break-glass accounts').disabled).toBe(true)
    fireEvent.click(eligible)
    expect(button('Save break-glass accounts').disabled).toBe(false)
  })

  it('names the designated accounts that protect nothing when the server refuses', async () => {
    mockConfirmOutcome = 'accept'
    serveByAction({
      // Designated, so the button is live — but the server re-plans the pool
      // and finds the pick holds nothing but the IdP link. Only the server
      // knows this, which is why the click is allowed and the body is read.
      status: { body: liveOrg({ breakGlassUids: ['u-2'] }) },
      'enforce-preview': {
        body: {
          ok: true,
          preview: {
            scanned: 1,
            changed: 0,
            accounts: [
              account({ uid: 'u-2', email: 'samlonly@acme.com', unlinked: [] }),
            ],
          },
        },
      },
      'enforce-apply': {
        status: 400,
        body: {
          error: 'Enforcing single sign-on would remove every sign-in method…',
          lockout: { safe: false, retainedBy: [], ineffective: ['u-2'] },
        },
      },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    // Rehearse first so the uid can be rendered as the email a human knows.
    fireEvent.click(button('Rehearse'))
    await screen.findByLabelText('Break-glass: samlonly@acme.com')

    fireEvent.click(button('Enforce'))

    const refusal = await screen.findByText(
      /hold nothing but your identity provider/,
    )
    // The LIST is the part that was being thrown away, and it has to be IN
    // the refusal — the email also appears in the rehearsal table below, so
    // a document-wide match would pass without the refusal naming anybody.
    // And as the EMAIL, not the uid: `u-2` is not a thing an admin can act on.
    expect(refusal.textContent).toMatch(/samlonly@acme\.com/)
    expect(refusal.textContent).not.toMatch(/u-2/)
  })
})

/**
 * AGL-1888: a pool WE provisioned cannot hold an effective break-glass
 * account at all, and the card must say so rather than asking for one.
 *
 * `provisionSsoPool` creates the tenant with `emailSignInConfig.enabled:
 * false`; `/api/orgs/members/password` refuses on `tenantId`; social logins
 * cannot be linked to a governed account. So every account in the pool holds
 * nothing but the SAML link, `assessSsoLockoutRisk` can never answer safe,
 * and "designate a break-glass account" is a dead end that reads as the
 * admin's failure to find one.
 */
describe('OrgSsoCard break-glass with no eligible account (AGL-1888)', () => {
  it('says enforcement is unavailable when no pool account could ever qualify', async () => {
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': {
        body: {
          ok: true,
          preview: {
            scanned: 2,
            changed: 0,
            accounts: [
              account({ uid: 'u-1', email: 'a@acme.com', unlinked: [] }),
              account({ uid: 'u-2', email: 'b@acme.com', unlinked: [] }),
            ],
          },
        },
      },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    fireEvent.click(button('Rehearse'))

    expect(
      await screen.findByText(/No account in your identity pool can serve as break-glass/),
    ).toBeTruthy()
  })

  it('does not say that when the pool does hold a qualifying account', async () => {
    // The paired positive: the warning must be about the POOL, not about
    // every rehearsal. `account()` defaults to holding a password.
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': {
        body: {
          ok: true,
          preview: { scanned: 1, changed: 1, accounts: [account()] },
        },
      },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    fireEvent.click(button('Rehearse'))

    await screen.findByLabelText('Break-glass: owner@acme.com')
    expect(
      screen.queryByText(/No account in your identity pool can serve as break-glass/),
    ).toBeNull()
  })
})

/**
 * AGL-1888 option (a) — the way OUT of the dead end above.
 *
 * An org owner in the project pool is invisible to the enforcement sweep (it
 * lists `authForPool(tenantId)` and nothing else), so an identity provider
 * that stops answering cannot lock them out. The server decides who qualifies
 * — seven conditions, none of which this component can see — and hands the
 * answer back on the rehearsal. The card's whole job is to believe it, say
 * who, and stop refusing.
 *
 * Both worlds are arranged in every case: an assertion that the button is
 * enabled proves nothing unless the identical org without an owner is still
 * refused, which is the pair that matters most here.
 */
const rehearsalWithOwners = (
  owners: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) => ({
  ok: true,
  preview: {
    scanned: 1,
    changed: 0,
    // A pool of the only shape `provisionSsoPool` can create: SAML and
    // nothing else, so no tick in the table could ever be effective.
    accounts: [account({ uid: 'u-1', email: 'pooled@acme.com', unlinked: [] })],
    lockout: {
      safe: owners.length > 0,
      retainedBy: [],
      ineffective: [],
      ownersOutsidePool: owners,
      ownerLookupFailed: false,
      ...extra,
    },
  },
})

const FOUNDER = {
  uid: 'founder',
  email: 'founder@personal.example',
  providers: ['password'],
}

describe('OrgSsoCard break-glass by an owner outside the pool (AGL-1888)', () => {
  it('THE FIX: enforcement becomes offerable, with nothing designated', async () => {
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': { body: rehearsalWithOwners([FOUNDER]) },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    // Disabled before the rehearsal — the card has not been told anything yet
    // and must not guess about a one-way door.
    expect(button('Enforce').disabled).toBe(true)

    fireEvent.click(button('Rehearse'))

    await screen.findByLabelText('Break-glass: pooled@acme.com')
    expect(button('Enforce').disabled).toBe(false)
    // And it says WHO, by the address the admin knows them by. "You are
    // protected" without a name is not something anybody can check.
    expect(
      screen.getByText(/founder@personal\.example/),
    ).toBeTruthy()
  })

  it('THE NEGATIVE: the identical org with no such owner stays refused', async () => {
    // Same pool, same absent designation, same rehearsal — only the server's
    // owner list differs. Without this pair the case above would pass on a
    // button that is simply always enabled after a rehearsal.
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': { body: rehearsalWithOwners([]) },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    fireEvent.click(button('Rehearse'))

    await screen.findByLabelText('Break-glass: pooled@acme.com')
    expect(button('Enforce').disabled).toBe(true)
    expect(
      screen.getByText(/No account in your identity pool can serve as break-glass/),
    ).toBeTruthy()
  })

  it('drops the dead-end warning once an owner outside the pool exists', async () => {
    // The warning is about having NO way in, not about the pool being
    // SAML-only — which it always is. Leaving it up next to an enabled
    // Enforce button would be the card contradicting itself.
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': { body: rehearsalWithOwners([FOUNDER]) },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    fireEvent.click(button('Rehearse'))

    await screen.findByLabelText('Break-glass: pooled@acme.com')
    expect(
      screen.queryByText(/No account in your identity pool can serve as break-glass/),
    ).toBeNull()
  })

  it('says the CHECK failed rather than claiming the org has nobody', async () => {
    // "We could not check" and "you have nobody" both refuse, but only one of
    // them is the org's problem to fix. An error swallowed into an empty list
    // renders as a measured zero and nothing about it looks wrong.
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': {
        body: rehearsalWithOwners([], { ownerLookupFailed: true }),
      },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    fireEvent.click(button('Rehearse'))

    expect(
      await screen.findByText(/could not finish checking/i),
    ).toBeTruthy()
    // Still refused — a failed check is never a way past the guard.
    expect(button('Enforce').disabled).toBe(true)
  })

  it('does not say the check failed when it succeeded', async () => {
    // The paired positive for the banner above.
    serveByAction({
      status: { body: liveOrg() },
      'enforce-preview': { body: rehearsalWithOwners([]) },
    })

    render(<OrgSsoCard />)
    await screen.findByText('On')
    fireEvent.click(button('Rehearse'))

    await screen.findByLabelText('Break-glass: pooled@acme.com')
    expect(screen.queryByText(/could not finish checking/i)).toBeNull()
  })
})
