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
 * @jest-environment node
 */

/**
 * WHAT A NEWSLETTER SIGNUP DOES WHEN THE SITE ASKS FOR A CONFIRMATION
 * (`docs/specs/email-competitive-gaps.md` P8).
 *
 * WHAT THE DOUBLES MODEL, stated so a false green is visible:
 *
 *  1. `topicRequiresDoubleOptIn`, `mergeEmailTopics` and `normalizeEmailTopic`
 *     are the REAL pure functions. Whether a topic's own setting overrules the
 *     site's IS the rule under test, and doubling it would assert the double.
 *  2. `recordPendingTopicConfirmation` and `siteRequiresDoubleOptIn` are
 *     doubles. What they store and what they refuse is
 *     `email-topic-confirmation.spec.ts`'s question; what this file certifies
 *     is that the SIGNUP asks them, and in which order.
 *  3. `sendEmail` is a spy. The property that matters is what it is handed:
 *     no marketing context (this is transactional), and a link the recipient
 *     can click.
 *  4. The contact upsert is a spy too, because "the capture still happens"
 *     is half of the point — a confirmation gates the SEND, never the record
 *     of what the person actually did.
 */

const sent: Array<Record<string, unknown>> = []
const metered: string[] = []
const upserted: Array<Record<string, unknown>> = []
const enrolled: Array<Record<string, unknown>> = []
let pendingCalls: Array<{ hostId: string; email: string; topicId: string }> = []
let pendingResult = 'pending'
let siteDefault = false
let storedTopics: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: async (options: Record<string, unknown>) => {
    sent.push(options)
    return { sent: true, id: 'msg-1' }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's own sending identity, which every tenant send now resolves.
   *
   * A VERIFIED one, because these specs are about the mail their subject
   * sends rather than about the identity boundary — a refusing stub would
   * turn each of them into an assertion that no mail was sent, which is not
   * what any of them was written to check. The boundary itself is proved in
   * `platform-sending-domain.spec.ts`, `host-sending-domain.spec.ts` and
   * `email-audience-coverage.spec.ts`.
   *
   * The domain is the SITE's, never `aglyn.com`, so an assertion on a From:
   * address in this file cannot accidentally pass against a platform
   * fallback.
   */
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
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
  __esModule: true,
  meterHostEmail: async (hostId: string) => {
    metered.push(hostId)
  },
  // The attribution seam the handler resolves once per signup. Recorded as
  // nothing — `campaign-conversion-attribution.spec.ts` owns the write — and
  // defined here at all because a mocked module answers `undefined` for a
  // name it does not list, which would make the handler throw rather than
  // fail an assertion.
  resolveCampaignTouch: async () => null,
  upsertHostContact: async (options: Record<string, unknown>) => {
    upserted.push(options)
  },
  enrollListMember: async (options: Record<string, unknown>) => {
    enrolled.push(options)
    return { enrolled: true, memberId: 'm1', adopted: false, created: true }
  },
  orgDataCollectionForHost: async () => ({
    parent: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true }) }) }) },
  }),
  resolveOrgIdForHost: async () => 'org-1',
  siteRequiresDoubleOptIn: async () => siteDefault,
  recordPendingTopicConfirmation: async (
    hostId: string,
    email: string,
    topicId: string,
  ) => {
    pendingCalls.push({ hostId, email, topicId })
    return { result: pendingResult, pendingAtMs: 1 }
  },
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) =>
                name === 'hosts'
                  ? ({ subdomain: 'shop', cname: '' } as any)[field]
                  : undefined,
            }),
            collection: () => ({
              get: async () => ({
                docs: Object.entries(storedTopics).map(([id, data]) => ({
                  id,
                  data: () => data,
                })),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/document-id', () => ({
  __esModule: true,
  isDocumentId: () => true,
}))

jest.mock('@aglyn/tenant-data-admin/server/email-unsubscribe-link', () => ({
  __esModule: true,
  buildConfirmUrl: (input: Record<string, unknown>) =>
    input['siteBase'] ? `${input['siteBase']}/api/email/confirm?tid=newsletter` : '',
}))

import { newsletterHandler } from './newsletter'

const HOST = 'host-1'
const ADDRESS = 'dana@example.com'

/**
 * Every signup arrives from a DIFFERENT address.
 *
 * The handler's flood damper is a module-level map keyed by client IP and
 * bounded at ten a minute, and it does not reset between tests because
 * nothing in the module offers to. Sharing one bucket across a suite this
 * size makes the eleventh test a 429 and every one after it — which reads as
 * "the feature broke" and is the damper working. Varying the address is what
 * keeps this file about the confirmation rather than about the limiter.
 */
let signUpSeq = 0

async function signUp(body: Record<string, unknown> = {}) {
  const out: { code: number; body: any } = { code: 0, body: undefined }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(payload: unknown) {
      out.body = payload
      return res
    },
  }
  await newsletterHandler(
    {
      method: 'POST',
      body: { hostId: HOST, email: ADDRESS, ...body },
      headers: {},
      socket: { remoteAddress: `10.0.0.${(signUpSeq += 1)}` },
    } as any,
    res,
  )
  return out
}

