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
 * A form's counters, RECOUNTED from the rows they count (AGL-3330).
 *
 * `/api/forms/submit` keeps `stats.submissions`, `stats.leads` and
 * `stats.lastSubmissionAtMs` by increment, which never re-reads the
 * collection it counts and so cannot see a submission deleted from the
 * Inbox, a lead erased on request, or an increment that failed. This is the
 * other half: it counts the rows and writes what they say, and it runs
 * after every path that REMOVES one of those rows — the Inbox's delete and
 * a switch of lead routing (through this plugin's `/api/forms/stats`), and,
 * through the platform's `host.records.removed` event, the API's
 * `DELETE /v1/sites/{id}/form-submissions/{id}` and a person's erasure.
 * `tools/scripts/recount-form-stats.mjs` runs the same decision over every
 * form.
 *
 * What is counted, and why each is cheap enough to ask after a delete:
 *
 *  - submissions: `count()` of the site's `formSubmissions` with this
 *    `formId` — an aggregation, billed per thousand index entries, not per
 *    row;
 *  - the newest of them: one row, from the `formId ASC, createdAt DESC`
 *    composite the form's own submissions list already reads by;
 *  - leads: `count()` of the organization's leads whose `sources` hold
 *    `form:{formId}`, on the automatic `array-contains` index.
 *
 * All three and the write sit in ONE transaction with the form: a
 * submission's increment landing mid-recount contends with it and one of the
 * two retries, so the recount never writes a figure the increment already
 * moved past.
 *
 * Idempotent: a form whose counters already agree is not written, so a
 * recount after a no-op, or twice, costs its reads and nothing else.
 */

import {
  FORM_COUNTER_FIELDS,
  formCounterDrift,
  formCounterPatch,
  formCountersFromSource,
  formLeadSource,
  type FormCounterStats,
} from '@aglyn/aglyn/app-utils/forms'
import { firebaseAdmin, orgLeadsForHost } from '@aglyn/tenant-data-admin'

/** What one recount found, and whether it wrote. */
export interface FormStatsRecount {
  hostId: string
  formId: string
  /** The counters as stored, `undefined` where the field is absent. */
  stored: Partial<Record<keyof FormCounterStats, unknown>>
  /** The counters the rows say. */
  recounted: FormCounterStats
  /** The counters that disagreed; empty when the form was already right. */
  drift: (keyof FormCounterStats)[]
  /** Whether the recount was written — only ever when something drifted. */
  written: boolean
}

/** The most forms one request may ask to have recounted. */
export const FORM_STATS_RECOUNT_MAX = 20

/** A Firestore `Timestamp`, a `Date` or epoch millis, as millis. */
function millisOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  return typeof toMillis === 'function' ? toMillis.call(value) : null
}

/**
 * Recount one form's counters, and write them when they drifted.
 *
 * @returns what was found, or `null` when the form does not exist on the site
 *          — a deleted form has no counters to keep, and a recount must never
 *          create a stats-only stray document (the submit path's `update`,
 *          never `set`, for the same reason).
 */
export async function recountFormStats(options: {
  hostId: string
  formId: string
  firestore?: FirebaseFirestore.Firestore
  /**
   * The organization's leads, when the caller already holds the collection
   * (an erasure walking one org). Resolved from the site otherwise.
   */
  leads?: FirebaseFirestore.CollectionReference
  /** `false` reports without writing — the script's dry run. */
  apply?: boolean
}): Promise<FormStatsRecount | null> {
  const { hostId, formId } = options
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const formRef = hostRef.collection('forms').doc(formId)
  const submissions = hostRef.collection('formSubmissions').where('formId', '==', formId)
  /*
   * A site in no organization has no lead silo — leads are org rows — so it
   * has filed nobody, and its forms count none.
   */
  const leadsRef: FirebaseFirestore.CollectionReference | null =
    options.leads ?? (await orgLeadsForHost(hostId).catch(() => null))
  const leads: FirebaseFirestore.Query | null = leadsRef
    ? leadsRef.where('sources', 'array-contains', formLeadSource(formId))
    : null
  const apply = options.apply !== false
  return firestore.runTransaction(async (tx) => {
    // ALL READS BEFORE THE WRITE, which a transaction requires.
    const form = await tx.get(formRef)
    if (!form.exists) return null
    const submissionCount = (await tx.get(submissions.count())).data().count
    const newest = await tx.get(submissions.orderBy('createdAt', 'desc').limit(1))
    const leadCount = leads ? (await tx.get(leads.count())).data().count : 0
    const recounted = formCountersFromSource({
      submissions: submissionCount,
      leads: leadCount,
      newestSubmissionAtMs: millisOf(newest.docs[0]?.get('createdAt')),
      routesLeads: form.get('routing')?.lead === true,
    })
    const storedStats = (form.get('stats') ?? {}) as Record<string, unknown>
    const stored = Object.fromEntries(
      FORM_COUNTER_FIELDS.map((field) => [field, storedStats[field]]),
    ) as FormStatsRecount['stored']
    const drift = formCounterDrift(storedStats, recounted)
    const written = apply && drift.length > 0
    if (written) tx.update(formRef, formCounterPatch(recounted))
    return { hostId, formId, stored, recounted, drift, written }
  })
}
