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
 * The sending runtime against a real Firestore and a FAKE Gmail (AGL-2981).
 *
 * Every Outreach collection, the do-not-contact list, the platform's
 * suppression list and the site's topic opt-outs are the emulator's; the
 * mailbox is `FakeGmail`, which answers the runtime's sends and searches in
 * memory. No test reaches Google, and no mail is sent.
 *
 * What the database's own semantics decide is what is proved here: two runs
 * racing for one enrollment send it once, two racing for a mailbox's last
 * slot of the day reserve it once, and every opt-out lands on every list.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start an emulator on ports
 * of your own and point this at it:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> \
 *     npx jest -c libs/plugins/outreach/jest.config.ts \
 *       --testPathPatterns outreach-runtime.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import type {
  PluginRecordActivityRequest,
  PluginRecordDeliveryRequest,
  PluginRecordTaskRequest,
  PluginRecordTimelineWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { EMAIL_TOPIC_SALES, readTopicSubscriptionState } from '@aglyn/aglyn/app-utils/email-topics'
import { suppressEmail } from '@aglyn/tenant-data-admin/server/email-suppression'
import { recordTopicOptOut } from '@aglyn/tenant-data-admin/server/email-topic-confirmation'
import { outreachDoNotContactKey } from '../engine/do-not-contact'
import type { OutreachEnrollment, OutreachMailbox, OutreachSequence } from '../model/outreach.types'
import { FakeGmail } from './fixtures/fake-gmail'
import type { OutreachMailboxNoticeRequest, OutreachRuntimeDeps } from './runtime-deps'
import { runOutreachSendJob } from './send-job'
import { runOutreachSyncJob } from './sync-job'
import { createOutreachPersonEraser } from './person-erasure'
import { outreachClickUrl } from './click-link'
import { mintOutreachUnsubscribeToken, outreachUnsubscribeUrl } from './unsubscribe-link'
import { createOutreachUnsubscribeRoute } from './unsubscribe-route'

const EMULATED = Boolean(process.env['FIRESTORE_EMULATOR_HOST'])
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })
const describeEmulated = EMULATED ? describe : describe.skip

const SECRET = 'outreach-runtime-emulator-secret'
/** Tuesday 2026-09-15, 10:00 in Chicago: inside a Mon–Fri 9–17 window. */
const TUESDAY_10AM = Date.UTC(2026, 8, 15, 15, 0)
/**
 * Tuesday, 16:46 in Chicago: the window's last run of the day, when the
 * engine stops spreading the day's cap and a run may send its most.
 */
const TUESDAY_LAST_RUN = Date.UTC(2026, 8, 15, 21, 46)
/** Saturday 2026-09-19, 10:00 in Chicago: outside it. */
const SATURDAY_10AM = Date.UTC(2026, 8, 19, 15, 0)
const HOST = 'e2e-outreach-runtime-host'
const REP = 'uid-outreach-rep'
const MAILBOX_EMAIL = 'rep@example.com'

let firestore: Firestore
let orgSeq = 0
let orgId = ''
let clock = TUESDAY_10AM
let gmail: FakeGmail
const touchedOrgs: string[] = []

interface Filed {
  activities: PluginRecordActivityRequest[]
  tasks: PluginRecordTaskRequest[]
  feed: Array<{ action: string; target: { type: string; id: string } }>
  /** What the mailbox's owner was told (AGL-3244). */
  notices: OutreachMailboxNoticeRequest[]
  /** What became of a filed email (AGL-3245). */
  deliveries: PluginRecordDeliveryRequest[]
  /** What the runtime credited to a campaign (AGL-3254). */
  credits: Array<{ hostId: string; campaignIds: readonly string[]; outcome: string; atMs: number }>
  attributions: Array<{ hostId: string; kind: string; refId: string; campaignId: string; enrollmentId: string }>
  touches: Array<{ hostId: string; email: string; campaignId: string; enrollmentId: string }>
}
let filed: Filed

function timeline(): PluginRecordTimelineWriter {
  return {
    async logActivity(request) {
      filed.activities.push(request)
      return { ok: true, id: `a${filed.activities.length}`, created: true }
    },
    async createTask(request) {
      filed.tasks.push(request)
      return { ok: true, id: `t${filed.tasks.length}`, created: true }
    },
    async recordEmailDelivery(request) {
      filed.deliveries.push(request)
      return { ok: true, id: `d${filed.deliveries.length}`, created: true }
    },
  }
}

