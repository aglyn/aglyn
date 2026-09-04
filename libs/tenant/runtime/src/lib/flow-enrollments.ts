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
 * WHERE A PERSON WAITS, between one step of a flow and the next.
 *
 * An action used to be trigger → immediate steps, start to finish inside the
 * request that emitted the event. A `wait` step ends that: the run stops, and
 * something else has to pick it up minutes or weeks later. This module is the
 * something else's memory.
 *
 * ## The scheduling model, and why it survives a deploy
 *
 * There is no timer anywhere. A wait is a ROW — `resumeAtMs` on a document in
 * `hosts/{hostId}/flowEnrollments` — and the resume is a query for rows whose
 * time has come, run by the platform job beat that already exists. Nothing is
 * held in a process, so nothing is lost when the process ends: a deploy, a
 * restart, a cold start and a region failover all leave the row exactly where
 * it was, and the next beat finds it. The two worked examples in this repo
 * take the same shape for the same reason — `campaign-process-scheduled.ts`
 * claims `status: 'scheduled'` campaigns whose `sendAtMs` has passed, and the
 * abandoned-checkout scan re-reads any checkout it did not stamp.
 *
 * A beat that dies mid-resume is the case worth stating. The claim below flips
 * `waiting` → `running` in a transaction, so a second beat cannot pick up the
 * same enrollment; and a `running` row whose beat never came back is re-armed
 * by {@link FLOW_CLAIM_STALE_MS}, which is the difference between "somebody is
 * working on this" and "somebody died holding this".
 *
 * ## What it costs, which is not "every enrollment on every beat"
 *
 * The sweep reads DUE rows and only due rows: the query carries
 * `resumeAtMs <= now`, so a site with ten thousand people waiting three days
 * costs nothing on the beats before those three days are up. That is the whole
 * difference between this and the naive design, which re-reads every enrolled
 * person on every beat to ask whether their time has come.
 *
 * On top of that, {@link FLOW_RESUME_SCAN_BUDGET} bounds one beat's work and a
 * cursor resumes it — the shape `dynamic-list-materialize.ts` uses. The budget
 * matters even though the query is already narrow, because a due row that
 * cannot be acted on (a locked host) stays due: without paging past it, one
 * wall of locked rows at the head of the queue would starve every enrollment
 * behind it for as long as the lock lasted.
 *
 * ## ⛔ A BUDGET NEVER DROPS AN ENROLLMENT
 *
 * Running out of budget stops the sweep where it is. It never marks an
 * enrollment done, never advances its step, and never deletes it — the row
 * stays `waiting` and overdue, and the next beat starts again from the front
 * of the queue, which is where the oldest overdue work is. The same rule the
 * list materializer states: a bound on WORK is not a bound on PEOPLE.
 */

