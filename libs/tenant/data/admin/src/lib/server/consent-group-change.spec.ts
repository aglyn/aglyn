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
 * The consent group change executor (AGL-3320), end to end over a Firestore
 * that queries.
 *
 * I4 is the property everything else rests on: the declaration flips only
 * after every carry and both catch-up passes are done, and never at all while
 * a participant cannot carry its share. The rest pin what a change looks like
 * from outside while it runs — exactly one caller works it at a time, a
 * cancel is only possible before the flip, the sweep waits out its delay, and
 * the activity log says each of those things once.
 */

import {
  CONSENT_GROUP_SWEEP_DELAY_MS,
  CONSENT_GROUPS_CHANGE_FIELD,
  type ConsentGroupChangePlan,
} from '@aglyn/aglyn/app-utils/consent-group-change'
import {
  type ConsentGroupChangeParticipant,
  registerPluginConsentGroupParticipant,
  resetPluginConsentGroupParticipantsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-consent-group-change'
import { Timestamp } from 'firebase-admin/firestore'
import {
  advanceConsentGroupChange,
  advanceDueConsentGroupChanges,
  cancelConsentGroupChange,
  CONSENT_GROUP_CHANGE_LEASE_MS,
  type ConsentGroupChangeJob,
  previewConsentGroupChange,
  readConsentGroupChangeStatus,
  startConsentGroupChange,
} from './consent-group-change'
import { queryFakeFirestore } from './test-firestore-queries'

const ORG = 'org-1'
const X = 'site-x'
const R = 'site-r'
const S = 'site-s'
const GROUP = { g1: { name: 'Northwind', hostIds: [R, X] } }
const ACTOR = { uid: 'uid-admin', email: 'admin@example.com' }
const at = (ms: number) => Timestamp.fromMillis(ms)

let clock = Date.UTC(2026, 8, 24, 12)
let logged: string[] = []
const log = async (_orgId: string, _actor: unknown, action: string) => {
  logged.push(action)
}

function world(extra: Record<string, Record<string, unknown>> = {}) {
  return queryFakeFirestore(
    {
      [`orgs/${ORG}`]: {
        name: 'Acme',
        hosts: { [X]: true, [R]: true, [S]: true },
        consentGroups: GROUP,
      },
      [`hosts/${X}`]: { name: 'Shop' },
      [`hosts/${R}`]: { name: 'Blog' },
      [`hosts/${S}`]: { name: 'Bookings', subdomain: 'bookings' },
      [`hosts/${X}/suppressions/k-x`]: {
        email: 'pat@example.com',
        reason: 'unsubscribe',
        suppressedAt: at(clock - 1_000),
      },
      [`hosts/${R}/topicOptOuts/k-r`]: {
        email: 'lee@example.com',
        topics: { newsletter: { optedOutAt: at(clock - 2_000), resubscribedAt: null } },
        updatedAt: at(clock - 2_000),
      },
      ...extra,
    },
    { nowMs: clock },
  )
}

type Fake = ReturnType<typeof world>
const ctx = (firestore: Fake) => ({ firestore: firestore as never, log, now: () => clock })
const job = (firestore: Fake, changeId: string) =>
  firestore.read(`orgs/${ORG}/consentGroupChanges/${changeId}`) as unknown as ConsentGroupChangeJob

/** X leaves Northwind, which then holds R alone and so dissolves. */
const LEAVE = { expected: GROUP, groups: [] as unknown[] }

/** A participant that records what it saw on every call. */
function recordingParticipant(firestore: Fake, calls: Array<Record<string, unknown>>) {
  const participant: ConsentGroupChangeParticipant = {
    preview: async () => [{ id: 'records.copy', text: 'Copies 3 records', count: 3, severity: 'info' }],
    run: async (request) => {
      calls.push({
        phase: request.phase,
        cursor: request.cursor,
        declared: firestore.read(`orgs/${ORG}`)?.['consentGroups'] ?? null,
        carriedRow: firestore.read(`hosts/${R}/suppressions/k-x`) !== undefined,
      })
      // Two calls per phase, to prove the executor resumes from the cursor.
      return request.cursor
        ? { done: true, cursor: null, counts: { combined: 1 } }
        : { done: false, cursor: 'page-2', counts: { combined: 1 } }
    },
    summarize: (counts) => `${counts['combined'] ?? 0} records combined`,
  }
  registerPluginConsentGroupParticipant(participant, { pluginId: 'records' })
}

beforeEach(() => {
  clock = Date.UTC(2026, 8, 24, 12)
  logged = []
  resetPluginConsentGroupParticipantsForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('starting a change', () => {
  it('sets the marker and creates the job in one go, and logs the start', async () => {
    const firestore = world()
    const started = await startConsentGroupChange({ orgId: ORG, actor: ACTOR, ...LEAVE, ...ctx(firestore) })
    expect(started.ok).toBe(true)
    const { changeId } = started as { changeId: string }
    expect(firestore.read(`orgs/${ORG}`)?.[CONSENT_GROUPS_CHANGE_FIELD]).toEqual({
      changeId,
      phase: 'carry',
      hostIds: [R, X],
      startedAtMs: clock,
    })
    // Nothing else moved: the declaration in force is the old one.
    expect(firestore.read(`orgs/${ORG}`)?.['consentGroups']).toEqual(GROUP)
    expect(job(firestore, changeId)).toMatchObject({
      status: 'running',
      step: 'carry',
      phase: 'carry',
      lines: ['Dissolved consent group "Northwind"'],
      plan: { carries: [{ toHostId: R, fromHostId: X }, { toHostId: X, fromHostId: R }] },
    })
    expect(logged).toEqual(['Started a consent group change: Dissolved consent group "Northwind"'])
  })

  it('refuses a declaration that changed since the editor rendered it, with the current one', async () => {
    const firestore = world()
    const started = await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      expected: null,
      groups: [],
      ...ctx(firestore),
    })
    expect(started).toEqual({
      ok: false,
      status: 409,
      body: { error: 'Someone else changed consent groups while you were editing', current: GROUP },
    })
  })

  it('refuses a second change while one is in flight, naming it', async () => {
    const firestore = world()
    const first = (await startConsentGroupChange({ orgId: ORG, actor: ACTOR, ...LEAVE, ...ctx(firestore) })) as {
      changeId: string
    }
    const second = await startConsentGroupChange({ orgId: ORG, actor: ACTOR, ...LEAVE, ...ctx(firestore) })
    expect(second).toEqual({
      ok: false,
      status: 409,
      body: { error: 'A consent group change is still finishing', changeId: first.changeId, phase: 'carry' },
    })
  })

  it('refuses an invalid declaration with every error, and a missing org', async () => {
    const firestore = world()
    expect(
      await startConsentGroupChange({
        orgId: ORG,
        actor: ACTOR,
        expected: GROUP,
        groups: [{ name: '', hostIds: [X] }],
        ...ctx(firestore),
      }),
    ).toEqual({
      ok: false,
      status: 400,
      body: {
        error: 'Those consent groups cannot be saved',
        errors: [
          { code: 'name-empty', groupIndex: 0 },
          { code: 'too-few-sites', groupIndex: 0 },
        ],
      },
    })
    expect(
      await startConsentGroupChange({ orgId: 'nope', actor: ACTOR, ...LEAVE, ...ctx(firestore) }),
    ).toMatchObject({ ok: false, status: 404 })
  })

  it('I7: of two starts from the same rendering, exactly one wins', async () => {
    const firestore = world()
    const results = await Promise.all([
      startConsentGroupChange({ orgId: ORG, actor: ACTOR, ...LEAVE, ...ctx(firestore) }),
      startConsentGroupChange({ orgId: ORG, actor: ACTOR, ...LEAVE, ...ctx(firestore) }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ status: 409 }),
    ])
  })
})

