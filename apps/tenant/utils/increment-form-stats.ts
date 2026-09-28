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

import { FieldValue } from 'firebase-admin/firestore'

/**
 * The per-form counters a stored submission moves (`docs/specs/reusable-forms.md`
 * §5a, AGL-3330), written so a failure is SEEN rather than swallowed.
 *
 * ⛔ The alternative — counting `formSubmissions` when a console surface
 * renders — is the expensive-read defect this product has created
 * repeatedly, on the one collection that grows without bound and the one the
 * customer is billed on. An increment on a write that is already happening
 * costs one field; the recount (`recountFormStats`,
 * `tools/scripts/recount-form-stats.mjs`) is what corrects it afterwards.
 *
 * `update`, never `set`: a submission from a stale cached page carrying a
 * deleted form's id must not resurrect it as a stats-only stray document.
 * That is the `overlays` stats rule, and a form needs it for the same
 * reason. A missing document is therefore an EXPECTED answer here, and it is
 * the only failure that is not reported.
 *
 * ## A failure is retried, then reported — never thrown
 *
 * Bookkeeping must not turn a stored submission into a 500: a 500 is a retry
 * invitation, and the retry would store the submission twice. What used to
 * happen instead was a `console.error` nobody reads, which left the form's
 * figures short with nothing saying so. Now a transient failure (contention
 * on a busy form, a deadline) is retried twice, and a write that still fails
 * is forwarded through `reportServerError` — the server-error log and the
 * count `/api/health/server-errors` alerts on — naming the site and the form,
 * so the recount has a place to start.
 *
 * The PER-MONTH keys ride the same update and cost nothing extra: a document
 * write is priced per write, not per field. `monthKey` is the key the
 * site-wide counter was incremented under, reused rather than re-derived.
 *
 * `leadCounted` is whether this capture filed a person this form had not
 * filed before (`sourceAdded` on the capture's answer) — the form counts the
 * PEOPLE it brought in, which is what a recount of the leads' `sources`
 * finds, so a returning visitor moves the submission count and not the lead
 * count.
 */
export async function incrementFormStats(options: {
  formRef: FirebaseFirestore.DocumentReference
  hostId: string
  monthKey: string
  submittedAtMs: number
  leadCounted: boolean
  /** The server-error reporter; injected so a spec can observe it. */
  report?: (event: { message: string; route: string }) => Promise<unknown>
  /** Attempts in all, including the first. */
  attempts?: number
  /** Milliseconds before retry `n` is `backoffMs * n`. */
  backoffMs?: number
}): Promise<'written' | 'form-gone' | 'failed'> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const backoffMs = options.backoffMs ?? 50
  const patch = {
    'stats.submissions': FieldValue.increment(1),
    'stats.lastSubmissionAtMs': options.submittedAtMs,
    [`stats.periods.${options.monthKey}.submissions`]: FieldValue.increment(1),
    ...(options.leadCounted
      ? {
          'stats.leads': FieldValue.increment(1),
          [`stats.periods.${options.monthKey}.leads`]: FieldValue.increment(1),
        }
      : {}),
  }
  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await options.formRef.update(patch)
      return 'written'
    } catch (error) {
      if (isNotFound(error)) {
        // A form deleted after the page that posted this was cached. The
        // submission is stored unbound to nothing new; there are no counters
        // to keep.
        console.warn(
          `form stats increment skipped: form ${options.formRef.id} on ${options.hostId} no longer exists`,
        )
        return 'form-gone'
      }
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt))
      }
    }
  }
  const code = (lastError as { code?: unknown } | null)?.code
  const message =
    `form stats increment failed after ${attempts} attempts ` +
    `(site ${options.hostId}, form ${options.formRef.id}` +
    `${code === undefined ? '' : `, code ${String(code)}`}); ` +
    'its counters are short until `recount-form-stats` runs'
  console.error(`[form-stats] ${message}`, lastError)
  try {
    const report =
      options.report ??
      (async (event: { message: string; route: string }) => {
        const { reportServerError } = await import('./report-server-error')
        return reportServerError(event, { service: 'tenant-web' })
      })
    await report({ message, route: '/api/forms/submit' })
  } catch {
    // The console line above is the record of last resort; a reporter that
    // cannot report must not fail the submission it is reporting about.
  }
  return 'failed'
}

/** Firestore's NOT_FOUND, by gRPC code or by message. */
function isNotFound(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  return code === 5 || code === 'not-found' || /NOT_FOUND|No document to update/i.test(String(message ?? ''))
}
