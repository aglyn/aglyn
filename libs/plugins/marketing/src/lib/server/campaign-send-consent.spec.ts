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
 * The consent JOIN, asserted against what `sendEmail` was actually called
 * with (`docs/specs/email-overhaul.md` §3f).
 *
 * `marketingConsent` had seven writers and no reader on any send path:
 * `performCampaignSend` filtered on the suppression list and nothing else, so
 * a person who ticked a box and a person who explicitly declined reached the
 * same inbox. These assertions are deliberately made against the DELIVERED
 * addresses rather than against the split helper's return value — a rule that
 * decides correctly and does not reach the recipient list is worth nothing
 * here, and the failure ships to third parties before anybody notices.
 *
 * `marketing-consent.spec.ts` owns what the rule decides. This file owns that
 * the send applies it, where it applies it, and what it does to the meter.
 */

const mockState: {
  store: Record<string, Record<string, unknown>>
  sent: Array<Record<string, any>>
  metered: Array<[string, number, string]>
  reserved: number[]
  org: Record<string, unknown>
} = { store: {}, sent: [], metered: [], reserved: [], org: { plan: 'starter' } }

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The unsubscribe-link signer and URL builder are the REAL ones. They need
   * nothing but `crypto`, and a double would let a spec assert on a URL shape
   * the product does not actually mint — which is the whole failure mode of a
   * stubbed policy module.
   */
  ...jest.requireActual(
    '@aglyn/tenant-data-admin/server/email-unsubscribe-link',
  ),
  /*
   * The marketing frequency window is a no-op here, and deliberately so: it
   * is a durable counter whose behavior is proven against a Firestore double
   * in `tenant-data-admin`, and the campaign sender's only contract with it
   * is that it is called with the addresses that were reached and that it
   * cannot fail a send.
   */
  recordMarketingSends: async (_hostId: string, emails: readonly string[]) =>
    emails.length,
  // No site here selects a custom sending domain, so every send resolves to
  // the platform identity — the behavior these suites were written against.
  resolveHostSendingIdentity: async () =>
    jest
      .requireActual('@aglyn/shared-util-email')
      .resolveSendingIdentity({
        selection: null,
        platformFrom: process.env.USAGE_EMAIL_FROM || 'noreply@aglyn.com',
      }),
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockState.org }),
  // The `list` audience walks `orgDataCollectionForHost('contacts').parent`
  // to reach `orgs/{orgId}/lists`, so this has to be the real path shape and
  // not a bare jest.fn().
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    mockFirestore().collection(`orgs/org-1/${name}`),
  orgDataQueryForHost: async (_hostId: string, name: string) => ({
    ref: mockFirestore().collection(`orgs/org-1/${name}`),
    query: mockFirestore().collection(`orgs/org-1/${name}`),
  }),
  meterHostEmail: async (hostId: string, count: number, sendClass: string) => {
    mockState.metered.push([hostId, count, sendClass])
  },
  orgCampaignEmailSendsForMonth: async () => 0,
  /*
   * Records the CLAIMED count, which is the assertion that a withheld
   * recipient costs the merchant nothing. Consent sits before the meter on
   * purpose: being charged for mail that policy forbids sending would make
   * the consent rule take money as well as reach.
   */
  reserveCampaignEmailSends: async ({ count, limit }: any) => {
    mockState.reserved.push(count)
    if (count > limit) return { ok: false, used: 0, limit }
    return { ok: true, reservation: { orgId: 'org-1', month: 'm', reserved: count }, used: 0, limit }
  },
  reconcileCampaignSendReservation: async () => undefined,
  // Both suppression lists, through the shared filter this send now uses.
  // Wide open here: `campaign-send.spec.ts` and the suppression suites own
  // what it removes, and this file is about the consent join in front of it.
  // Nobody in these fixtures has left a topic, so the send's third filter is
  // a pass-through. Modeled rather than omitted: an absent export reads as
  // `undefined` and fails the send with a TypeError, which is a red that says
  // nothing about the behavior under test.
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  filterSendableForHost: async (_hostId: string, emails: string[]) => emails,
  readEmailSendRateConfig: async () => ({
    perHour: 100_000,
    enabled: true,
    updatedAtMs: null,
    updatedByEmail: null,
    note: '',
  }),
  /*
   * The per-org hourly share of the platform ceiling. Wide open here, like the
   * platform governor above it: this file is about something else, and a
   * ceiling that refused would make every assertion below a test of the
   * ceiling. `campaign-send-rate.spec.ts` owns the pacing.
   *
   * Listed because the barrel factory is a CLOSED WORLD — anything the sender
   * imports and this object omits arrives as `undefined` and throws at the
   * call.
   */
  claimOrgEmailSendBudget: async (options: any = {}) => {
    const ceiling = Math.max(1, Math.floor((options.platformPerHour ?? 100_000) * 0.25))
    const count = Math.max(0, Math.floor(Number(options.count) || 0))
    return {
      allowed: true,
      used: 0,
      ceiling,
      remaining: Math.max(0, ceiling - count),
      retryAtMs: 3_600_000,
      degraded: false,
    }
  },
  readEmailSendRateWindow: async () => ({
    windowStartMs: 0,
    resetMs: 3_600_000,
    used: 0,
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockState.sent.push(message)
    return { sent: true }
  },
}))

