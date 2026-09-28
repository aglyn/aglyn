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
 * A form's counters, recounted from the rows they count, for plain Node
 * scripts (AGL-3330).
 *
 * The script-side twin of `formCountersFromSource`, `formCounterDrift` and
 * `formCounterPatch` in `libs/aglyn/src/lib/app-utils/forms.ts`, which the
 * server's `recountFormStats` decides with. Both answer
 * `site-form-stats-recount.fixtures.json`: the library's `forms.spec.ts`, and
 * `site-form-stats-recount.test.mjs` (`npm run test:site-form-stats-recount`, which runs
 * the recount's `--self-test` too).
 */

/** The source a lead filed by a form carries in `sources`. */
export const FORM_LEAD_SOURCE_PREFIX = 'form:'

/** The counter fields, in reading order. */
export const FORM_COUNTER_FIELDS = ['submissions', 'leads', 'lastSubmissionAtMs']

/**
 * How far a stored last-submission stamp may sit from the newest row and still
 * agree: the submit path stamps its own clock after the row's commit time.
 */
export const FORM_LAST_SUBMISSION_TOLERANCE_MS = 10 * 60_000

/** `form:{formId}`. */
export function formLeadSource(formId) {
  return `${FORM_LEAD_SOURCE_PREFIX}${formId}`
}

/**
 * The counters a form should hold, from the rows counted. Zero submissions is
 * `null`; leads are `0` on a form that routes them and has filed none, `null`
 * on one that never routed any, and a form that stopped routing keeps the
 * leads it filed.
 *
 * @param {{ submissions: number, leads: number, newestSubmissionAtMs: number | null, routesLeads: boolean }} source
 * @returns {{ submissions: number | null, leads: number | null, lastSubmissionAtMs: number | null }}
 */
export function formCountersFromSource(source) {
  const submissions = source.submissions > 0 ? source.submissions : null
  return {
    submissions,
    leads: source.leads > 0 ? source.leads : source.routesLeads ? 0 : null,
    lastSubmissionAtMs:
      submissions !== null && typeof source.newestSubmissionAtMs === 'number'
        ? source.newestSubmissionAtMs
        : null,
  }
}

/** A stored counter as the recount compares it: a finite number, or `null`. */
function storedCounter(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The counters on which `stored` disagrees with `recounted`, in reading order.
 * An absent counter disagrees with a null one: "is empty" asks `== null`.
 *
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {{ submissions: number | null, leads: number | null, lastSubmissionAtMs: number | null }} recounted
 * @returns {string[]}
 */
export function formCounterDrift(stored, recounted) {
  const drift = []
  for (const field of FORM_COUNTER_FIELDS) {
    const raw = stored?.[field]
    const value = storedCounter(raw)
    const want = recounted[field]
    if (raw === undefined || (value === null && raw !== null)) {
      drift.push(field)
    } else if (field === 'lastSubmissionAtMs' && value !== null && want !== null) {
      if (Math.abs(value - want) > FORM_LAST_SUBMISSION_TOLERANCE_MS) drift.push(field)
    } else if (value !== want) {
      drift.push(field)
    }
  }
  return drift
}

/** The dotted-path update that puts `recounted` on a form. */
export function formCounterPatch(recounted) {
  return {
    'stats.submissions': recounted.submissions,
    'stats.leads': recounted.leads,
    'stats.lastSubmissionAtMs': recounted.lastSubmissionAtMs,
  }
}
