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

import {
  checkEntitlement,
  FLOW_TIMED_OUT_FIELD,
  type HostActionStep,
} from '@aglyn/aglyn/server'
import { scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  firebaseAdmin,
  getOrgForHost,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import type { HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import { FieldValue } from 'firebase-admin/firestore'
import {
  isOrgAutomationTriggerEvent,
  MAX_TRIGGERED_ORG_AUTOMATIONS,
  ORG_AUTOMATIONS_COLLECTION,
  type OrgAutomation,
  orgAutomationRunsOnHost,
  orgAutomationStopReason,
} from '../model/org-automations'
import {
  deferFlowEnrollment,
  endFlowEnrollment,
  type FlowEnrollment,
} from './flow-enrollments'
import {
  type ActionRunEnv,
  executeAction,
  FLOW_CLAIM_RETRY_MS,
  makeWorkflowContextLoader,
  stopFlowEnrollment,
} from './run-event-actions'

/**
 * THE ORGANIZATION'S AUTOMATIONS, as the engine meets them (AGL-3302).
 *
 * Two doors lead here. An event arrives and the site's own actions are
 * joined by the org automations placed on the site — `runEventActions` asks
 * {@link findOrgAutomationsForEvent} and runs what it answers beside them. A
 * person waiting inside an org automation comes due, or the event they were
 * waiting for arrives, and {@link resumeOrgAutomationEnrollment} continues
 * them against the organization's document.
 *
 * Both run on the event's SITE. The run environment is the site's, so the
 * sending identity, the suppression lists, the consent group, the email meter
 * and the run allowance are all the site's — an automation placed on five
 * sites is five sites running it for themselves.
 */

/** The org automations one event runs on one site, and whose they are. */
export interface PlacedOrgAutomations {
  orgId: string
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
}

/**
 * How long a site's organization is remembered between events.
 *
 * The `hostIndex` read is the price of asking the organization at all, and it
 * repeats on every server event of a busy site and again for each event a
 * run's own steps raise. Remembered briefly rather than forever: a site that
 * changes hands is picked up within the window, and the engine refuses to run
 * a remembered organization's automations for a site whose current owner —
 * read fresh by the entitlement gate before anything runs — is another.
 */
const ORG_LOOKUP_TTL_MS = 60_000

/** Entries kept before the memo starts over; far past one instance's working set. */
const ORG_LOOKUP_MAX_ENTRIES = 1_000

const orgLookups = new Map<string, { orgId: string | null; atMs: number }>()

/** Test seam: forget every remembered organization. */
export function resetOrgAutomationLookupsForTests(): void {
  orgLookups.clear()
}

async function orgIdForHost(hostId: string): Promise<string | null> {
  const nowMs = Date.now()
  const known = orgLookups.get(hostId)
  if (known && nowMs - known.atMs < ORG_LOOKUP_TTL_MS) return known.orgId
  const orgId = await resolveOrgIdForHost(hostId)
  if (orgLookups.size >= ORG_LOOKUP_MAX_ENTRIES) orgLookups.clear()
  orgLookups.set(hostId, { orgId, atMs: nowMs })
  return orgId
}

/**
 * The org automations this event runs on this site, or null when there are
 * none — including when the event is not one an org automation can start on,
 * which is answered before any read.
 *
 * One query: the event, switched on, and placed on this site — by the org
 * token or the site's own — capped at {@link MAX_TRIGGERED_ORG_AUTOMATIONS}.
 * `enabled` is in the query rather than filtered after it so a switched-off
 * or deleted automation (deletion switches it off too) can never take one of
 * the capped places; a PAUSE is per site and cannot be asked of an array in
 * the same query, so a paused automation is dropped here, after it.
 *
 * Served by the composite index on `automations` — `visibleTo` CONTAINS,
 * `trigger.event`, `enabled` — in `cloud/firebase-firestore.indexes.json`.
 *
 * Never throws: an organization that cannot be read runs no org automation,
 * and the site's own actions run exactly as they would have.
 */
export async function findOrgAutomationsForEvent(
  hostId: string,
  event: string,
): Promise<PlacedOrgAutomations | null> {
  if (!isOrgAutomationTriggerEvent(event)) return null
  try {
    const orgId = await orgIdForHost(hostId)
    if (!orgId) return null
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection(ORG_AUTOMATIONS_COLLECTION)
      .where('trigger.event', '==', event)
      .where('enabled', '==', true)
      .where('visibleTo', 'array-contains-any', scopeTokensForHost(hostId))
      .limit(MAX_TRIGGERED_ORG_AUTOMATIONS)
      .get()
    const docs = snapshot.docs.filter((doc) =>
      orgAutomationRunsOnHost(doc.data() as OrgAutomation, hostId),
    )
    return docs.length ? { orgId, docs } : null
  } catch (error) {
    console.error('[org automations] lookup failed', hostId, event, error)
    return null
  }
}

/**
 * Continues one person waiting inside an org automation, on the site they
 * were enrolled on — the org twin of the site action's resume, asking the
 * same questions of the organization's document instead of the site's.
 *
 * - The kill switch is `orgs/{orgId}/automations/{id}`: deleted, switched
 *   off, taken off this site, or paused on this site, and the person stops.
 * - The site must still belong to that organization, and its plan must
 *   still carry the actions builder.
 * - The snapshot runs, never the automation's current steps.
 * - Counted on this site's action-run meter, never refused by it: the person
 *   is already inside, and the gate belongs at enrollment.
 */
export async function resumeOrgAutomationEnrollment(
  enrollment: FlowEnrollment,
  ref: FirebaseFirestore.DocumentReference,
  options: { timedOut?: boolean; nowMs: number },
): Promise<'ran' | 'waiting' | 'exited' | 'deferred' | 'stopped'> {
  const { nowMs } = options
  const hostId = enrollment.hostId
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const stop = (reason: string) => stopFlowEnrollment(enrollment, ref, reason)

  const orgId = String(enrollment.orgId ?? '')
  const doc = orgId
    ? await firestore
        .collection('orgs')
        .doc(orgId)
        .collection(ORG_AUTOMATIONS_COLLECTION)
        .doc(enrollment.actionId)
        .get()
        .catch(() => null)
    : null
  const automation = doc?.exists ? (doc.data() as OrgAutomation) : null
  if (!automation) return await stop('the org automation was deleted')
  const refusal = orgAutomationStopReason(automation, hostId)
  if (refusal) return await stop(refusal)

  const owner = await getOrgForHost(hostId).catch(() => null)
  if (!owner || owner.orgId !== orgId) {
    return await stop(
      'this site is no longer part of the organization that runs the org automation',
    )
  }
  if (!checkEntitlement(owner.org as any, 'actions')) {
    return await stop('this site’s plan no longer includes automations')
  }

  const env: ActionRunEnv = {
    hostId,
    hostRef,
    alerts: [],
    // Admitted by the `actions` gate above.
    actionsAllowed: true,
    webhooksAllowed: checkEntitlement(owner.org as any, 'webhooks'),
    crmAllowed: checkEntitlement(owner.org as any, 'crm'),
    depth: 0,
    org: owner.org ?? null,
    orgId: owner.orgId,
    loadWorkflowContext: makeWorkflowContextLoader(hostRef),
  }
  const payload: HostEventPayload = {
    ...((enrollment.payload ?? {}) as HostEventPayload),
    // The timeout BRANCH, as on a site action's resume.
    ...(options.timedOut ? { [FLOW_TIMED_OUT_FIELD]: true } : {}),
  }
  const ending = await executeAction(
    env,
    enrollment.actionId,
    automation,
    enrollment.event,
    payload,
    {
      startIndex: enrollment.nextStepIndex,
      steps: enrollment.steps as HostActionStep[],
      enrollmentRef: ref,
      orgAutomation: { orgId },
    },
  )
  if (ending === 'deferred') {
    await deferFlowEnrollment(ref, nowMs + FLOW_CLAIM_RETRY_MS, nowMs)
    return ending
  }
  if (ending !== 'waiting') await endFlowEnrollment(ref)
  const monthKey = new Date(nowMs).toISOString().slice(0, 7)
  await hostRef
    .collection('counters')
    .doc('actionRuns')
    .set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
    .catch(() => undefined)
  return ending
}