function deps(overrides: Partial<OutreachRuntimeDeps> = {}): OutreachRuntimeDeps {
  return {
    firestore: () => firestore,
    now: () => clock,
    random: () => 0.5,
    openMailbox: async () => ({
      ok: true,
      client: gmail,
      credential: {} as never,
    }),
    orgRefusal: async () => null,
    sendRefusal: async () => null,
    timeline,
    campaignCredit: {
      credit: async (input) => {
        filed.credits.push(input)
      },
      attributeRecord: async (input) => {
        filed.attributions.push(input)
      },
      recordTouch: async (input) => {
        filed.touches.push(input)
      },
    },
    logOrgActivity: async (_orgId, _actor, action, target) => {
      filed.feed.push({ action, target })
    },
    optOutOfSalesTopic: async ({ hostId, email }) => {
      await recordTopicOptOut(hostId, email, EMAIL_TOPIC_SALES, { firestore })
    },
    suppressBouncedEmail: async ({ email, hostId }) => {
      await suppressEmail({ email, reason: 'bounce', context: 'outreach', hostId, firestore })
    },
    notifyMailboxOwner: async (notice) => {
      filed.notices.push(notice)
    },
    // The record system's stamp (AGL-3245), stood in for: the record system
    // is another plugin, which this spec may not import, so the verdict is
    // written onto the contact the address names, as its writer would.
    stampRecordEmailState: async (stamp) => {
      const contacts = await firestore
        .collection('orgs')
        .doc(stamp.orgId)
        .collection('contacts')
        .where('email', '==', stamp.email)
        .get()
      for (const doc of contacts.docs) await doc.ref.set({ emailState: stamp.state }, { merge: true })
    },
    unsubscribeUrl: (target) =>
      outreachUnsubscribeUrl({ origin: 'https://console.example.com', target, secret: SECRET }),
    clickUrl: (target) =>
      outreachClickUrl({ origin: 'https://console.example.com', target, secret: SECRET }),
    ...overrides,
  }
}

const org = () => firestore.collection('orgs').doc(orgId)

function mailboxDoc(overrides: Partial<OutreachMailbox> = {}): OutreachMailbox {
  return {
    id: 'gm_rep',
    provider: 'google',
    email: MAILBOX_EMAIL,
    sendAs: MAILBOX_EMAIL,
    sendAsOptions: [{ email: MAILBOX_EMAIL, displayName: 'Rep Example', isPrimary: true, isDefault: true }],
    displayName: 'Rep Example',
    status: 'connected',
    dailyCap: 20,
    window: { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 },
    timezone: 'America/Chicago',
    rampStartedAtMs: null,
    health: {
      sentToday: 0,
      sentOnDay: null,
      bounces: 0,
      replies: 0,
      lastSentAtMs: null,
      lastErrorAtMs: null,
      lastErrorCode: null,
    },
    connectedByUid: REP,
    connectedAtMs: TUESDAY_10AM - 30 * 86_400_000,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  }
}

const SEQUENCE: OutreachSequence = {
  id: 'seq-1',
  name: 'Warm follow-up',
  hostId: HOST,
  mailboxId: 'gm_rep',
  steps: [
    {
      id: 'step-a',
      kind: 'email',
      delayBusinessDays: 0,
      subject: 'A question about {{contact.company}}',
      replyInThread: false,
      body: 'Hi {{contact.firstName}},\n\n{{enrollment.personalLine}}',
      templateId: null,
    },
    { id: 'step-b', kind: 'task', taskKind: 'call', title: 'Call them', delayBusinessDays: 1 },
    {
      id: 'step-c',
      kind: 'email',
      delayBusinessDays: 2,
      subject: '',
      replyInThread: true,
      body: 'Following up, {{contact.firstName}}.',
      templateId: null,
    },
  ],
  settings: { window: null, allowedCountries: ['US'], allowCustomers: false, trackClicks: false },
  status: 'active',
  createdAtMs: 1,
  updatedAtMs: 1,
}

async function seedOrg(options: { mailbox?: Partial<OutreachMailbox> | null; member?: boolean } = {}) {
  orgSeq += 1
  orgId = `e2e-outreach-runtime-${Date.now().toString(36)}-${orgSeq}`
  touchedOrgs.push(orgId)
  await org().set({ name: 'Example Co', plan: 'pro', billingStatus: 'active' })
  if (options.member !== false) await org().collection('members').doc(REP).set({ email: MAILBOX_EMAIL, role: 'owner' })
  await firestore.collection('hosts').doc(HOST).set({ orgId, name: 'Example Site' })
  await org()
    .collection('outreachSettings')
    .doc('compliance')
    .set({
      legalName: 'Example Co LLC',
      brandName: 'Example Co',
      postalAddress: '100 Example St\nSpringfield, IL 62701',
      allowedCountries: ['US'],
      updatedAtMs: 1,
      updatedByUid: REP,
    })
  if (options.mailbox !== null) {
    await org().collection('outreachMailboxes').doc('gm_rep').set(mailboxDoc(options.mailbox ?? {}))
  }
  await org().collection('outreachSequences').doc(SEQUENCE.id).set(SEQUENCE)
}

/** A warm contact — they filled in a form — and their enrollment, due now. */
async function enroll(n: number, overrides: Partial<OutreachEnrollment> = {}): Promise<OutreachEnrollment> {
  const contactId = `contact-${n}`
  const email = `person${n}@example.org`
  await org()
    .collection('contacts')
    .doc(contactId)
    .set({
      email,
      name: `Person ${n}`,
      visibleTo: [`host:${HOST}`],
      facets: {
        [HOST]: {
          firstName: `Pat${n}`,
          companyName: `Company ${n}`,
          sources: { form: true },
          address: { country: 'US' },
        },
      },
    })
  const enrollment: OutreachEnrollment = {
    id: `${SEQUENCE.id}_${contactId}`,
    sequenceId: SEQUENCE.id,
    target: 'contact',
    contactId,
    leadId: null,
    contactName: `Pat${n} Example`,
    email,
    hostId: HOST,
    mailboxId: 'gm_rep',
    stepIndex: 0,
    nextDueAtMs: clock - 60_000,
    status: 'active',
    stopReason: null,
    stopDetail: null,
    stoppedAtMs: null,
    stoppedByUid: null,
    personalLine: 'I saw your team just opened a second office.',
    cold: false,
    attestations: {},
    enrolledByUid: REP,
    gmailThreadId: null,
    gmailThreadIds: [],
    threadSubject: null,
    messageIds: [],
    lastSentAtMs: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  }
  await org().collection('outreachEnrollments').doc(enrollment.id).set(enrollment)
  return enrollment
}