describe('running a change', () => {
  it('I4: carries and both catch-ups finish before the flip, and re-homes after it', async () => {
    const firestore = world()
    const calls: Array<Record<string, unknown>> = []
    recordingParticipant(firestore, calls)
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }

    const result = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })

    // The carry and the pre-flip catch-up saw the OLD declaration, with the
    // platform carry already written; the post-flip catch-up and the re-home
    // saw the new one.
    const carries = calls.filter((call) => call.phase === 'carry')
    const rehomes = calls.filter((call) => call.phase === 'rehome')
    expect(carries).toHaveLength(6)
    expect(carries.every((call) => call.carriedRow === true)).toBe(true)
    expect(carries.map((call) => (call.declared === null ? 'new' : 'old'))).toEqual([
      'old',
      'old',
      'old',
      'old',
      'new',
      'new',
    ])
    expect(JSON.stringify(carries[0].declared)).toBe(JSON.stringify(GROUP))
    expect(rehomes).toHaveLength(2)
    expect(rehomes.every((call) => call.declared === null)).toBe(true)
    // The participant was resumed from its own cursor.
    expect(carries.map((call) => call.cursor)).toEqual([null, 'page-2', null, 'page-2', null, 'page-2'])

    // Both directions carried.
    expect(firestore.read(`hosts/${R}/suppressions/k-x`)).toMatchObject({
      reason: 'unsubscribe',
      carriedFromHostId: X,
    })
    expect(firestore.read(`hosts/${X}/topicOptOuts/k-r`)?.['topics']).toMatchObject({
      newsletter: { resubscribedAt: null, carriedFromHostId: R },
    })

    // Waiting for the sweep: the marker says so, and nothing is leased.
    expect(result).toMatchObject({
      ok: true,
      status: {
        changeId,
        phase: 'sweep',
        done: false,
        progress: {
          step: 'sweep-wait',
          declaredAtMs: clock,
          sweepAtMs: clock + CONSENT_GROUP_SWEEP_DELAY_MS,
          leaseUntilMs: null,
          counts: { siteSuppressions: 1, topicOptOuts: 1, paces: 0 },
          sitesReceiving: 2,
          plugins: { records: { combined: 8 } },
        },
      },
    })
    expect(firestore.read(`orgs/${ORG}`)?.[CONSENT_GROUPS_CHANGE_FIELD]).toMatchObject({
      phase: 'sweep',
      declaredAtMs: clock,
    })
    expect(logged).toEqual([
      'Started a consent group change: Dissolved consent group "Northwind"',
      'Dissolved consent group "Northwind"',
    ])
  })

  it('sweeps only once the delay has passed, then clears the marker and says what it did', async () => {
    const firestore = world()
    const calls: Array<Record<string, unknown>> = []
    recordingParticipant(firestore, calls)
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    await advanceConsentGroupChange({ orgId: ORG, changeId, deadlineMs: clock + 60_000, ...ctx(firestore) })

    clock += CONSENT_GROUP_SWEEP_DELAY_MS - 1
    const early = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })
    expect(early).toMatchObject({ status: { progress: { step: 'sweep-wait' } } })
    expect(calls.filter((call) => call.phase === 'sweep')).toHaveLength(0)

    clock += 1
    const done = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })
    expect(done).toMatchObject({ status: { phase: 'done', done: true, progress: { status: 'done' } } })
    expect(calls.filter((call) => call.phase === 'sweep')).toHaveLength(2)
    expect(firestore.read(`orgs/${ORG}`)?.[CONSENT_GROUPS_CHANGE_FIELD]).toBeUndefined()
    expect(firestore.read(`orgs/${ORG}`)?.['consentGroups']).toBeUndefined()
    // The sweep's full pass found everything already carried.
    expect(job(firestore, changeId).counts).toEqual({ siteSuppressions: 1, topicOptOuts: 1, paces: 0 })
    expect(logged[logged.length - 1]).toBe(
      'Finished a consent group change: 2 opt-outs copied to 2 sites; 10 records combined',
    )
  })

  it('never flips while a participant cannot carry, and shows the stall once', async () => {
    const firestore = world()
    registerPluginConsentGroupParticipant(
      {
        preview: async () => [],
        run: async () => {
          throw new Error('index missing for pat@example.com')
        },
      },
      { pluginId: 'records' },
    )
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }

    let last: unknown
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await advanceConsentGroupChange({
        orgId: ORG,
        changeId,
        deadlineMs: clock + 60_000,
        ...ctx(firestore),
      })
    }
    expect(firestore.read(`orgs/${ORG}`)?.['consentGroups']).toEqual(GROUP)
    expect(last).toMatchObject({
      status: {
        phase: 'carry',
        done: false,
        progress: {
          step: 'carry',
          stalled: true,
          failures: 6,
          lastError: 'index missing for [address]',
          leaseUntilMs: null,
        },
      },
    })
    expect(logged.filter((line) => line.startsWith('A consent group change stopped'))).toEqual([
      'A consent group change stopped with an error; it will try again',
    ])
  })

  it('refuses to flip when the stored declaration moved under the change', async () => {
    const firestore = world()
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    // A hand edit of the stored value, outside every route.
    firestore.seed(`orgs/${ORG}`, {
      ...firestore.read(`orgs/${ORG}`),
      consentGroups: { g1: { name: 'Northwind', hostIds: [R, S] } },
    })
    const result = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })
    expect(result).toMatchObject({
      status: {
        progress: {
          step: 'declare',
          failures: 1,
          lastError: 'The consent groups changed outside this change, so the new groups were not saved',
        },
      },
    })
    expect(firestore.read(`orgs/${ORG}`)?.['consentGroups']).toEqual({
      g1: { name: 'Northwind', hostIds: [R, S] },
    })
  })

  it('lets one caller work a change at a time, and the next take over a lapsed lease', async () => {
    const firestore = world()
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    // A caller that claimed the job and died without releasing it.
    firestore.seed(`orgs/${ORG}/consentGroupChanges/${changeId}`, {
      ...firestore.read(`orgs/${ORG}/consentGroupChanges/${changeId}`),
      lease: { owner: 'dead-caller', untilMs: clock + CONSENT_GROUP_CHANGE_LEASE_MS },
    })
    const blocked = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })
    expect(blocked).toMatchObject({
      status: { progress: { step: 'carry', leaseUntilMs: clock + CONSENT_GROUP_CHANGE_LEASE_MS } },
    })
    expect(firestore.read(`hosts/${R}/suppressions/k-x`)).toBeUndefined()

    clock += CONSENT_GROUP_CHANGE_LEASE_MS + 1
    const resumed = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })
    expect(resumed).toMatchObject({ status: { progress: { step: 'sweep-wait' } } })
    expect(firestore.read(`hosts/${R}/suppressions/k-x`)).toBeDefined()
  })

  it('yields when a participant makes no progress, rather than spinning on it', async () => {
    const firestore = world()
    let calls = 0
    registerPluginConsentGroupParticipant(
      {
        preview: async () => [],
        // Out of time before its first page, every time it is asked.
        run: async () => {
          calls += 1
          return { done: false, cursor: null, counts: {} }
        },
      },
      { pluginId: 'records' },
    )
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    const result = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })
    expect(calls).toBe(1)
    expect(result).toMatchObject({
      status: { progress: { step: 'carry', failures: 0, leaseUntilMs: null } },
    })
    expect(firestore.read(`orgs/${ORG}`)?.['consentGroups']).toEqual(GROUP)
  })

  it('stops at the deadline and resumes where it stopped', async () => {
    const firestore = world()
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    // A deadline already inside the safety margin does no work at all.
    const none = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 1_000,
      ...ctx(firestore),
    })
    expect(none).toMatchObject({ status: { progress: { step: 'carry', leaseUntilMs: null } } })
    expect(firestore.read(`hosts/${R}/suppressions/k-x`)).toBeUndefined()
  })

  it('runs a rename as the flip and the finish alone', async () => {
    const firestore = world()
    const calls: Array<Record<string, unknown>> = []
    recordingParticipant(firestore, calls)
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      expected: GROUP,
      groups: [{ id: 'g1', name: 'Northwind Goods', hostIds: [R, X] }],
      ...ctx(firestore),
    })) as { changeId: string }
    const result = await advanceConsentGroupChange({
      orgId: ORG,
      changeId,
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
    })
    expect(result).toMatchObject({
      status: { phase: 'done', done: true, progress: { stepIndex: 2, stepCount: 2, sweepAtMs: null } },
    })
    expect(calls).toEqual([])
    expect(firestore.read(`orgs/${ORG}`)).toMatchObject({
      consentGroups: { g1: { name: 'Northwind Goods', hostIds: [R, X] } },
    })
    expect(firestore.read(`orgs/${ORG}`)?.[CONSENT_GROUPS_CHANGE_FIELD]).toBeUndefined()
    expect(job(firestore, changeId).lease).toBeNull()
    expect(logged).toEqual([
      'Started a consent group change: Renamed consent group "Northwind" to "Northwind Goods"',
      'Renamed consent group "Northwind" to "Northwind Goods"',
      'Finished a consent group change',
    ])
  })
})

