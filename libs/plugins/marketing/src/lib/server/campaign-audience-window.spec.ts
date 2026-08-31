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
 * D1 and D6 of `docs/specs/email-overhaul.md` — who a campaign actually
 * reaches, and whether the merchant is told.
 *
 * ## D1 — the audience was a random sample
 *
 * Every audience read was a `limit()` with no `orderBy`. Firestore answers
 * that in document-id order and the ids are generated, so a site with more
 * people than the window mailed an ARBITRARY and unstable subset — not the
 * newest, not the oldest, a different slice each send — and the composer
 * reported the window size as the audience. The three properties that have to
 * hold now:
 *
 *  1. the resolution PAGES, so the audience is the whole audience;
 *  2. the per-send cap takes the first N of a STABLE order, so two sends of an
 *     unchanged audience reach the same people and which people is answerable;
 *  3. when a number is short, the result SAYS SO — `audienceSize` beside
 *     `recipients`, and `audienceTruncated` when even the audience is a floor.
 *
 * ## D6 — campaigns consulted one suppression list
 *
 * An address suppressed platform-wide — a hard bounce or a spam complaint
 * learned on another site, or on transactional mail carrying no site tag —
 * was mailed anyway. The double below implements BOTH lists, exactly as
 * `filterSendableForHost` does, so a sender that went back to reading
 * `hosts/{hostId}/suppressions` on its own would deliver to somebody this
 * file expects to be spared.
 */

const mockState: {
  store: Record<string, Record<string, unknown>>
  sent: Array<Record<string, any>>
} = { store: {}, sent: [] }