import { MARKETING_CONSENT_ENFORCED_FROM_MS } from '@aglyn/aglyn/server'
import { CampaignSendError, performCampaignSend } from './campaign-send'

/** A path-keyed Firestore stand-in, covering only the shapes a send makes. */
function mockFirestore(): any {
  const store = mockState.store
  const snapshot = (path: string) => {
    const data = store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, unknown>) => {
      store[path] = { ...(store[path] ?? {}), ...value }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  /** The ids directly under `path`, in `__name__` order. */
  const childIds = (path: string) =>
    Object.keys(store)
      .filter(
        (key) =>
          key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes('/'),
      )
      .map((key) => key.slice(path.length + 1))
      .sort()
  /**
   * `orderBy` / `startAfter` / `limit`, and `limit` HONORS its argument — a
   * double whose `limit` returned everything could not fail the way the real
   * one does, so a paging bug would pass here and truncate in production.
   */
  const queryRef = (path: string, after?: string): any => ({
    orderBy: () => queryRef(path, after),
    startAfter: (cursor: any) => queryRef(path, cursor?.id ?? String(cursor)),
    limit: (max: number) => ({
      get: async () => {
        const ids = childIds(path).filter((id) => !after || id > after)
        return { docs: ids.slice(0, max).map((id) => snapshot(`${path}/${id}`)) }
      },
    }),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    ...queryRef(path),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
  })
  return { collection: (name: string) => collectionRef(name) }
}

const BEFORE_CUTOFF = MARKETING_CONSENT_ENFORCED_FROM_MS - 30 * 86_400_000
const AFTER_CUTOFF = MARKETING_CONSENT_ENFORCED_FROM_MS + 30 * 86_400_000

/**
 * Four leads spanning the states that matter. Every one of them is a valid,
 * unsuppressed, deliverable address — nothing but the consent rule
 * distinguishes them, so anything the assertions catch is the rule.
 */
function seedLeads() {
  mockState.store = {
    'hosts/host-1': { subdomain: 'acme', memberRoles: {} },
    // Ticked the box. Mailable under every policy.
    'hosts/host-1/leads/l1': {
      email: 'consented@example.com',
      name: 'Cora',
      marketingConsent: true,
      marketingConsentAtMs: AFTER_CUTOFF,
      createdAt: AFTER_CUTOFF,
    },
    // Captured before consent was required, no basis. Reachable, reported.
    'hosts/host-1/leads/l2': {
      email: 'grandfathered@example.com',
      name: 'Glen',
      createdAt: BEFORE_CUTOFF,
    },
    // Captured AFTER consent was required, still no basis. Not mailable.
    'hosts/host-1/leads/l3': {
      email: 'nobasis@example.com',
      name: 'Nora',
      createdAt: AFTER_CUTOFF,
    },
    // Said no, and said it long ago. Never mailable.
    'hosts/host-1/leads/l4': {
      email: 'declined@example.com',
      name: 'Dev',
      marketingConsent: false,
      createdAt: BEFORE_CUTOFF,
    },
  }
  mockState.sent = []
  mockState.metered = []
  mockState.reserved = []
  mockState.org = { plan: 'starter' }
}

/**
 * Stores a policy on the org the send resolves.
 *
 * Cases whose outcome depends on how `unrecorded` is treated call this rather
 * than leaning on the policy an unconfigured org falls back to. Grandfathering
 * and retroactive enforcement are opposite answers to the same question, so a
 * case that asserts either one while saying nothing about the mode is really
 * asserting which way the DEFAULT points, and moving that default would move
 * this file's meaning without a word of it changing.
 */
const configurePolicy = (mode: 'forward' | 'strict') => {
  mockState.org = { plan: 'starter', marketingConsentPolicy: { mode } }
}

const send = (over: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: 'host-1',
    subject: 'Spring sale',
    body: 'The sale is on.',
    audience: 'leads',
    recordCampaign: false,
    senderUid: 'uid-1',
    ...over,
  })

