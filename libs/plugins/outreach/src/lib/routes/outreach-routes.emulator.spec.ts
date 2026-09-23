/**
 * @jest-environment node
 *
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
 * The sequence, enroll and enrollment routes against a real Firestore
 * (AGL-2980).
 *
 * `outreach-routes.spec.ts` drives every branch against an in-memory store;
 * what that store cannot show is the database answering the routes' own
 * queries the way the routes assume:
 *
 * - archiving pages through a sequence's enrollments with an equality
 *   filter ordered by document id and `startAfter`, which needs no
 *   composite index, and stops only the open ones;
 * - enrolling reads the contacts and the gates' lookups with `getAll` and
 *   equality queries, and two confirms of one person at once write ONE
 *   enrollment — `create()`'s refusal, not a map's;
 * - a do-not-contact mark runs its transaction and opts out the address's
 *   other open enrollment.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start an emulator on ports
 * of your own and point this at it:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> \
 *     npx jest -c libs/plugins/outreach/jest.config.ts \
 *       --testPathPatterns outreach-routes.emulator
 */

import type { DecodedIdToken } from 'firebase-admin/auth'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { OUTREACH_USE_PERMISSION } from '../constants/bundle-common'
import { outreachDoNotContactKey } from '../engine/do-not-contact'
import { createOutreachEnrollRoutes, type OutreachEnrollRouteDeps } from './enroll-routes'
import { createOutreachEnrollmentActionRoute } from './enrollment-routes'
import { createOutreachSequenceRoutes } from './sequence-routes'

const EMULATED = Boolean(process.env['FIRESTORE_EMULATOR_HOST'])
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })
const describeEmulated = EMULATED ? describe : describe.skip

const ORG = 'e2e-outreach-routes-org'
const HOST = 'e2e-outreach-routes-host'
const REP = 'e2e-outreach-routes-rep'
const MAILBOX = 'e2e-outreach-routes-mailbox'
const AT = Date.parse('2026-09-15T15:00:00Z')

let firestore: Firestore

const deps = (): OutreachEnrollRouteDeps => ({
  firestore: () => firestore,
  gate: {
    verifyIdToken: async (uid) => ({ uid, email: 'rep@example.com', email_verified: true }) as unknown as DecodedIdToken,
    resolveOrgPermissions: async (_uid, context) => ({
      orgId: context.orgId,
      role: 'admin',
      isOwner: true,
      orgWide: true,
      permissions: { [OUTREACH_USE_PERMISSION]: true },
    }),
    holdsOrgCatalogPermission: async () => true,
    readOrg: async () => ({ plan: 'pro', entitlements: { features: { outreach: true } } }),
    lockdownRefusal: async () => null,
  },
  now: () => AT,
  random: () => 0.5,
  logOrgActivity: async () => undefined,
  crmViewEmails: async () => ({ emails: [], complete: true }),
  stampRecordEmailState: async () => undefined,
  creditCampaign: async (input) => {
    credits.push(input)
  },
  // No record system here: the enroll's timeline entry (AGL-3274) is the
  // fake-store spec's to pin, and this one files nothing.
  timeline: () => null,
})

/** What the enroll route credited to a campaign (AGL-3254). */
const credits: Array<{ hostId: string; campaignIds: readonly string[]; outcome: string; atMs: number }> = []