async function enrollment(id: string): Promise<OutreachEnrollment> {
  return (await org().collection('outreachEnrollments').doc(id).get()).data() as OutreachEnrollment
}

async function mailbox(): Promise<OutreachMailbox> {
  return (await org().collection('outreachMailboxes').doc('gm_rep').get()).data() as OutreachMailbox
}

async function sequence(): Promise<OutreachSequence> {
  return (await org().collection('outreachSequences').doc(SEQUENCE.id).get()).data() as OutreachSequence
}

const tick = (overrides: Partial<OutreachRuntimeDeps> = {}) =>
  runOutreachSendJob(deps(overrides), { nowMs: clock, deadlineMs: clock + 60_000 })
const sync = () => runOutreachSyncJob(deps(), { nowMs: clock, deadlineMs: clock + 60_000 })

beforeAll(() => {
  if (!EMULATED) return
  firestore = getFirestore()
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = SECRET
})

beforeEach(() => {
  clock = TUESDAY_10AM
  gmail = new FakeGmail({ self: [MAILBOX_EMAIL] })
  filed = { activities: [], tasks: [], feed: [], notices: [], deliveries: [], credits: [], attributions: [], touches: [] }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(async () => {
  jest.restoreAllMocks()
  if (!EMULATED) return
  // Each test's workspace goes with it: the jobs read every workspace's
  // mailboxes and due enrollments, and a fresh fake mailbox reuses thread
  // ids, so a workspace left behind would be read by the next test's run.
  // Only what this spec wrote: the emulator may be shared with a dev server.
  for (const id of touchedOrgs.splice(0)) await firestore.recursiveDelete(firestore.collection('orgs').doc(id))
  // And the lists outside the workspace a test's opt-outs and bounces land
  // on, which would refuse the same people in the next test.
  await firestore.recursiveDelete(firestore.collection('hosts').doc(HOST))
  for (let n = 0; n < 10; n += 1) {
    const key = outreachDoNotContactKey(`person${n}@example.org`)
    if (key) await firestore.collection('emailSuppressions').doc(key).delete()
  }
})

describeEmulated('the send job (AGL-2981)', () => {
  it('sends a due step from the rep’s own mailbox, with its way out, and records it', async () => {
    await seedOrg()
    const one = await enroll(1)

    const report = await tick()

    expect(report).toMatchObject({ due: 1, sent: 1, held: 0, stopped: 0 })
    expect(gmail.sent).toHaveLength(1)
    const headers = gmail.sentHeaders(0)
    expect(headers['To']).toBe('person1@example.org')
    expect(headers['Subject']).toBe('A question about Company 1')
    expect(headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/console\.example\.com\/api\/outreach\/unsubscribe\?t=[^>]+>, <mailto:rep\+unsubscribe@example\.com\?subject=unsubscribe>$/,
    )
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    // The footer, however the body was encoded for the wire.
    expect(gmail.sent[0].body.replace(/=\r\n/g, '')).toContain('This is a sales email from Example Co.')

    const after = await enrollment(one.id)
    expect(after).toMatchObject({ status: 'active', stepIndex: 1, sendClaim: null })
    expect(after.gmailThreadIds).toHaveLength(1)
    expect(after.messageIds).toEqual([headers['Message-ID']])
    expect(after.stepRecords?.[0]).toMatchObject({
      stepId: 'step-a',
      kind: 'email',
      messageId: headers['Message-ID'],
      gmailThreadId: after.gmailThreadId,
      subject: 'A question about Company 1',
    })
    const box = await mailbox()
    expect(box.health).toMatchObject({ sentToday: 1, sentOnDay: '2026-09-15', lastSentAtMs: clock })
    expect(box.health.recentSends).toHaveLength(1)
    // On the contact's timeline, as an outbound email filed by its Message-ID.
    expect(filed.activities[0]).toMatchObject({
      kind: 'email',
      sourcePluginId: 'outreach',
      link: { contactId: 'contact-1' },
      email: { direction: 'outbound', messageId: headers['Message-ID'], to: 'person1@example.org' },
    })
  })

  it('counts the send on the sequence, and counts a person once however many steps they take (AGL-3239)', async () => {
    await seedOrg()
    const one = await enroll(1)

    await tick()
    expect((await sequence()).stats).toEqual({ sent: 1, people: 1 })

    // A second EMAIL to the same person — step 1 is the sequence's task, so
    // the enrollment is moved past it. A week on, so the clock lands on a
    // Tuesday and the mailbox's window is open.
    clock += 7 * 86_400_000
    await org()
      .collection('outreachEnrollments')
      .doc(one.id)
      .update({ stepIndex: 2, nextDueAtMs: clock - 60_000 })
    await tick()
    const stats = (await sequence()).stats
    expect(stats).toMatchObject({ sent: 2, people: 1 })
    // Never stamped by a send that carried no link — the report must read
    // "not measured" for it rather than publish a 0% click rate.
    expect(stats).not.toHaveProperty('clickTracked')
  })

  it('rewrites a tracked step’s links, keeps the footer, and records what it sent (AGL-3239)', async () => {
    await seedOrg()
    await org()
      .collection('outreachSequences')
      .doc(SEQUENCE.id)
      .update({
        'settings.trackClicks': true,
        steps: [
          { ...SEQUENCE.steps[0], body: 'Worth a look: https://aglyn.com/pricing\n\n— Rep' },
          ...SEQUENCE.steps.slice(1),
        ],
      })
    const one = await enroll(1)

    await tick()

    const body = gmail.sent[0].body.replace(/=\r\n/g, '')
    expect(body).toContain('https://console.example.com/api/outreach/click?t=')
    expect(body).not.toContain('https://aglyn.com/pricing')
    // The organization's identification and the way out are appended after
    // the rewrite, so no tracking link can reach them.
    expect(body).toContain('This is a sales email from Example Co.')

    const after = await enrollment(one.id)
    expect(after.stepRecords?.[0].links).toEqual(['https://aglyn.com/pricing'])
    expect((await sequence()).stats).toMatchObject({ sent: 1, people: 1, clickTracked: true })
  })

  it('sends nothing outside the sending window', async () => {
    await seedOrg()
    const one = await enroll(1)
    clock = SATURDAY_10AM
    await org().collection('outreachEnrollments').doc(one.id).update({ nextDueAtMs: clock - 60_000 })

    const report = await tick()

    expect(report.sent).toBe(0)
    expect(gmail.sent).toHaveLength(0)
    expect((await enrollment(one.id)).stepIndex).toBe(0)
  })

  it('holds the day’s cap: a mailbox at its cap sends nothing more today', async () => {
    await seedOrg({ mailbox: { dailyCap: 2, health: { ...mailboxDoc().health, sentToday: 2, sentOnDay: '2026-09-15' } } })
    await enroll(1)
    const report = await tick()
    expect(report.sent).toBe(0)
    expect(gmail.sent).toHaveLength(0)
  })

  it('holds the warm-up ramp: a mailbox in its first week sends at most ten a day, whatever its cap', async () => {
    await seedOrg({
      mailbox: {
        dailyCap: 50,
        rampStartedAtMs: TUESDAY_10AM - 86_400_000,
        health: { ...mailboxDoc().health, sentToday: 10, sentOnDay: '2026-09-15' },
      },
    })
    await enroll(1)
    expect((await tick()).sent).toBe(0)
    await org().collection('outreachMailboxes').doc('gm_rep').update({ 'health.sentToday': 9 })
    expect((await tick()).sent).toBe(1)
  })

  it('sends each due step once when two runs race for the same enrollments', async () => {
    clock = TUESDAY_LAST_RUN
    await seedOrg()
    const people = await Promise.all([enroll(1), enroll(2), enroll(3)])

    const reports = await Promise.all([tick(), tick()])

    expect(reports[0].sent + reports[1].sent).toBe(3)
    expect(gmail.sent.map((message) => message.headers.find((h) => h.name === 'To')?.value).sort()).toEqual([
      'person1@example.org',
      'person2@example.org',
      'person3@example.org',
    ])
    for (const person of people) {
      expect(await enrollment(person.id)).toMatchObject({ stepIndex: 1, sendClaim: null })
    }
    expect((await mailbox()).health.sentToday).toBe(3)
  })

  it('reserves a mailbox’s last slot of the day once when two runs race for it', async () => {
    clock = TUESDAY_LAST_RUN
    await seedOrg({ mailbox: { dailyCap: 3, health: { ...mailboxDoc().health, sentToday: 2, sentOnDay: '2026-09-15' } } })
    await Promise.all([enroll(1), enroll(2)])

    const reports = await Promise.all([tick(), tick()])

    expect(reports[0].sent + reports[1].sent).toBe(1)
    expect(gmail.sent).toHaveLength(1)
    expect((await mailbox()).health.sentToday).toBe(3)
  })

  it('files a task step as the rep’s task, due now, and moves on without spending the cap', async () => {
    await seedOrg()
    const one = await enroll(1, { stepIndex: 1 })

    const report = await tick()

    expect(report).toMatchObject({ tasks: 1, sent: 0 })
    expect(filed.tasks[0]).toMatchObject({
      title: 'Call them',
      kind: 'call',
      assigneeUid: REP,
      dueAtMs: clock,
      link: { contactId: 'contact-1' },
      sourcePluginId: 'outreach',
      dedupeKey: `step:${one.id}:step-b`,
    })
    expect(await enrollment(one.id)).toMatchObject({ stepIndex: 2, sendClaim: null })
    expect((await mailbox()).health.sentToday).toBe(0)
  })

  it('stops, rather than sends, a person the gates now refuse', async () => {
    await seedOrg()
    const one = await enroll(1)
    await org()
      .collection('outreachDoNotContact')
      .doc(String(outreachDoNotContactKey(one.email)))
      .set({ key: 'k', reason: 'manual', source: 'member', addedByUid: REP, addedAtMs: 1 })

    const report = await tick()

    expect(report).toMatchObject({ sent: 0, stopped: 1 })
    expect(await enrollment(one.id)).toMatchObject({ status: 'opted_out', stopReason: 'do_not_contact' })
  })

  it('stops the enrollments of a mailbox that is gone, or whose member left the organization', async () => {
    await seedOrg({ mailbox: null })
    const orphan = await enroll(1)
    await tick()
    expect(await enrollment(orphan.id)).toMatchObject({ status: 'stopped', stopReason: 'gate' })
    expect((await enrollment(orphan.id)).stopDetail).toMatch(/was removed/)

    await seedOrg({ member: false })
    const departed = await enroll(2)
    await tick()
    expect(await enrollment(departed.id)).toMatchObject({ status: 'stopped', stopReason: 'gate' })
    expect((await enrollment(departed.id)).stopDetail).toMatch(/no longer in the organization/)
    expect(gmail.sent).toHaveLength(0)
  })

  it('settles a claim a dead run left by finding its message, without sending it twice', async () => {
    await seedOrg()
    const one = await enroll(1)
    await tick()
    const sent = await enrollment(one.id)
    // Rewind to the moment the run died: the send went out, the claim stayed.
    await org()
      .collection('outreachEnrollments')
      .doc(one.id)
      .update({
        stepIndex: 0,
        nextDueAtMs: clock - 60_000,
        sendClaim: { token: 'dead-run', atMs: clock - 20 * 60_000, stepIndex: 0, messageId: sent.messageIds[0] },
      })
    clock += 60_000

    const report = await tick()

    expect(report.recovered).toBe(1)
    expect(gmail.sent).toHaveLength(1)
    expect(await enrollment(one.id)).toMatchObject({ stepIndex: 1, sendClaim: null })
  })
})

describeEmulated('the sync job (AGL-2981)', () => {
  async function sentTo(n: number) {
    const person = await enroll(n)
    await tick()
    return enrollment(person.id)
  }

  it('stops the sequence on a reply, files the reply and gives the rep the task', async () => {
    await seedOrg()
    const one = await sentTo(1)
    clock += 3_600_000
    gmail.deliver({
      threadId: String(one.gmailThreadId),
      from: 'Pat1 Example <person1@example.org>',
      to: MAILBOX_EMAIL,
      subject: 'Re: A question about Company 1',
      text: 'Thanks — can we talk Thursday?',
      atMs: clock - 60_000,
      messageId: '<reply-1@mail.example.org>',
      headers: { 'In-Reply-To': one.messageIds[0] },
    })

    const report = await sync()

    expect(report).toMatchObject({ replies: 1 })
    expect(await enrollment(one.id)).toMatchObject({ status: 'replied', stopReason: 'reply', nextDueAtMs: null })
    expect(filed.activities.at(-1)).toMatchObject({
      email: { direction: 'inbound', messageId: '<reply-1@mail.example.org>', from: 'person1@example.org' },
      body: 'Thanks — can we talk Thursday?',
    })
    expect(filed.tasks.at(-1)).toMatchObject({
      title: 'Reply from Pat1 Example',
      assigneeUid: REP,
      kind: 'email',
      dedupeKey: 'reply:<reply-1@mail.example.org>',
    })
    expect((await mailbox()).health.replies).toBe(1)

    // A second run reads the same thread and does nothing twice.
    await sync()
    expect(filed.tasks.filter((task) => task.dedupeKey === 'reply:<reply-1@mail.example.org>')).toHaveLength(1)
    expect((await mailbox()).health.replies).toBe(1)
  })

  it('postpones the next step on an out-of-office, and keeps the sequence running', async () => {
    await seedOrg()
    const one = await sentTo(1)
    const dueBefore = Number(one.nextDueAtMs)
    clock += 3_600_000
    gmail.deliver({
      threadId: String(one.gmailThreadId),
      from: 'person1@example.org',
      to: MAILBOX_EMAIL,
      subject: 'Automatic reply: A question about Company 1',
      text: 'I am out of the office until next week.',
      atMs: clock - 60_000,
      headers: { 'Auto-Submitted': 'auto-replied' },
    })

    await sync()

    const after = await enrollment(one.id)
    expect(after.status).toBe('active')
    expect(Number(after.nextDueAtMs)).toBeGreaterThan(dueBefore)
    // A working week after the reply, at least.
    expect(Number(after.nextDueAtMs)).toBeGreaterThanOrEqual(clock + 5 * 86_400_000)
    expect(filed.tasks.filter((task) => task.dedupeKey.startsWith('reply:'))).toHaveLength(0)
  })

  it('suppresses a hard bounce: stopped, on the platform list and the do-not-contact list', async () => {
    await seedOrg()
    const one = await sentTo(1)
    clock += 600_000
    gmail.deliver({
      from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      to: MAILBOX_EMAIL,
      subject: 'Delivery Status Notification (Failure)',
      atMs: clock - 60_000,
      contentType: 'multipart/report; report-type=delivery-status; boundary="b"',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from("Address not found. Your message wasn't delivered to person1@example.org.").toString('base64url') },
        },
        {
          mimeType: 'message/delivery-status',
          body: {
            data: Buffer.from(
              'Reporting-MTA: dns; googlemail.com\n\nFinal-Recipient: rfc822; person1@example.org\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 <person1@example.org>: no such user',
            ).toString('base64url'),
          },
        },
      ],
    })

    const report = await sync()

    expect(report.bounces).toBe(1)
    expect(await enrollment(one.id)).toMatchObject({ status: 'bounced', stopReason: 'hard_bounce' })
    const key = String(outreachDoNotContactKey(one.email))
    expect((await firestore.collection('emailSuppressions').doc(key).get()).data()).toMatchObject({
      reason: 'bounce',
      context: 'outreach',
      hostId: HOST,
    })
    const entry = (await org().collection('outreachDoNotContact').doc(key).get()).data()
    expect(entry).toMatchObject({ reason: 'hard_bounce', source: 'runtime', enrollmentId: one.id })
    // The diagnostic is kept without the address it named.
    expect(String(entry?.['detail'])).not.toContain('person1@example.org')
    expect((await mailbox()).health.bounces).toBe(1)
    // The record the person is says so (AGL-3245): the contact carries the
    // verdict, and the send's own timeline entry is marked bounced.
    const contact = (await org().collection('contacts').doc('contact-1').get()).data()
    expect(contact?.['emailState']).toMatchObject({ status: 'bounced', source: 'sequence', enrollmentId: one.id })
    expect(String(contact?.['emailState']?.['detail'])).not.toContain('person1@example.org')
    expect(filed.deliveries).toEqual([
      expect.objectContaining({ orgId, messageId: one.messageIds[0], state: 'bounced', detail: expect.stringContaining('no such user') }),
    ])
  })

  it('pauses the mailbox itself after two hard bounces in a day, and says so on the feed', async () => {
    await seedOrg()
    const one = await sentTo(1)
    const two = await sentTo(2)
    clock += 600_000
    for (const person of [one, two]) {
      gmail.deliver({
        threadId: String(person.gmailThreadId),
        from: 'mailer-daemon@googlemail.com',
        to: MAILBOX_EMAIL,
        subject: 'Delivery Status Notification (Failure)',
        atMs: clock - 60_000,
        contentType: 'multipart/report; report-type=delivery-status; boundary="b"',
        parts: [
          {
            mimeType: 'message/delivery-status',
            body: {
              data: Buffer.from(`Final-Recipient: rfc822; ${person.email}\nAction: failed\nStatus: 5.1.1`).toString('base64url'),
            },
          },
        ],
      })
    }

    const report = await sync()

    expect(report).toMatchObject({ bounces: 2, paused: 1 })
    const box = await mailbox()
    expect(box).toMatchObject({ status: 'paused', autoPause: { reason: 'bounces_today' } })
    expect(box.autoPause?.message).toMatch(/Paused after 2 hard bounces today/)
    expect(box.health.recentSends?.filter((send) => send.bounced)).toHaveLength(2)
    expect(filed.feed).toEqual([
      expect.objectContaining({
        action: expect.stringMatching(/^Paused a mailbox in Sequences automatically/),
        target: expect.objectContaining({ type: 'outreach:mailbox', id: 'gm_rep' }),
      }),
    ])
    // The owner is told by the write that paused it (AGL-3244): the engine's
    // sentence, the mailbox, and how many enrollments are waiting on it.
    await enroll(3)
    expect(filed.notices).toEqual([
      {
        orgId,
        mailboxId: 'gm_rep',
        connectedByUid: REP,
        kind: 'auto_pause',
        mailbox: { email: MAILBOX_EMAIL, sendAs: MAILBOX_EMAIL, displayName: 'Rep Example' },
        message: box.autoPause?.message,
        waiting: 0,
      },
    ])

    // A paused mailbox sends nothing, and a later run tells nobody again.
    expect((await tick()).sent).toBe(0)
    await sync()
    expect(filed.notices).toHaveLength(1)
  })

  it('files the domain beside the address when the bounce is the gateway’s block, and refuses the next person there (AGL-3244)', async () => {
    await seedOrg()
    const one = await sentTo(1)
    clock += 600_000
    gmail.deliver({
      threadId: String(one.gmailThreadId),
      from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      to: MAILBOX_EMAIL,
      subject: 'Delivery Status Notification (Failure)',
      atMs: clock - 60_000,
      contentType: 'multipart/report; report-type=delivery-status; boundary="b"',
      parts: [
        {
          mimeType: 'message/delivery-status',
          body: {
            data: Buffer.from(
              'Reporting-MTA: dns; googlemail.com\n\nFinal-Recipient: rfc822; person1@example.org\nAction: failed\nStatus: 5.7.1\n' +
                'Diagnostic-Code: smtp; 550 permanent failure for one or more recipients (person1@example.org:blocked)',
            ).toString('base64url'),
          },
        },
      ],
    })

    const report = await sync()

    expect(report).toMatchObject({ bounces: 1, gatewayBlocks: 1 })
    const stopped = await enrollment(one.id)
    expect(stopped).toMatchObject({ status: 'bounced', stopReason: 'hard_bounce' })
    expect(stopped.stopDetail).toMatch(/^The mail gateway at example\.org blocked the email, so example\.org is on your organization's do-not-contact list/)
    expect(stopped.stopDetail).not.toContain('person1@example.org')
    // The address is filed as it always was, and the domain beside it.
    const key = String(outreachDoNotContactKey(one.email))
    expect((await org().collection('outreachDoNotContact').doc(key).get()).data()).toMatchObject({ reason: 'hard_bounce' })
    const domain = (await org().collection('outreachDoNotContactDomains').doc('example.org').get()).data()
    expect(domain).toMatchObject({ domain: 'example.org', reason: 'gateway_block', source: 'runtime', enrollmentId: one.id })
    expect(String(domain?.['detail'])).toContain('(the address:blocked)')
    // One bounce in one send is under the rate floor: the mailbox keeps sending.
    expect((await mailbox()).status).toBe('connected')
    // The record reads "blocked", not "bounced" (AGL-3245).
    expect((await org().collection('contacts').doc('contact-1').get()).get('emailState')).toMatchObject({ status: 'blocked' })

    // The next person at that domain is refused before the send, with the domain named.
    const two = await enroll(2)
    const next = await tick()
    expect(next).toMatchObject({ sent: 0, stopped: 1 })
    expect(await enrollment(two.id)).toMatchObject({
      status: 'stopped',
      stopReason: 'gate',
      stopDetail: expect.stringContaining("person2@example.org is at example.org, which is on your organization's do-not-contact list"),
    })
  })

  it('leaves the domain alone when the bounce names the address as unknown', async () => {
    await seedOrg()
    const one = await sentTo(1)
    clock += 600_000
    gmail.deliver({
      threadId: String(one.gmailThreadId),
      from: 'mailer-daemon@googlemail.com',
      to: MAILBOX_EMAIL,
      subject: 'Delivery Status Notification (Failure)',
      atMs: clock - 60_000,
      contentType: 'multipart/report; report-type=delivery-status; boundary="b"',
      parts: [
        {
          mimeType: 'message/delivery-status',
          body: {
            data: Buffer.from(
              'Final-Recipient: rfc822; person1@example.org\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 no such user',
            ).toString('base64url'),
          },
        },
      ],
    })
    expect(await sync()).toMatchObject({ bounces: 1, gatewayBlocks: 0 })
    expect((await org().collection('outreachDoNotContactDomains').doc('example.org').get()).exists).toBe(false)
  })

  it('tells the owner once when Google stops accepting the mailbox, and says so on the feed (AGL-3244)', async () => {
    await seedOrg()
    await enroll(1)
    const refused = { openMailbox: async () => ({ ok: false as const, reason: 'sealed-token-unreadable' as const }) }

    expect((await tick(refused)).sent).toBe(0)

    expect((await mailbox()).status).toBe('reconnect_required')
    expect(filed.feed).toEqual([
      expect.objectContaining({
        action: expect.stringMatching(/needs reconnecting.*sealed-token-unreadable/),
        target: expect.objectContaining({ type: 'outreach:mailbox', id: 'gm_rep' }),
      }),
    ])
    expect(filed.notices).toEqual([
      expect.objectContaining({
        kind: 'reconnect_required',
        mailboxId: 'gm_rep',
        connectedByUid: REP,
        message: expect.stringContaining('(sealed-token-unreadable)'),
        waiting: 1,
      }),
    ])

    // A second run finds it already marked, and tells nobody again.
    await tick(refused)
    await runOutreachSyncJob(deps(refused), { nowMs: clock, deadlineMs: clock + 60_000 })
    expect(filed.notices).toHaveLength(1)
    expect(filed.feed).toHaveLength(1)
  })

  it('opts out a person who writes to the unsubscribe address, on every list', async () => {
    await seedOrg()
    const one = await sentTo(1)
    clock += 600_000
    gmail.deliver({
      from: 'person1@example.org',
      to: 'rep+unsubscribe@example.com',
      subject: 'unsubscribe',
      text: '',
      atMs: clock - 60_000,
    })

    const report = await sync()

    expect(report.optOuts).toBe(1)
    expect(await enrollment(one.id)).toMatchObject({ status: 'opted_out', stopReason: 'unsubscribe' })
    const key = String(outreachDoNotContactKey(one.email))
    expect((await org().collection('outreachDoNotContact').doc(key).get()).data()).toMatchObject({
      reason: 'unsubscribe',
      source: 'runtime',
    })
    const topics = (await firestore.collection('hosts').doc(HOST).collection('topicOptOuts').doc(key).get()).get('topics')
    expect(readTopicSubscriptionState(topics?.[EMAIL_TOPIC_SALES])).toBe('opted-out')
  })
})