const delivered = () =>
  mockState.sent.map((message) => String(message['to'])).sort()

let previousSecret: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
})
afterAll(() => {
  if (previousSecret === undefined) {
    delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  } else {
    process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
  }
})
beforeEach(seedLeads)

describe('a marketing campaign sends only where a basis permits it', () => {
  /**
   * ⚠️ THE ASSERTION THIS WHOLE FEATURE EXISTS FOR.
   *
   * A person with no recorded consent basis, captured under the rule, must
   * not receive a marketing campaign. Before the join this address was
   * delivered to like every other one.
   */
  it('does not mail a recipient with no recorded basis', async () => {
    await send()
    expect(delivered()).not.toContain('nobasis@example.com')
  })

  /**
   * The other unconditional half. A stored refusal is a decision the person
   * made and no mode, cutoff or grandfathering may mail over it — including
   * one recorded long before enforcement began.
   */
  it('does not mail a recipient who declined, however old the refusal', async () => {
    await send()
    expect(delivered()).not.toContain('declined@example.com')
  })

  /**
   * The NON-RETROACTIVE guarantee, which is the half that protects an existing
   * audience. Under `forward` the join must not empty one: everybody captured
   * before the cutoff stays reachable and is merely reported differently.
   */
  it('under forward, still mails everyone captured before consent was required', async () => {
    configurePolicy('forward')
    await send()
    expect(delivered()).toEqual([
      'consented@example.com',
      'grandfathered@example.com',
    ])
  })

  /**
   * WHERE the check sits. Consent is applied before the reservation, so a
   * withheld recipient never consumes the org's monthly allowance and never
   * appears in the cost meter. Being charged for mail that policy forbids
   * sending would make the rule cost the merchant money as well as reach.
   */
  it('never meters or claims allowance for a withheld recipient', async () => {
    // `forward`, so the four seeded leads split two and two and the numbers
    // below are a filter doing its job rather than an audience that collapsed.
    configurePolicy('forward')
    await send()
    expect(mockState.reserved).toEqual([2])
    expect(mockState.metered).toEqual([['host-1', 2, 'campaign']])
  })

  /**
   * The same audience under the other mode. `strict` is retroactive: the
   * grandfathered population goes, and the allowance claim follows it down
   * rather than staying at the audience's size.
   */
  it('claims only the consented population once the org turns strict', async () => {
    configurePolicy('strict')
    await send()
    expect(delivered()).toEqual(['consented@example.com'])
    expect(mockState.reserved).toEqual([1])
    expect(mockState.metered).toEqual([['host-1', 1, 'campaign']])
  })

  /**
   * The owner's decision, and what it costs. `strict` is the retroactive
   * mode: it removes the grandfathered population, which on a real audience
   * is most of it.
   */
  it('drops the grandfathered population once the org opts into strict', async () => {
    configurePolicy('strict')
    await send()
    expect(delivered()).toEqual(['consented@example.com'])
  })

  /**
   * A `manual` audience is hand-typed addresses with no person record behind
   * them, so there is nothing to read. Under `forward` they grandfather —
   * which is also what keeps the composer's test send to the admin's own
   * address working, since that send is a `manual` audience of one.
   */
  it('under forward, mails a hand-typed address, which has no record to read', async () => {
    configurePolicy('forward')
    await send({ audience: 'manual', emails: ['someone@example.com'] })
    expect(delivered()).toEqual(['someone@example.com'])
  })

  /**
   * ⚠️ WHAT RETROACTIVE ENFORCEMENT COSTS THE `manual` AUDIENCE.
   *
   * A hand-typed address reads as `unrecorded` because there is no document
   * behind it, and `strict` withholds every `unrecorded` recipient before it
   * ever reaches the clause that grandfathers a record with no capture date.
   * So under `strict` a `manual` audience has no mailable member by
   * construction and the send is refused whatever was typed.
   *
   * That is the rule applied consistently — a pasted list of addresses is the
   * case consent exists for — but it takes the composer's test send with it,
   * and that send is an admin proofing an email to their OWN address rather
   * than marketing to a stranger. Asserted here so the cost is a fact this
   * suite states rather than something discovered from a support ticket.
   */
  it('under strict, refuses a hand-typed address for want of a record', async () => {
    configurePolicy('strict')
    await expect(
      send({ audience: 'manual', emails: ['someone@example.com'] }),
    ).rejects.toThrow(/consent record/i)
    expect(mockState.sent).toHaveLength(0)
  })

  /**
   * THE SELF-PROOF CARVE-OUT, which is what keeps the composer's test send
   * alive under `strict` now that a `manual` audience has no mailable member.
   *
   * A proof to the requester's own verified address is not a marketing send:
   * the recipient is the person who pressed the button. The exemption is one
   * address wide, and the three cases below are the walls — without them this
   * is a parameter that turns the consent rule off.
   */
  describe('a proof of your own draft, sent to your own address', () => {
    it('sends under strict, where the same address as marketing would not', async () => {
      configurePolicy('strict')
      await send({
        audience: 'manual',
        emails: ['admin@example.com'],
        selfProofFor: 'admin@example.com',
      })
      expect(delivered()).toEqual(['admin@example.com'])
    })

    /**
     * WALL 1 — it may only exempt a recipient, never introduce one. Naming an
     * address that is not in the audience does nothing, so the option cannot
     * be used to mail somebody who was never being sent to.
     */
    it('does nothing for an address that is not in the audience', async () => {
      configurePolicy('strict')
      await expect(
        send({
          audience: 'manual',
          emails: ['someone@example.com'],
          selfProofFor: 'attacker@example.com',
        }),
      ).rejects.toThrow(/consent record/i)
      expect(mockState.sent).toHaveLength(0)
    })

    /**
     * WALL 2 — it exempts ONE address. A proof does not carry a pasted list
     * along with it; everybody else in the audience faces the rule as usual.
     */
    it('carries nobody else along with it', async () => {
      configurePolicy('strict')
      await send({
        audience: 'manual',
        emails: ['admin@example.com', 'stranger@example.com'],
        selfProofFor: 'admin@example.com',
      })
      expect(delivered()).toEqual(['admin@example.com'])
    })

    /**
     * WALL 3 — a stored refusal is still a refusal. This is the one rule with
     * no exception, and a self-proof is not the first one: an admin who
     * declined marketing on their own site un-declines rather than being
     * silently overridden. The message says which of the two problems it is,
     * because the fixes differ.
     */
    it('still refuses an address that recorded an opt-out', async () => {
      configurePolicy('strict')
      await expect(
        send({
          audience: 'leads',
          selfProofFor: 'declined@example.com',
        }),
      ).rejects.toThrow(/recorded marketing opt-out/i)
      expect(mockState.sent).toHaveLength(0)
    })

    /**
     * CONTROL — the exemption is doing the work, not the audience shape.
     * Identical send with the option absent is refused, so a green result
     * above cannot come from `manual` having quietly become mailable.
     */
    it('CONTROL — the same send without the option is refused', async () => {
      configurePolicy('strict')
      await expect(
        send({ audience: 'manual', emails: ['admin@example.com'] }),
      ).rejects.toThrow(/consent record/i)
      expect(mockState.sent).toHaveLength(0)
    })
  })

  /**
   * The refusal has to be a REFUSAL and not an empty-audience 400: a merchant
   * whose whole audience lacks a basis needs to be told which problem they
   * have, because the two have different fixes.
   */
  it('refuses the send, naming consent, when nobody is mailable', async () => {
    configurePolicy('strict')
    delete mockState.store['hosts/host-1/leads/l1']
    await expect(send()).rejects.toThrow(CampaignSendError)
    await expect(send()).rejects.toThrow(/consent record/i)
    expect(mockState.sent).toHaveLength(0)
  })
})

