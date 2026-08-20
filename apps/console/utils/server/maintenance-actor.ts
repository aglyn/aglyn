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
 * WHO INVOKED A MAINTENANCE ROUTE (AGL-1949).
 *
 * `audit-archive`, `reap-plugin-artifacts` and `reverify-plugin-versions`
 * accepted the shared cron secret and nothing else, so a browser could not
 * call them at all — the routes existed, the operator scripts existed, and
 * the only way to reach any of it was a shell with the production secret.
 *
 * This is the AGL-2165 `run-erasures` shape, extracted rather than
 * transcribed a fourth time. `isCronDryRun` had to be extracted for exactly
 * this reason: three routes each wrote out their own copy of a four-line
 * safety rule and the fourth copy — on the route that DELETES — was the one
 * nobody ever wrote. An auth rule is a worse thing to transcribe than a
 * dry-run rule.
 *
 * A staff ID token is accepted ALONGSIDE the cron secret, never instead of
 * it: the scheduler has no user and must keep working. The secret is never
 * exposed to a browser — staff authenticate as themselves, which is also what
 * makes the audit row meaningful.
 */

import {
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { isCronAuthorized } from '../cron-auth'
import type { MaintenanceJobDescriptor } from '../maintenance-jobs'

export interface MaintenanceActor {
  uid: string
  kind: 'cron' | 'staff'
}

/**
 * The scheduler, a staff member, or nobody.
 *
 * FAILS CLOSED at every step: an unreadable token, an unverified email and a
 * token with no `staff` claim all return null, and so does any throw. AGL-1993
 * found the staff claim is minted correctly and was being read wrong on the
 * client, so this keys on the decoded claim and nothing else.
 */
export async function authorizeMaintenanceActor(
  headers: Partial<Record<string, string>>,
): Promise<MaintenanceActor | null> {
  if (isCronAuthorized(headers)) return { uid: 'system:cron', kind: 'cron' }
  const authorization = headers.authorization ?? ''
  if (!authorization.startsWith('Bearer ')) return null
  try {
    const decoded = await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken(authorization.slice('Bearer '.length))
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return null
    if (!decoded['staff']) return null
    return { uid: decoded.uid, kind: 'staff' }
  } catch {
    return null
  }
}

/**
 * Record a staff-triggered real run BEFORE it runs anything.
 *
 * Before, deliberately. These jobs already audit what they did — the reaper
 * writes the object list, the re-verifier writes the regressions — but none of
 * that survives the job dying halfway, and none of it says WHO asked or why
 * they did not wait for the schedule. A row written first answers those two
 * questions even when the run does not finish, which is the case where they
 * matter most.
 *
 * Never throws: an audit-write failure must not take down the job it
 * describes. The write is awaited so the ordering claim is real.
 */
export async function recordStaffMaintenanceRun(
  firestore: FirebaseFirestore.Firestore,
  job: MaintenanceJobDescriptor,
  actor: MaintenanceActor,
  reason: string,
): Promise<void> {
  try {
    await firestore.collection('adminAudit').add({
      actorUid: actor.uid,
      action: job.auditAction,
      target: job.path,
      after: {
        reason: reason.trim().slice(0, 500),
        destructive: job.destructive,
        // Says out loud that this was a person, not the 03:00 run. Reading an
        // ad-hoc sweep as a scheduled one is how a surprise becomes routine.
        triggeredBy: 'staff-console',
      },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
  } catch {
    // Deliberately swallowed. See above.
  }
}