describeEmulated('the one-click unsubscribe (AGL-2981)', () => {
  const route = () => createOutreachUnsubscribeRoute(deps())
  const params = { params: {} }

  async function expectUnsubscribed(person: OutreachEnrollment) {
    expect(await enrollment(person.id)).toMatchObject({ status: 'opted_out', stopReason: 'unsubscribe' })
    const key = String(outreachDoNotContactKey(person.email))
    expect((await org().collection('outreachDoNotContact').doc(key).get()).data()).toMatchObject({
      reason: 'unsubscribe',
      source: 'runtime',
      enrollmentId: person.id,
    })
    const topics = (await firestore.collection('hosts').doc(HOST).collection('topicOptOuts').doc(key).get()).get('topics')
    expect(readTopicSubscriptionState(topics?.[EMAIL_TOPIC_SALES])).toBe('opted-out')
  }

  it('GET stops the enrollment and suppresses the address, and says so on a plain page', async () => {
    await seedOrg()
    const one = await enroll(1)
    const token = mintOutreachUnsubscribeToken({ orgId, enrollmentId: one.id }, SECRET)

    const response = await route()(new Request(`https://console.example.com/api/outreach/unsubscribe?t=${token}`), params)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    const page = await response.text()
    expect(page).toContain('You’re unsubscribed')
    expect(page).toContain('Example Co won’t send you any more of these emails.')
    expect(page).not.toMatch(/<script/i)
    await expectUnsubscribed(one)
  })

  it('the RFC 8058 one-click POST stops and suppresses too, and a second use changes nothing', async () => {
    await seedOrg()
    const one = await enroll(1)
    const other = await enroll(2, { sequenceId: 'seq-2', id: 'seq-2_contact-1', contactId: 'contact-1', email: 'person1@example.org' })
    const token = mintOutreachUnsubscribeToken({ orgId, enrollmentId: one.id }, SECRET)
    const post = () =>
      route()(
        new Request(`https://console.example.com/api/outreach/unsubscribe?t=${token}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
        }),
        params,
      )

    expect((await post()).status).toBe(200)
    await expectUnsubscribed(one)
    // Every other open enrollment of the address is stopped with it.
    expect(await enrollment(other.id)).toMatchObject({ status: 'opted_out', stopReason: 'do_not_contact' })

    const key = String(outreachDoNotContactKey(one.email))
    const first = (await org().collection('outreachDoNotContact').doc(key).get()).data()
    expect((await post()).status).toBe(200)
    expect((await org().collection('outreachDoNotContact').doc(key).get()).data()).toEqual(first)
  })

  it('refuses a forged or altered token and writes nothing', async () => {
    await seedOrg()
    const one = await enroll(1)
    const forged = mintOutreachUnsubscribeToken({ orgId, enrollmentId: one.id }, 'another-secret')
    const response = await route()(
      new Request(`https://console.example.com/api/outreach/unsubscribe?t=${forged}`),
      params,
    )
    expect(response.status).toBe(400)
    expect(await enrollment(one.id)).toMatchObject({ status: 'active' })
    expect(
      (await org().collection('outreachDoNotContact').doc(String(outreachDoNotContactKey(one.email))).get()).exists,
    ).toBe(false)
  })
})

describeEmulated('the person eraser (AGL-2981)', () => {
  it('deletes the person’s enrollments and keeps their do-not-contact entry, stripped of what names them', async () => {
    await seedOrg()
    const one = await enroll(1)
    const byContact = await enroll(2, { id: 'seq-2_contact-1', sequenceId: 'seq-2', contactId: 'contact-1', email: 'old-address@example.org' })
    const someoneElse = await enroll(3)
    const key = String(outreachDoNotContactKey(one.email))
    await org().collection('outreachDoNotContact').doc(key).set({
      key,
      reason: 'hard_bounce',
      source: 'runtime',
      addedByUid: null,
      addedAtMs: 1,
      enrollmentId: one.id,
      sequenceId: SEQUENCE.id,
      detail: '550 5.1.1 the address: no such user',
    })
    const eraser = createOutreachPersonEraser({ firestore: () => firestore })
    const request = { orgId, email: one.email, key, contactIds: ['contact-1'] }

    // A plan counts and writes nothing.
    expect(await eraser({ ...request, dryRun: true })).toEqual({
      enrollments: 2,
      doNotContactKept: true,
      doNotContactScrubbed: null,
    })
    expect((await org().collection('outreachEnrollments').doc(one.id).get()).exists).toBe(true)

    expect(await eraser({ ...request, dryRun: false })).toEqual({
      enrollments: 2,
      doNotContactKept: true,
      doNotContactScrubbed: true,
    })
    expect((await org().collection('outreachEnrollments').doc(one.id).get()).exists).toBe(false)
    expect((await org().collection('outreachEnrollments').doc(byContact.id).get()).exists).toBe(false)
    expect((await org().collection('outreachEnrollments').doc(someoneElse.id).get()).exists).toBe(true)
    // The promise stays, and nothing in it points back at the person.
    expect((await org().collection('outreachDoNotContact').doc(key).get()).data()).toEqual({
      key,
      reason: 'hard_bounce',
      source: 'runtime',
      addedByUid: null,
      addedAtMs: 1,
      enrollmentId: null,
      sequenceId: SEQUENCE.id,
      detail: null,
    })
  })
})