describe('the send preview says which population is which', () => {
  /**
   * The split is REPORTED, not netted into one number. `grandfathered` is
   * precisely the population that disappears if this org ever turns strict
   * on, so a merchant reading `Recipients 1,240` is owed the breakdown before
   * they write the email rather than after an audience collapses.
   */
  it('reports consented, grandfathered and withheld separately', async () => {
    // `forward`, because a non-zero `grandfathered` is the whole point: it is
    // the population that disappears if this org ever turns strict on.
    configurePolicy('forward')
    await expect(send({ dryRun: true })).resolves.toMatchObject({
      // The WHOLE audience, which is what the breakdown is measured over —
      // the same figure the `500 of 3,200` readout uses.
      audienceSize: 4,
      recipients: 2,
      sendable: 2,
      consented: 1,
      grandfathered: 1,
      consentWithheld: 2,
      dryRun: true,
    })
    // A dry run writes nothing and mails nothing.
    expect(mockState.sent).toHaveLength(0)
    expect(mockState.reserved).toEqual([])
  })

  /** `sendable` is what will really go out, so the composer cannot overstate it. */
  it('counts sendable after consent, not merely after suppression', async () => {
    configurePolicy('forward')
    const preview = await send({ dryRun: true })
    expect(preview.sendable).toBe(2)
    const actual = await send()
    expect(actual.sent).toBe(preview.sendable)
  })
})