async function post(handler: ReturnType<typeof createOutreachEnrollmentActionRoute>, body: Record<string, unknown>) {
  const response = await handler(
    new Request('https://console.example.com/api/outreach', {
      method: 'POST',
      headers: { authorization: `Bearer ${REP}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: ORG, ...body }),
    }),
    { params: {} },
  )
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

const orgRef = () => firestore.collection('orgs').doc(ORG)

beforeAll(async () => {
  if (!EMULATED) return
  firestore = getFirestore()
  await firestore.collection('hosts').doc(HOST).set({ orgId: ORG, name: 'Example Shop' })
  await orgRef().collection('members').doc(REP).set({ role: 'admin', email: 'rep@example.com' })
  await orgRef().collection('outreachMailboxes').doc(MAILBOX).set({
    email: 'rep@example.com',
    sendAs: 'rep@example.com',
    displayName: 'Avery Quinn',
    status: 'connected',
    timezone: 'America/Chicago',
    window: { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 },
    connectedByUid: REP,
  })
  await orgRef().collection('outreachSettings').doc('compliance').set({
    legalName: 'Example Shop LLC',
    postalAddress: '100 Example St',
    allowedCountries: ['US'],
  })
  await orgRef().collection('contacts').doc('c-warm').set({
    name: 'Casey Morgan',
    email: 'casey.morgan@example.com',
    visibleTo: [`host:${HOST}`],
    facets: { [HOST]: { sources: { form: true }, address: { country: 'US' } } },
  })
})

afterAll(async () => {
  if (!EMULATED) return
  // Only what this spec wrote: the emulator may be shared with a dev server.
  await firestore.recursiveDelete(orgRef())
  await firestore.recursiveDelete(firestore.collection('hosts').doc(HOST))
})

describeEmulated('Outreach routes on Firestore (AGL-2980)', () => {
  let sequenceId = ''

  it('saves and activates a sequence', async () => {
    const sequences = createOutreachSequenceRoutes(deps())
    const saved = await post(sequences.save, {
      sequence: {
        name: 'Second locations',
        hostId: HOST,
        mailboxId: MAILBOX,
        steps: [
          {
            id: 'step-a',
            kind: 'email',
            delayBusinessDays: 0,
            subject: 'Hello',
            replyInThread: false,
            body: 'Hi {{contact.firstName}}. {{enrollment.personalLine}}',
            templateId: null,
          },
        ],
        settings: { window: null, allowedCountries: ['US'], allowCustomers: false },
      },
    })
    expect(saved.status).toBe(200)
    sequenceId = saved.body.sequence.id
    expect((await post(sequences.status, { sequenceId, action: 'activate' })).body.sequence.status).toBe('active')
  })

  it('writes one enrollment when the same person is confirmed twice at once', async () => {
    const enroll = createOutreachEnrollRoutes(deps())
    const results = await Promise.all([
      post(enroll.confirm, { sequenceId, people: [{ contactId: 'c-warm' }] }),
      post(enroll.confirm, { sequenceId, people: [{ contactId: 'c-warm' }] }),
    ])
    expect(results.map((result) => result.body.enrolled).sort()).toEqual([0, 1])
    const stored = await orgRef().collection('outreachEnrollments').doc(`${sequenceId}_c-warm`).get()
    expect(stored.get('status')).toBe('active')
    expect(typeof stored.get('nextDueAtMs')).toBe('number')
  })

  /*
   * The enroll stamp (AGL-3254), against the database's own `arrayUnion`:
   * the enrollment stores the sequence's campaigns, the lead gains them
   * beside the one it already carried, and `enrolled` is credited once.
   */
  it('stamps the sequence’s campaigns on the enrollment and the lead, and credits the enroll', async () => {
    await orgRef().collection('emailCampaigns').doc('founder-icp2').set({ name: 'Founder · ICP 2', visibleTo: ['org'] })
    await orgRef().collection('emailCampaigns').doc('founder-icp1').set({ name: 'Founder · ICP 1', visibleTo: ['org'] })
    const leadId = personKey('sam@initech.example') as string
    // The lead is an org row scoped by `visibleTo` (AGL-3275); an unscoped
    // one is visible to nobody, including to the enroll route reading it.
    await orgRef().collection('leads').doc(leadId).set({
      email: 'sam@initech.example',
      name: 'Sam Rivera',
      sources: ['form:form-1'],
      address: { country: 'US' },
      campaignIds: ['founder-icp1'],
      visibleTo: [`host:${HOST}`],
      lastSeenAtMs: AT,
    })
    const sequences = createOutreachSequenceRoutes(deps())
    const saved = await post(sequences.save, {
      sequence: {
        name: 'Founder outbound',
        hostId: HOST,
        mailboxId: MAILBOX,
        campaignIds: ['founder-icp2', 'founder-icp1'],
        steps: [
          {
            id: 'step-a',
            kind: 'email',
            delayBusinessDays: 0,
            subject: 'Hello',
            replyInThread: false,
            body: 'Hi {{contact.firstName}}. {{enrollment.personalLine}}',
            templateId: null,
          },
        ],
        settings: { window: null, allowedCountries: ['US'], allowCustomers: false },
      },
    })
    expect(saved.status).toBe(200)
    const inCampaign = saved.body.sequence.id as string
    expect(saved.body.sequence.campaignIds).toEqual(['founder-icp2', 'founder-icp1'])
    await post(sequences.status, { sequenceId: inCampaign, action: 'activate' })

    credits.length = 0
    const enroll = createOutreachEnrollRoutes(deps())
    const { body } = await post(enroll.confirm, { sequenceId: inCampaign, people: [{ leadId }] })
    expect(body.enrolled).toBe(1)
    const enrollment = await orgRef().collection('outreachEnrollments').doc(`${inCampaign}_${leadId}`).get()
    expect(enrollment.get('campaignIds')).toEqual(['founder-icp2', 'founder-icp1'])
    const lead = await orgRef().collection('leads').doc(leadId).get()
    expect(lead.get('campaignIds')).toEqual(['founder-icp1', 'founder-icp2'])
    expect(credits).toEqual([
      { hostId: HOST, orgId: ORG, campaignIds: ['founder-icp2', 'founder-icp1'], outcome: 'enrolled', atMs: AT },
    ])
  })

  it('marks do-not-contact, and opts out the address in another sequence', async () => {
    await orgRef().collection('outreachEnrollments').doc('seq-other_c-warm').set({
      sequenceId: 'seq-other',
      contactId: 'c-warm',
      email: 'casey.morgan@example.com',
      status: 'paused',
      stopReason: 'manual',
      nextDueAtMs: AT,
    })
    const { body } = await post(createOutreachEnrollmentActionRoute(deps()), {
      enrollmentId: `${sequenceId}_c-warm`,
      action: 'do_not_contact',
    })
    expect(body).toMatchObject({ changed: true, stoppedOthers: 1, enrollment: { status: 'opted_out' } })
    const listed = await orgRef()
      .collection('outreachDoNotContact')
      .doc(String(outreachDoNotContactKey('casey.morgan@example.com')))
      .get()
    expect(listed.get('source')).toBe('member')
    expect((await orgRef().collection('outreachEnrollments').doc('seq-other_c-warm').get()).get('status')).toBe(
      'opted_out',
    )
  })

  it('archives, paging the enrollments by id and stopping only the open ones', async () => {
    const sequences = createOutreachSequenceRoutes(deps())
    const batch = firestore.batch()
    for (let index = 0; index < 5; index += 1) {
      batch.set(orgRef().collection('outreachEnrollments').doc(`${sequenceId}_extra-${index}`), {
        sequenceId,
        email: `person${index}@example.com`,
        status: index % 2 ? 'active' : 'finished',
        nextDueAtMs: AT,
        stopReason: null,
      })
    }
    await batch.commit()
    const { body } = await post(sequences.status, { sequenceId, action: 'archive' })
    expect(body.stoppedEnrollments).toBe(2)
    const stopped = await orgRef()
      .collection('outreachEnrollments')
      .where('sequenceId', '==', sequenceId)
      .where('stopReason', '==', 'sequence_archived')
      .get()
    expect(stopped.size).toBe(2)
  })
})