jest.mock('@aglyn/tenant-data-admin', () => ({
  // The literal three call sites compare against — the unsubscribe writes
  // it, the resubscribe link refuses to reverse anything else, and the
  // preference page reads it. A mock that omitted it would write `undefined`
  // and every one of those comparisons would silently stop matching.
  UNSUBSCRIBE_SUPPRESSION_REASON: 'unsubscribe',
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
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
  /*
   * BOTH lists, the shape the real helper has. `email-suppression.spec.ts`
   * owns whether the helper itself is right; what this file certifies is that
   * the sender goes THROUGH it — an address on the platform list alone must
   * not receive a campaign.
   */
  // Nobody in these fixtures has left a topic, so the send's third filter is
  // a pass-through. Modeled rather than omitted: an absent export reads as
  // `undefined` and fails the send with a TypeError, which is a red that says
  // nothing about the behavior under test.
  filterTopicSendable: async (
    _hostId: string,
    _topicId: string,
    emails: string[],
  ) => emails,
  filterSendableForHost: async (hostId: string, emails: string[]) =>
    emails.filter((email) => {
      // `require` inside the factory rather than the file's own import: a mock
      // factory is hoisted above every import, so a top-level binding is still
      // in its temporal dead zone when this object is built.
      const key = require('crypto')
        .createHash('sha256')
        .update(email.trim().toLowerCase())
        .digest('hex')
      return (
        !mockState.store[`emailSuppressions/${key}`] &&
        !mockState.store[`hosts/${hostId}/suppressions/${key}`]
      )
    }),
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: async () =>
    mockFirestore().collection('orgs/org-1/contacts'),
  orgDataQueryForHost: async () => ({
    ref: mockFirestore().collection('orgs/org-1/contacts'),
    query: mockFirestore().collection('orgs/org-1/contacts'),
  }),
  meterHostEmail: async () => undefined,
  // Permissive: the cap and the hourly governor have their own files, and one
  // that refused here would make every assertion below a test of the cap.
  orgCampaignEmailSendsForMonth: async () => 0,
  reserveCampaignEmailSends: async ({ count }: any) => ({
    ok: true,
    reservation: { orgId: 'org-1', month: '2026-08', reserved: count },
    used: 0,
    limit: 1_000_000,
  }),
  reconcileCampaignSendReservation: async () => undefined,
  readEmailSendRateConfig: async () => ({
    perHour: 1_000_000,
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

import { createHash } from 'crypto'
import { performCampaignSend } from './campaign-send'

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
  /** The ids directly under `path`, in the `__name__` order the sweep asks for. */
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
   * `orderBy` / `startAfter` / `limit`, and `limit` HONORS its argument.
   *
   * A double whose `limit` returns everything cannot fail the way the real one
   * does: a sender that never advanced its cursor would resolve the whole
   * collection here and truncate at 500 in production.
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

const HOST = 'host-1'
const suppressionKey = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

/**
 * A recorded opt-in, in the shape every capture path writes it.
 *
 * The consent join runs at the sweep, ahead of the cap and both suppression
 * lists, and withholds a recipient with no recorded basis. This suite is about
 * which documents the sweep REACHES and which of them suppression removes, so
 * every lead in it declares a basis: without one they would drop out one step
 * earlier and each assertion would be passing on the wrong rule.
 *
 * Carries no `createdAt` or `addedAt` deliberately. Those are the fields the
 * ordering trap below is about, and consent is recorded independently of them.
 */
const CONSENT_GRANTED = {
  // The basis belongs to the site sending, not to the org.
  marketingConsentByHost: {
    'host-1': { marketingConsent: true, marketingConsentAtMs: Date.UTC(2026, 7, 1) },
  },
}

/**
 * `count` leads with ZERO-PADDED ids, so document-name order and the order a
 * human reads them in are the same thing and the expectation below can be
 * written out rather than derived from the double.
 */
const seedLeads = (
  count: number,
  extra: Record<string, Record<string, unknown>> = {},
) => {
  mockState.store = {
    [`hosts/${HOST}`]: { subdomain: 'acme', memberRoles: {} },
    ...Object.fromEntries(
      Array.from({ length: count }, (_item, index) => {
        const id = String(index).padStart(5, '0')
        return [
          `hosts/${HOST}/leads/lead-${id}`,
          {
            email: `lead${id}@example.com`,
            name: `Lead ${index}`,
            ...CONSENT_GRANTED,
          },
        ]
      }),
    ),
    ...extra,
  }
  mockState.sent = []
}

const send = (overrides: Record<string, unknown> = {}) =>
  performCampaignSend({
    hostId: HOST,
    subject: 'Spring sale',
    body: 'plain text',
    audience: 'leads',
    senderUid: 'uid-1',
    ...overrides,
  } as any)

const recipientsOf = () =>
  mockState.sent.map((message) => String(message.to)).sort()

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

describe('an audience larger than one send may carry', () => {
  it('reports the WHOLE audience beside what the send reached', async () => {
    // The defect in one assertion: 600 people, 500 mailed, and the merchant
    // used to be told the audience was 500. A send that reaches five of every
    // six people is a fact about the campaign, not an implementation detail.
    seedLeads(600)
    const result = await send()

    expect(result.audienceSize).toBe(600)
    expect(result.recipients).toBe(500)
    expect(result.sent).toBe(500)
    expect(result.audienceTruncated).toBeUndefined()
  })

  it('PAGES past the first read rather than mistaking it for the audience', async () => {
    // 600 is larger than one page, so an audience of 500 here would mean the
    // resolution stopped at its first round trip — which is the shape the bare
    // `limit()` had, with a page size standing in for the window.
    seedLeads(600)
    expect((await send({ dryRun: true })).audienceSize).toBe(600)
  })

  it('takes the FIRST N in document-name order, not an arbitrary slice', async () => {
    // The ids sort the way the numbers do, so this names exactly who is mailed
    // and exactly who is not. Under the old unordered read the answer was
    // whichever documents the query happened to return.
    seedLeads(600)
    await send()

    const reached = recipientsOf()
    expect(reached).toHaveLength(500)
    expect(reached[0]).toBe('lead00000@example.com')
    expect(reached[499]).toBe('lead00499@example.com')
    expect(reached).not.toContain('lead00500@example.com')
    expect(reached).not.toContain('lead00599@example.com')
  })

  it('reaches the SAME people on a second send of an unchanged audience', async () => {
    // Stability is the half of D1 that ordering buys. "Who did this campaign
    // go to" is a support question and a compliance question, and a send that
    // picks a fresh arbitrary slice each time cannot answer it.
    seedLeads(600)
    await send()
    const first = recipientsOf()
    mockState.sent = []
    await send()

    expect(recipientsOf()).toEqual(first)
  })

  it('marks the audience a FLOOR when the scan ceiling stopped it', async () => {
    // 5,001 people against a 5,000-document read budget. The honest answer is
    // "at least 5,000", never a silent 5,000 presented as the total.
    seedLeads(5001)
    const result = await send({ dryRun: true })

    expect(result.audienceSize).toBe(5000)
    expect(result.audienceTruncated).toBe(true)
  })

  it('does not claim "more" of a collection that ends exactly at the ceiling', async () => {
    // The extra single-document probe. Reporting a floor for an exact figure
    // would train a merchant to ignore the marker.
    seedLeads(5000)
    const result = await send({ dryRun: true })

    expect(result.audienceSize).toBe(5000)
    expect(result.audienceTruncated).toBeUndefined()
  })

  it('records the audience on the campaign, where History reads it', async () => {
    // Months later the row is the only place a merchant can find out that the
    // campaign did not reach everybody.
    seedLeads(600)
    const result = await send()

    expect(
      (mockState.store[`hosts/${HOST}/campaigns/${result.campaignId}`] as any)
        .stats,
    ).toMatchObject({ audienceSize: 600, recipients: 500, sent: 500 })
  })
})

describe('an audience that fits', () => {
  it('reports the audience and the send size as the same number', async () => {
    seedLeads(3)
    const result = await send()

    expect(result.audienceSize).toBe(3)
    expect(result.recipients).toBe(3)
    expect(result.sent).toBe(3)
  })

  it('keeps a document carrying no date of any kind', async () => {
    // The ordering trap, as a live case. `orderBy(field)` DROPS every document
    // missing that field, and there is no date every writer of these
    // collections sets — the newsletter handler wrote list members as
    // `{ email, name, source }` and no date at all. Ordering on the document
    // NAME is what keeps this person in the audience.
    seedLeads(0, {
      [`hosts/${HOST}/leads/lead-00000`]: {
        email: 'bare@example.com',
        ...CONSENT_GRANTED,
      },
    })
    const result = await send()

    expect(result.audienceSize).toBe(1)
    expect(recipientsOf()).toEqual(['bare@example.com'])
  })
})

describe('both suppression lists', () => {
  it('does not mail an address the PLATFORM suppressed', async () => {
    // The address is on `emailSuppressions` and on NO site list — a bounce or
    // a complaint learned somewhere else in the product. A campaign that reads
    // only its own site's list mails them anyway, from the one shared sending
    // domain every tenant's mail leaves by.
    seedLeads(0, {
      [`hosts/${HOST}/leads/lead-00000`]: {
        email: 'keep@example.com',
        ...CONSENT_GRANTED,
      },
      // Consented, so the SUPPRESSION list is the only thing that can hold
      // this address back and the assertion measures what it claims to.
      [`hosts/${HOST}/leads/lead-00001`]: {
        email: 'bounced@example.com',
        ...CONSENT_GRANTED,
      },
      [`emailSuppressions/${suppressionKey('bounced@example.com')}`]: {
        email: 'bounced@example.com',
        reason: 'bounce',
      },
    })
    const result = await send()

    expect(recipientsOf()).toEqual(['keep@example.com'])
    expect(result.sent).toBe(1)
    // Still counted in the audience: the person exists, they are simply not
    // mailable. Reporting them as absent would hide why the send was short.
    expect(result.audienceSize).toBe(2)
  })

  it('still does not mail an address that unsubscribed from THIS site', async () => {
    // The half that already worked, kept as a control: a change that consulted
    // only the platform list would pass the case above and break this one.
    seedLeads(0, {
      [`hosts/${HOST}/leads/lead-00000`]: {
        email: 'keep@example.com',
        ...CONSENT_GRANTED,
      },
      [`hosts/${HOST}/leads/lead-00001`]: {
        email: 'gone@example.com',
        ...CONSENT_GRANTED,
      },
      [`hosts/${HOST}/suppressions/${suppressionKey('gone@example.com')}`]: {
        email: 'gone@example.com',
        reason: 'unsubscribe',
      },
    })
    await send()

    expect(recipientsOf()).toEqual(['keep@example.com'])
  })

  it('counts both kinds in the preview, so the number matches the send', async () => {
    seedLeads(0, {
      [`hosts/${HOST}/leads/lead-00000`]: {
        email: 'keep@example.com',
        ...CONSENT_GRANTED,
      },
      // Both consented: `suppressed` counts what the suppression lists removed,
      // and a recipient the consent join had already withheld never reaches it.
      [`hosts/${HOST}/leads/lead-00001`]: {
        email: 'bounced@example.com',
        ...CONSENT_GRANTED,
      },
      [`hosts/${HOST}/leads/lead-00002`]: {
        email: 'gone@example.com',
        ...CONSENT_GRANTED,
      },
      [`emailSuppressions/${suppressionKey('bounced@example.com')}`]: {
        email: 'bounced@example.com',
      },
      [`hosts/${HOST}/suppressions/${suppressionKey('gone@example.com')}`]: {
        email: 'gone@example.com',
      },
    })
    const result = await send({ dryRun: true })

    expect(result.audienceSize).toBe(3)
    expect(result.sendable).toBe(1)
    expect(result.suppressed).toBe(2)
  })
})

describe('an org list audience', () => {
  /** A list whose members were written the way the newsletter handler wrote them. */
  const seedList = (members: Record<string, Record<string, unknown>>) => {
    mockState.store = {
      [`hosts/${HOST}`]: { subdomain: 'acme', memberRoles: {} },
      'orgs/org-1/lists/list-1': { name: 'Newsletter' },
      ...members,
    }
    mockState.sent = []
  }

  it('reaches a member enrolled with no date on the document', async () => {
    // `enrollListMember` stamps `addedAt` only when it CREATES the row, and
    // the newsletter handler that wrote this collection before it stored no
    // date at all. `orderBy('addedAt')` would have dropped every one of them.
    seedList({
      'orgs/org-1/lists/list-1/members/aaa': {
        email: 'newsletter@example.com',
        source: 'newsletter',
        ...CONSENT_GRANTED,
      },
      'orgs/org-1/lists/list-1/members/bbb': {
        email: 'workflow@example.com',
        source: 'enrollList',
        addedAt: 'server-timestamp',
        ...CONSENT_GRANTED,
      },
    })
    const result = await send({ audience: 'list', listId: 'list-1' })

    expect(result.audienceSize).toBe(2)
    expect(recipientsOf()).toEqual([
      'newsletter@example.com',
      'workflow@example.com',
    ])
  })
})
