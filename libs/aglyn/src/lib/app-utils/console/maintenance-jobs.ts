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
 * STAFF MAINTENANCE JOBS — the descriptors (AGL-1949).
 *
 * Three staff-gated maintenance routes were reachable only from a shell with
 * the shared cron secret in hand. `backfill-scope` and `run-erasures` are the
 * two that already grew consoles (AGL-2062, AGL-2165) and are deliberately
 * NOT here — they have their own cards on the health board, and a second
 * surface for the same route is how two surfaces disagree.
 *
 * ## Why one descriptor list rather than three pages
 *
 * The confirmation phrase is enforced on the SERVER, and rendered by the
 * page, from this one list. A phrase transcribed into both would be two
 * copies of a safety rule — the shape that let `audit-archive` ship without
 * the dry-run guard its two siblings each wrote out by hand (AGL-2084). If
 * they ever disagree here, the button is unusable rather than unguarded.
 *
 * ## A console button is worse than curl unless it is harder to fire
 *
 * Two of these permanently destroy things: `audit-archive` deletes audit rows
 * from Firestore, and `reap-plugin-artifacts` deletes bucket objects with no
 * versioning to recover from. A one-click sweep is strictly worse than the
 * curl it replaces, because the curl at least required assembling the
 * invocation. So the destructive pair carry a typed phrase, every run carries
 * a reason, and every staff run is audited before it acts.
 *
 * Pure data: no fetch, no clock, no Firestore. Imported by the routes AND by
 * the page.
 */

export interface MaintenanceJobDescriptor {
  /** Matches the `SCHEDULED_JOBS` id in `health-report.ts`. */
  id: string
  label: string
  /** The route the console drives. Same route the scheduler and runbook use. */
  path: string
  /**
   * Does a real run destroy something that cannot be recovered?
   *
   * Not "does it write" — `reverify-plugin-versions` writes verdicts back and
   * is not destructive, because a wrong verdict is recomputed on the next
   * run. This flag means bytes go away for good.
   */
  destructive: boolean
  /**
   * The phrase a staff member must type to arm a real run, or null when the
   * job destroys nothing. Enforced server-side; the page only renders it.
   */
  confirmPhrase: string | null
  /** What the job does, in one line. */
  what: string
  /** What a REAL run permanently does. Rendered next to the arming control. */
  consequence: string
  /** What the dry run shows, so the preview is worth reading before arming. */
  previewShows: string
  /** The `adminAudit` action recorded when staff run it. */
  auditAction: string
}

/** Minimum characters of reason for a staff-triggered run. */
export const MAINTENANCE_REASON_MIN = 8

export const MAINTENANCE_JOBS: readonly MaintenanceJobDescriptor[] = [
  {
    id: 'audit-archive',
    label: 'Audit archive',
    path: '/api/admin/audit-archive',
    destructive: true,
    confirmPhrase: 'ARCHIVE AUDIT ROWS',
    what:
      'Moves adminAudit entries past the 90-day retention window into the ' +
      'Storage compliance trail, then deletes them from Firestore.',
    consequence:
      'Audit rows are written to Storage and then PERMANENTLY DELETED from ' +
      'Firestore. They stop being queryable from the audit log; the archived ' +
      'copy is JSON lines in a bucket. This cannot be undone from the console.',
    previewShows:
      'How many rows a real run would move, and in how many batches. Nothing ' +
      'is written or deleted.',
    auditAction: 'maintenance.auditArchive.run',
  },
  {
    id: 'reap-plugin-artifacts',
    label: 'Plugin artifact reaper',
    path: '/api/admin/reap-plugin-artifacts',
    destructive: true,
    confirmPhrase: 'DELETE ORPHANED BUNDLES',
    what:
      'Deletes plugin bundles in the artifacts bucket that no version ' +
      'document claims. The bucket is invisible to the Firebase console, so ' +
      'there is nowhere else to look at it.',
    consequence:
      'Orphaned objects are PERMANENTLY DELETED. The bucket has no object ' +
      'versioning, so nothing can be restored. Objects younger than 7 days ' +
      'are never reaped, and an orphaned listing is reported rather than ' +
      'reaped — but everything the preview lists under "orphans" will go.',
    previewShows:
      'Every object a real run would delete, the bytes reclaimed, and the ' +
      'orphaned listings it will report but never touch.',
    auditAction: 'maintenance.reapArtifacts.run',
  },
  {
    id: 'reverify-plugin-versions',
    label: 'Plugin verdict re-verification',
    path: '/api/admin/reverify-plugin-versions',
    // Writes cached verdicts back and notifies staff on a regression. It
    // delists nothing and revokes nothing — the verifier is a lint, and a
    // lint that can stop a plugin in every workspace is a kill switch with
    // no human in it. So: audited and reasoned, but no typed phrase.
    destructive: false,
    confirmPhrase: null,
    what:
      'Re-runs the static verifier across stored plugin versions and updates ' +
      'each cached verdict. A regression on a live version notifies staff.',
    consequence:
      'Cached verdicts are recomputed and written back, and staff are ' +
      'notified about regressions on live versions. Nothing is delisted or ' +
      'revoked, and a wrong verdict is recomputed on the next run.',
    previewShows:
      'Which versions would be re-checked, which are already current, and ' +
      'which would come back failing — without writing any verdict.',
    auditAction: 'maintenance.reverifyPlugins.run',
  },
] as const

export function findMaintenanceJob(
  id: string,
): MaintenanceJobDescriptor | undefined {
  return MAINTENANCE_JOBS.find((job) => job.id === id)
}

export interface StaffRunRequest {
  reason?: unknown
  confirm?: unknown
}

/**
 * May this staff-triggered REAL run proceed? Returns a refusal, or null.
 *
 * Pure, and the single place the rule lives — the routes call it and the page
 * mirrors its inputs. Two independent requirements, and neither substitutes
 * for the other:
 *
 *   - a **reason**, on every job including the non-destructive one, because
 *     the question an audit row has to answer later is why someone did not
 *     wait for the schedule;
 *   - the **typed phrase**, on the destructive pair only, because a reason
 *     field alone is satisfied by a keyboard mash and this is the control
 *     that makes a one-click irreversible sweep impossible.
 *
 * Compared exactly: no trimming, no case-folding. A confirmation that accepts
 * an approximation of itself is a confirmation someone can fire by accident,
 * which is the entire failure being designed out.
 */
export function refuseStaffRun(
  job: MaintenanceJobDescriptor,
  request: StaffRunRequest,
): string | null {
  const reason = typeof request.reason === 'string' ? request.reason.trim() : ''
  if (reason.length < MAINTENANCE_REASON_MIN) {
    return (
      `Running ${job.label} by hand needs a reason of at least ` +
      `${MAINTENANCE_REASON_MIN} characters — it is recorded in the audit log.`
    )
  }
  if (job.confirmPhrase) {
    const confirm =
      typeof request.confirm === 'string' ? request.confirm : ''
    if (confirm !== job.confirmPhrase) {
      return (
        `This permanently destroys data. Type "${job.confirmPhrase}" exactly ` +
        'to confirm.'
      )
    }
  }
  return null
}