describe('canceling a change', () => {
  it('stops a change before the flip, keeping every refusal already carried', async () => {
    const firestore = world()
    // A participant that cannot carry holds the change in its carry step,
    // after the platform carries have already copied their rows.
    registerPluginConsentGroupParticipant(
      {
        preview: async () => [],
        run: async () => {
          throw new Error('not yet')
        },
      },
      { pluginId: 'records' },
    )
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    await advanceConsentGroupChange({ orgId: ORG, changeId, deadlineMs: clock + 60_000, ...ctx(firestore) })
    expect(firestore.read(`hosts/${R}/suppressions/k-x`)).toBeDefined()

    const stopped = await cancelConsentGroupChange({ orgId: ORG, changeId, actor: ACTOR, ...ctx(firestore) })
    expect(stopped).toMatchObject({ ok: true, status: { phase: 'canceled', done: true } })
    expect(firestore.read(`orgs/${ORG}`)?.[CONSENT_GROUPS_CHANGE_FIELD]).toBeUndefined()
    expect(firestore.read(`orgs/${ORG}`)?.['consentGroups']).toEqual(GROUP)
    // The carried refusal stays: it only honors an opt-out on one more site.
    expect(firestore.read(`hosts/${R}/suppressions/k-x`)).toMatchObject({ carriedFromHostId: X })
    expect(logged[logged.length - 1]).toBe('Canceled a consent group change before it took effect')
    // A canceled change no longer advances, and a new one may start.
    expect(
      await advanceConsentGroupChange({ orgId: ORG, changeId, deadlineMs: clock + 60_000, ...ctx(firestore) }),
    ).toMatchObject({ status: { phase: 'canceled' } })
    expect(
      await startConsentGroupChange({ orgId: ORG, actor: ACTOR, ...LEAVE, ...ctx(firestore) }),
    ).toMatchObject({ ok: true })
  })

  it('refuses a cancel after the flip, and an unknown change', async () => {
    const firestore = world()
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    await advanceConsentGroupChange({ orgId: ORG, changeId, deadlineMs: clock + 60_000, ...ctx(firestore) })
    expect(
      await cancelConsentGroupChange({ orgId: ORG, changeId, actor: ACTOR, ...ctx(firestore) }),
    ).toEqual({
      ok: false,
      status: 409,
      body: { error: 'This change has already taken effect', changeId, phase: 'sweep' },
    })
    expect(
      await cancelConsentGroupChange({ orgId: ORG, changeId: 'nope', actor: ACTOR, ...ctx(firestore) }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(await readConsentGroupChangeStatus({ orgId: ORG, changeId: 'nope', ...ctx(firestore) })).toBeNull()
  })
})

describe('the cron backstop', () => {
  it('advances every change in flight, and lists them on a dry run', async () => {
    const firestore = world()
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    expect(
      await advanceDueConsentGroupChanges({ deadlineMs: clock + 60_000, dryRun: true, ...ctx(firestore) }),
    ).toEqual([{ orgId: ORG, changeId, phase: 'carry', outcome: 'listed' }])
    expect(job(firestore, changeId).step).toBe('carry')

    const reports = await advanceDueConsentGroupChanges({
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
      lockedOut: async () => false,
    })
    expect(reports).toMatchObject([
      { orgId: ORG, changeId, outcome: 'advanced', status: { progress: { step: 'sweep-wait' } } },
    ])
  })

  it('pauses a locked organization and clears a marker whose job is gone', async () => {
    const firestore = world({
      'orgs/org-2': {
        hosts: { a: true, b: true },
        [CONSENT_GROUPS_CHANGE_FIELD]: { changeId: 'lost', phase: 'rehome', hostIds: ['a'], startedAtMs: 1 },
      },
    })
    const { changeId } = (await startConsentGroupChange({
      orgId: ORG,
      actor: ACTOR,
      ...LEAVE,
      ...ctx(firestore),
    })) as { changeId: string }
    const reports = await advanceDueConsentGroupChanges({
      deadlineMs: clock + 60_000,
      ...ctx(firestore),
      lockedOut: async () => true,
    })
    expect(reports).toEqual([
      { orgId: ORG, changeId, phase: 'carry', outcome: 'locked' },
      { orgId: 'org-2', changeId: 'lost', phase: 'rehome', outcome: 'orphaned' },
    ])
    expect(firestore.read('orgs/org-2')?.[CONSENT_GROUPS_CHANGE_FIELD]).toBeUndefined()
    expect(job(firestore, changeId).step).toBe('carry')
  })
})

describe('the preview', () => {
  it('counts and words what a change would do, and writes nothing', async () => {
    const firestore = world({
      [`hosts/${X}/emailFrequency/k1`]: { email: 'pat@example.com', cadence: 'weekly', cadenceSetAtMs: 1 },
      [`orgs/${ORG}/members/editor`]: { role: 'editor', allHosts: false, hostAccess: { [X]: 'editor' } },
      [`orgs/${ORG}/members/owner`]: { role: 'owner' },
    })
    registerPluginConsentGroupParticipant(
      {
        preview: async ({ plan }: { plan: ConsentGroupChangePlan }) => [
          { id: 'records.combine', text: `${plan.flows.length} holders move`, count: 40, severity: 'info' },
        ],
        run: async () => ({ done: true, cursor: null, counts: {} }),
      },
      { pluginId: 'records' },
    )
    firestore.resetWrites()
    const result = await previewConsentGroupChange({
      orgId: ORG,
      expected: GROUP,
      // S joins Northwind.
      groups: [{ id: 'g1', name: 'Northwind', hostIds: [R, S, X] }],
      ...ctx(firestore),
    })
    expect(firestore.writes()).toBe(0)
    expect(result).toMatchObject({
      ok: true,
      preview: {
        before: GROUP,
        after: { g1: { name: 'Northwind', hostIds: [R, S, X] } },
        discarded: [],
        lines: [{ kind: 'added', hostId: S, text: 'Added Bookings to consent group "Northwind"' }],
        disclosures: [
          {
            groupId: 'g1',
            before: "You'll receive marketing email from Northwind, which covers 2 sites.",
            after: "You'll receive marketing email from Northwind, which covers 3 sites.",
          },
        ],
        carries: [],
        // S starts honoring X's unsubscribe and R's opt-out; R and X start
        // honoring S's, of which there are none.
        inherited: [
          { hostId: R, refusals: 0 },
          { hostId: S, refusals: 2 },
          { hostId: X, refusals: 0 },
        ],
        pendingHolds: [],
        // The editor opens only X of the three.
        partialAccessMembers: 1,
        forwardPolicyWarning: null,
        participants: [
          { pluginId: 'records', lines: [{ id: 'records.combine', text: '1 holders move', count: 40 }] },
        ],
        capturesDisclosing: ['form'],
        estimate: 'under-a-minute',
      },
    })
  })

  it('counts each carry, the pending holds with the switch on, and warns under a forward policy', async () => {
    const firestore = world({
      [`hosts/${X}/topicOptOuts/k-p`]: {
        email: 'sam@example.com',
        topics: { newsletter: { pendingAt: 5, confirmedAt: null } },
        updatedAt: at(5),
      },
    })
    firestore.seed(`orgs/${ORG}`, {
      ...firestore.read(`orgs/${ORG}`),
      consentGroupsAwaitConfirmation: true,
      marketingConsentPolicy: { mode: 'forward', enforceFromMs: 42 },
      consentGroups: { ...GROUP, broken: { name: '', hostIds: [S] } },
    })
    const result = await previewConsentGroupChange({
      orgId: ORG,
      expected: { ...GROUP, broken: { name: '', hostIds: [S] } },
      groups: [],
      ...ctx(firestore),
    })
    expect(result).toMatchObject({
      ok: true,
      preview: {
        discarded: ['broken'],
        carries: [
          { toHostId: R, fromHostId: X, siteSuppressions: 1, topicOptOuts: 1, paces: 0 },
          { toHostId: X, fromHostId: R, siteSuppressions: 0, topicOptOuts: 1, paces: 0 },
        ],
        pendingHolds: [{ hostId: X, topicId: 'newsletter', count: 1, releasedHostIds: [R] }],
        // Nobody joins a group, so the forward policy grandfathers nobody new.
        forwardPolicyWarning: null,
      },
    })

    const joining = await previewConsentGroupChange({
      orgId: ORG,
      expected: { ...GROUP, broken: { name: '', hostIds: [S] } },
      groups: [{ id: 'g1', name: 'Northwind', hostIds: [R, S, X] }],
      ...ctx(firestore),
    })
    expect(joining).toMatchObject({
      // Every site that gains a sibling reaches the sibling's earlier captures.
      preview: { forwardPolicyWarning: { hostIds: [R, S, X], enforceFromMs: 42 } },
    })
  })

  it('is refused exactly as the start would be', async () => {
    const firestore = world()
    expect(
      await previewConsentGroupChange({ orgId: ORG, expected: null, groups: [], ...ctx(firestore) }),
    ).toMatchObject({ ok: false, status: 409 })
    expect(
      await previewConsentGroupChange({ orgId: ORG, expected: GROUP, groups: [{ id: 'g1', ...GROUP.g1 }], ...ctx(firestore) }),
    ).toMatchObject({ ok: false, status: 400, body: { errors: [{ code: 'no-change' }] } })
  })
})