import {
  type HostAction,
  type HostActionStep,
  personKey,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { PluginJobHostGate } from '@aglyn/aglyn/server'

/** `hosts/{hostId}/flowEnrollments/{actionId__personKey}`. */
export const FLOW_ENROLLMENTS_SUBCOLLECTION = 'flowEnrollments'

/**
 * Documents one sweep may READ across every site.
 *
 * A bound on work, not on membership — see the note above. Sized well past a
 * normal beat's due queue so the ordinary case never pages at all, and far
 * short of what one API invocation should spend.
 */
export const FLOW_RESUME_SCAN_BUDGET = 500

/** Due enrollments read per page. */
const PAGE_SIZE = 50

/**
 * How long a claim may go unfinished before another beat may take it.
 *
 * A `running` row is one a beat is part-way through. If that beat's process
 * ends — a deploy mid-resume, a function timeout, an unhandled throw that
 * escaped the isolation — nothing ever clears the flag, and without this the
 * enrollment would be stranded `running` for ever: not waiting, so no sweep
 * finds it; not done, so nobody is told.
 *
 * Ten minutes is far longer than a resume takes (a handful of Firestore reads
 * and at most one email) and far shorter than the shortest wait anybody
 * authors, so the only thing it can re-arm is a claim nobody is holding.
 *
 * The cost of getting it wrong is a step running twice, which is why the
 * window is generous rather than tight.
 */
export const FLOW_CLAIM_STALE_MS = 10 * 60_000

export type FlowEnrollmentStatus = 'waiting' | 'running'

/**
 * Why an enrollment ended. Recorded on the run history, never on the
 * enrollment — the row is deleted when the flow ends, so the activity
 * collection is where "what happened to this person" lives.
 */
export type FlowEnrollmentEnding =
  /** Every remaining step ran. */
  | 'completed'
  /** An `exitFlow` step, or a guard that ended the run. */
  | 'exited'
  /** The action was deleted, disabled, or lost its entitlement. */
  | 'flow-stopped'

export interface FlowEnrollment {
  hostId: string
  actionId: string
  actionName: string
  status: FlowEnrollmentStatus
  /** When this flow continues. ALWAYS set — the sweep orders on it. */
  resumeAtMs: number
  /** Index into {@link steps} of the step that runs on resume. */
  nextStepIndex: number
  /**
   * THE FLOW AS IT WAS WHEN THIS PERSON ENTERED IT.
   *
   * Not a reference to the action's current steps, and this is the whole
   * answer to "what happens to a flow somebody is already waiting inside".
   * `nextStepIndex` is a position in a LIST, and an author who reorders,
   * inserts or deletes a step moves every position after it — so resuming a
   * three-day wait against the edited list would deliver whatever now happens
   * to sit at index 4. That is not a changed flow, it is a scrambled one, and
   * the person it happens to is the one who cannot see it.
   *
   * So an edit applies to everyone who enrolls AFTER it, and nobody who is
   * already inside. The trade is that a merchant who fixes a typo in step 3
   * does not fix it for the people mid-wait; the alternative trade is sending
   * them a step from a different flow, which is worse and silent.
   *
   * Bounded by `ACTION_MAX_STEPS`, so the snapshot is ten small objects.
   */
  steps: HostActionStep[]
  /** The event a `waitForEvent` is watching for; absent for a plain wait. */
  awaitingEvent?: string | null
  /** `sha256` of the person's address — the wake lookup key. */
  personKey: string
  email: string
  /** The trigger payload, carried forward so later steps see the same scope. */
  payload: Record<string, unknown>
  /** The event that started the flow, for the run-history line. */
  event: string
  enrolledAtMs: number
  updatedAtMs: number
  /** How many times this enrollment has been picked up. */
  resumes: number
  /** Set while `running`; how {@link FLOW_CLAIM_STALE_MS} is measured. */
  claimedAtMs?: number
}

/**
 * ONE LIVE ENROLLMENT PER PERSON PER FLOW, by construction.
 *
 * The document id is derived rather than generated, so a second concurrent
 * enrollment is not a race to detect — it is a write to a document that
 * already exists. A shopper who abandons three carts in an hour gets one
 * recovery sequence, not three overlapping ones, and the guarantee holds
 * across processes because it is Firestore's and not a lock of ours.
 *
 * DELIBERATE, and reversible: a flow that genuinely wants concurrent
 * enrollments would key on something narrower than the person (the cart, the
 * order), which is a change to this function and to nothing else.
 */
export function flowEnrollmentId(actionId: string, key: string): string {
  return `${actionId}__${key}`
}

function enrollmentsRef(
  hostId: string,
  firestore?: any,
): FirebaseFirestore.CollectionReference {
  return (firestore ?? firebaseAdmin.app().firestore())
    .collection('hosts')
    .doc(hostId)
    .collection(FLOW_ENROLLMENTS_SUBCOLLECTION)
}

export interface EnrollInFlowOptions {
  hostId: string
  actionId: string
  action: Pick<HostAction, 'name' | 'steps'>
  /** The address the flow is about. A flow with no person cannot wait. */
  email: string
  event: string
  payload: Record<string, unknown>
  /** Index of the step that runs when the wait ends. */
  nextStepIndex: number
  resumeAtMs: number
  awaitingEvent?: string | null
  nowMs?: number
  firestore?: any
}

export type EnrollInFlowResult =
  | { enrolled: true; id: string }
  | { enrolled: false; reason: 'no-person' | 'already-waiting' }

/**
 * Suspends a run, durably.
 *
 * Refuses rather than improvises when there is nobody to wait for. A flow
 * that waits is a flow that continues later for a PERSON — it is how the
 * enrollment is keyed, how a `waitForEvent` is woken, and who the next step's
 * email is addressed to. An anonymous wait would have no dedupe key, so a
 * page-view trigger on a busy site would mint an enrollment per visit; and
 * nothing downstream could use it. Saying so is better than silently
 * enrolling nobody.
 */
export async function enrollInFlow(
  options: EnrollInFlowOptions,
): Promise<EnrollInFlowResult> {
  const key = personKey(options.email)
  if (!key) return { enrolled: false, reason: 'no-person' }
  const nowMs = options.nowMs ?? Date.now()
  const ref = enrollmentsRef(options.hostId, options.firestore).doc(
    flowEnrollmentId(options.actionId, key),
  )
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  return await firestore.runTransaction(
    async (transaction: FirebaseFirestore.Transaction) => {
      const existing = await transaction.get(ref)
      /*
       * A row that is `waiting` or freshly `running` belongs to a live
       * enrollment and this one is a duplicate. A STALE `running` row is a
       * claim nobody is holding (see FLOW_CLAIM_STALE_MS) and a completed
       * flow deletes its row, so anything else is free to be overwritten —
       * which is what lets the same person go through the same welcome series
       * again next year.
       */
      if (existing.exists) {
        const status = existing.get('status')
        const claimedAtMs = Number(existing.get('claimedAtMs') ?? 0)
        const live =
          status === 'waiting' ||
          (status === 'running' && nowMs - claimedAtMs < FLOW_CLAIM_STALE_MS)
        if (live) {
          return { enrolled: false, reason: 'already-waiting' as const }
        }
      }
      const enrollment: FlowEnrollment = {
        hostId: options.hostId,
        actionId: options.actionId,
        actionName: String(options.action.name ?? ''),
        status: 'waiting',
        resumeAtMs: options.resumeAtMs,
        nextStepIndex: options.nextStepIndex,
        steps: [...(options.action.steps ?? [])],
        personKey: key,
        email: String(options.email).trim().toLowerCase(),
        payload: options.payload ?? {},
        event: options.event,
        enrolledAtMs: nowMs,
        updatedAtMs: nowMs,
        resumes: 0,
        ...(options.awaitingEvent
          ? { awaitingEvent: options.awaitingEvent }
          : { awaitingEvent: null }),
      }
      // `set`, not `create`: the transaction above has already decided this id
      // is free, and a completed flow's deleted row may be re-enrolled.
      transaction.set(ref, enrollment)
      return { enrolled: true as const, id: ref.id }
    },
  )
}

/**
 * Takes an enrollment out of the queue for this beat, or answers null.
 *
 * The claim and the read are one transaction, so two beats — an overlapping
 * schedule, a retried invocation, two regions — cannot both resume the same
 * person. `campaign-process-scheduled.ts` claims a due campaign exactly this
 * way and for exactly this reason.
 */
export async function claimFlowEnrollment(
  ref: FirebaseFirestore.DocumentReference,
  options?: { nowMs?: number; firestore?: any },
): Promise<FlowEnrollment | null> {
  const nowMs = options?.nowMs ?? Date.now()
  const firestore =
    options?.firestore ?? ref.firestore ?? firebaseAdmin.app().firestore()
  return await firestore.runTransaction(
    async (transaction: FirebaseFirestore.Transaction) => {
      const fresh = await transaction.get(ref)
      if (!fresh.exists) return null
      const status = fresh.get('status')
      const claimedAtMs = Number(fresh.get('claimedAtMs') ?? 0)
      const claimable =
        status === 'waiting' ||
        (status === 'running' && nowMs - claimedAtMs >= FLOW_CLAIM_STALE_MS)
      if (!claimable) return null
      transaction.update(ref, {
        status: 'running',
        claimedAtMs: nowMs,
        updatedAtMs: nowMs,
      })
      return { ...(fresh.data() as FlowEnrollment), status: 'running' }
    },
  )
}

/**
 * Puts a claimed enrollment back without having run it.
 *
 * SKIPPED, NOT DROPPED. Used when the resume cannot proceed for a reason a
 * later beat may pass — the platform's hourly send ceiling had no room, the
 * recipient's own frequency window is full — so the step is attempted again
 * rather than lost. `retryAtMs` pushes the row down the queue so it does not
 * spin on the same refusal every minute.
 */
export async function deferFlowEnrollment(
  ref: FirebaseFirestore.DocumentReference,
  retryAtMs: number,
  nowMs = Date.now(),
): Promise<void> {
  await ref
    .set(
      {
        status: 'waiting',
        resumeAtMs: retryAtMs,
        claimedAtMs: null,
        updatedAtMs: nowMs,
      },
      { merge: true },
    )
    .catch(() => undefined)
}

/** Advances a claimed enrollment to the next wait, keeping it in the queue. */
export async function advanceFlowEnrollment(
  ref: FirebaseFirestore.DocumentReference,
  update: {
    nextStepIndex: number
    resumeAtMs: number
    awaitingEvent?: string | null
    payload?: Record<string, unknown>
  },
  nowMs = Date.now(),
): Promise<void> {
  await ref
    .set(
      {
        status: 'waiting',
        claimedAtMs: null,
        updatedAtMs: nowMs,
        resumes: firebaseAdmin.firestore.FieldValue.increment(1),
        nextStepIndex: update.nextStepIndex,
        resumeAtMs: update.resumeAtMs,
        awaitingEvent: update.awaitingEvent ?? null,
        ...(update.payload ? { payload: update.payload } : {}),
      },
      { merge: true },
    )
    .catch(() => undefined)
}

/**
 * Ends an enrollment by DELETING it.
 *
 * The row is live state, not a record. What happened to this person is
 * already written to `hosts/{hostId}/activity` — the same run history every
 * immediate action writes — so keeping a `done` row would be a second,
 * shorter answer to a question that is already answered, growing for ever in
 * a collection the sweep has to index.
 *
 * Deleting is also what lets the same person enter the same flow again: the
 * id is derived from the person, so a tombstone would be a permanent refusal
 * to ever run this sequence for them a second time.
 */
export async function endFlowEnrollment(
  ref: FirebaseFirestore.DocumentReference,
): Promise<void> {
  await ref.delete().catch(() => undefined)
}

/**
 * The enrollments this person's event should wake, on this site.
 *
 * Keyed, bounded and cheap: three equality filters and a small limit, which
 * Firestore serves by merging single-field indexes. This is what keeps
 * `waitForEvent` off a polling design — nothing scans the enrolled population
 * looking for a match, the event arrives already knowing who it is about.
 *
 * The CALLER decides whether to ask at all. `runEventActions` fires on every
 * page view of every published site, so asking on every event would be a
 * query per visitor; it asks only when the payload names a person, which a
 * page view does not.
 */
export async function findFlowEnrollmentsAwaiting(options: {
  hostId: string
  event: string
  email: string
  firestore?: any
  limit?: number
}): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const key = personKey(options.email)
  const event = String(options.event ?? '').trim()
  if (!key || !event || !options.hostId) return []
  try {
    const snapshot = await enrollmentsRef(options.hostId, options.firestore)
      .where('awaitingEvent', '==', event)
      .where('personKey', '==', key)
      .where('status', '==', 'waiting')
      .limit(options.limit ?? 5)
      .get()
    return snapshot.docs
  } catch (error) {
    console.error('[flow] awaiting-event lookup failed', options.hostId, error)
    return []
  }
}