/*==========================================
 * THE POPULATIONS THE SEND MEASURED, RECORDED.
 *
 * Every one of these was already computed on the real send path and returned
 * only from the DRY RUN — so once a campaign actually went out, the numbers
 * that explain WHY it reached the people it did were discarded. The campaign
 * report needs them, and it must not recompute them: consent records change
 * and addresses get suppressed, so asking the list next month answers a
 * question about the list under a heading that claims to describe the send.
 *=========================================*/
describe('what a real send writes onto the campaign', () => {
  const recorded = async () => {
    configurePolicy('forward')
    const result = await performCampaignSend({
      hostId: 'host-1',
      subject: 'Spring sale',
      body: 'The sale is on.',
      audience: 'leads',
      senderUid: 'uid-1',
    })
    return (
      mockState.store[`hosts/host-1/campaigns/${result.campaignId}`] as any
    ).stats
  }

  it('records the consent split the send measured', async () => {
    // The same four leads and the same policy the dry run above reports on,
    // so the recorded figures and the previewed ones are checkably the same
    // numbers rather than two implementations that happen to agree.
    expect(await recorded()).toMatchObject({
      audienceSize: 4,
      recipients: 2,
      consented: 1,
      grandfathered: 1,
      consentWithheld: 2,
    })
  })

  it('records how many of the addressed were already suppressed', async () => {
    expect(await recorded()).toMatchObject({ suppressed: 0 })
  })

  /*
   * Click tracking rewrites links in the HTML part, so a send with no HTML
   * reports zero clicks whatever recipients did. `sendEmail` now synthesises
   * one for a text-only send; recording that is what lets the report withhold
   * a click RATE on the campaigns that predate the fix instead of publishing
   * a structural zero as a measurement.
   */
  it('records that this send carried a trackable HTML part', async () => {
    expect(await recorded()).toMatchObject({ clickTracked: true })
  })

  it('leaves the counters the delivery webhook owns alone', async () => {
    const stats = await recorded()
    // Absent, not zero: the report distinguishes "no delivery events yet"
    // from "nothing was delivered", and a zero written here would collapse
    // the two on every campaign from the moment it is sent.
    expect(stats.delivered).toBeUndefined()
    expect(stats.opens).toBeUndefined()
    expect(stats.unsubscribes).toBeUndefined()
  })
})