beforeEach(() => {
  sent.length = 0
  metered.length = 0
  upserted.length = 0
  enrolled.length = 0
  pendingCalls = []
  pendingResult = 'pending'
  siteDefault = false
  storedTopics = {}
})

describe('when nothing asks for a confirmation', () => {
  it('subscribes outright and sends no confirmation', async () => {
    const answer = await signUp()
    expect(answer.code).toBe(200)
    expect(answer.body).toEqual({ ok: true, confirmationRequired: false })
    expect(pendingCalls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })
})

describe('when the site asks for one', () => {
  beforeEach(() => {
    siteDefault = true
  })

  it('quarantines the address and reports that it did', async () => {
    const answer = await signUp()
    expect(answer.body).toEqual({ ok: true, confirmationRequired: true })
    expect(pendingCalls).toEqual([
      { hostId: HOST, email: ADDRESS, topicId: 'newsletter' },
    ])
  })

  /**
   * The capture is a fact whether or not they click. Withholding it until
   * they do would lose the record of what the person actually did — the
   * confirmation gates the SEND, on their topic entry.
   */
  it('still captures the contact and its consent record', async () => {
    await signUp()
    expect(upserted).toHaveLength(1)
    expect(upserted[0]).toMatchObject({
      email: ADDRESS,
      marketingConsent: true,
    })
  })

  it('sends a confirmation carrying a link', async () => {
    await signUp()
    expect(sent).toHaveLength(1)
    expect(String(sent[0]['text'])).toContain('/api/email/confirm')
  })

  /**
   * TRANSACTIONAL. The person just asked for this, and gating the message
   * behind a marketing ceiling would drop exactly the one that lets them out
   * of the quarantine.
   */
  it('sends it as a transactional message, with no marketing context', async () => {
    await signUp()
    expect(sent[0]['marketing']).toBeUndefined()
    expect(sent[0]['to']).toBe(ADDRESS)
  })

  /**
   * A message this site sent costs what a message costs, so the meter has to
   * see it — `email-send-metering-coverage.spec.ts` is the guard that makes
   * an unmetered sender visible, and this is what it is guarding.
   */
  it('counts the confirmation against the site', async () => {
    await signUp()
    expect(metered).toEqual([HOST])
  })

  it('meters nothing when nothing was sent', async () => {
    pendingResult = 'already-subscribed'
    await signUp()
    expect(metered).toEqual([])
  })

  it('sends nothing to somebody who left this stream', async () => {
    pendingResult = 'opted-out'
    const answer = await signUp()
    expect(sent).toHaveLength(0)
    expect(answer.body.confirmationRequired).toBe(false)
  })

  it('sends nothing to somebody already confirmed', async () => {
    pendingResult = 'already-subscribed'
    const answer = await signUp()
    expect(sent).toHaveLength(0)
    expect(answer.body.confirmationRequired).toBe(false)
  })
})

describe('the topic overrules the site, in both directions', () => {
  it('confirms when the TOPIC asks and the site does not', async () => {
    siteDefault = false
    storedTopics = { newsletter: { name: 'Newsletter', doubleOptIn: true } }
    const answer = await signUp()
    expect(answer.body.confirmationRequired).toBe(true)
    expect(pendingCalls).toHaveLength(1)
  })

  it('does NOT confirm when the topic says no and the site says yes', async () => {
    siteDefault = true
    storedTopics = { newsletter: { name: 'Newsletter', doubleOptIn: false } }
    const answer = await signUp()
    expect(answer.body.confirmationRequired).toBe(false)
    expect(pendingCalls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('takes the site’s answer for a topic that stores no setting', async () => {
    siteDefault = true
    storedTopics = { newsletter: { name: 'Newsletter' } }
    expect((await signUp()).body.confirmationRequired).toBe(true)
  })
})