/** Where a partial sweep stopped, so the next beat resumes rather than restarts. */
export interface FlowSweepCursor {
  /** Full document path of the last enrollment read. */
  path: string
}

export interface FlowSweepResult {
  /** Due enrollments read, against the budget. */
  scanned: number
  /** Enrollments this beat claimed and ran. */
  resumed: number
  /** Rows left untouched because their site is locked. */
  skippedLocked: number
  /** Rows another beat already held. */
  skippedClaimed: number
  /** False when the scan budget ran out — `cursor` says where to resume. */
  complete: boolean
  cursor: FlowSweepCursor | null
}

/**
 * One pass over the flows whose wait has ended.
 *
 * The RESUME itself is injected. Running a step needs the action executor,
 * which needs entitlements, datasets, webhooks and the mail path; keeping it
 * out of this function is what lets the scheduling contract — due-ness, the
 * claim, the budget, the lock — be exercised without any of that.
 */
export async function sweepDueFlowEnrollments(
  gate: PluginJobHostGate,
  options: {
    resume: (
      enrollment: FlowEnrollment,
      ref: FirebaseFirestore.DocumentReference,
    ) => Promise<void>
    nowMs?: number
    scanBudget?: number
    cursor?: FlowSweepCursor | null
    firestore?: any
  },
): Promise<FlowSweepResult> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = options.nowMs ?? Date.now()
  const budget = options.scanBudget ?? FLOW_RESUME_SCAN_BUDGET
  const result: FlowSweepResult = {
    scanned: 0,
    resumed: 0,
    skippedLocked: 0,
    skippedClaimed: 0,
    complete: true,
    cursor: null,
  }
  let after: FirebaseFirestore.DocumentSnapshot | null = options.cursor?.path
    ? await firestore
        .doc(options.cursor.path)
        .get()
        .catch(() => null)
    : null

  for (;;) {
    /*
     * Ordered by `resumeAtMs`, which every writer in this module sets on
     * every write. That is load-bearing twice over: an `orderBy` on a field
     * DROPS documents that lack it, so a writer that ever omitted it would
     * make those enrollments invisible to the only thing that resumes them;
     * and ordering oldest-due-first is what makes a budget fair, because the
     * work a short beat leaves behind is the newest rather than whichever
     * rows Firestore happened to return.
     */
    /*
     * The page is capped by what is LEFT of the budget, not only by
     * `PAGE_SIZE`. Checking the budget between pages would let a run whose
     * budget is smaller than one page read the whole page first — the budget
     * would then describe how much was reported rather than how much was
     * read, which is the opposite of what a read budget is for.
     */
    const remaining = budget - result.scanned
    if (remaining <= 0) break
    let query = firestore
      .collectionGroup(FLOW_ENROLLMENTS_SUBCOLLECTION)
      .where('status', '==', 'waiting')
      .where('resumeAtMs', '<=', nowMs)
      .orderBy('resumeAtMs')
      .limit(Math.min(PAGE_SIZE, remaining))
    if (after) query = query.startAfter(after)
    const page = await query.get()
    if (page.empty) break

    for (const doc of page.docs) {
      result.scanned += 1
      after = doc
      const hostId =
        String(doc.get('hostId') ?? '') || (doc.ref.parent.parent?.id ?? '')
      if (!hostId) continue
      /*
       * LOCKDOWN, first in the loop body and before any write. `continue`
       * leaves the row `waiting` and overdue, so the flow resumes on the
       * first beat after the lift rather than being cancelled by a pause.
       */
      if (await gate.isLocked(hostId)) {
        result.skippedLocked += 1
        continue
      }
      const enrollment = await claimFlowEnrollment(doc.ref, { nowMs })
      if (!enrollment) {
        result.skippedClaimed += 1
        continue
      }
      try {
        await options.resume(enrollment, doc.ref)
        result.resumed += 1
      } catch (error) {
        /*
         * One broken flow must not stop the sweep — the same isolation the
         * dynamic-list sweep gives each list. The claim is released so a
         * later beat retries; a permanently broken step therefore retries for
         * as long as the enrollment lives, which is bounded by its own wait
         * ceiling and is the recoverable direction.
         */
        console.error('[flow] resume failed', doc.ref.path, error)
        await deferFlowEnrollment(doc.ref, nowMs + FLOW_CLAIM_STALE_MS, nowMs)
      }
    }

    if (result.scanned >= budget) {
      result.complete = false
      result.cursor = after ? { path: after.ref.path } : null
      return result
    }
    if (page.size < Math.min(PAGE_SIZE, remaining)) break
  }
  return result
}
