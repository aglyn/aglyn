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

import { checkCrmRecordsQuota, CRM_COLLECTIONS, UNLIMITED } from '@aglyn/aglyn/server'
import { type ApiV1Context, usageBand } from '@aglyn/tenant-data-admin/server/api-v1-kit'

/**
 * The CRM's figures on `GET /v1/usage` (AGL-2277, AGL-2606, AGL-2611): the
 * records band the plan sells, and the size of every collection an
 * integration walks. Reported on every plan, like the platform's own bands —
 * a workspace without the CRM still keeps the people its captures record.
 *
 * Aggregations, so an organization with ten thousand deals pays ten reads.
 */
export async function crmUsageFigures(ctx: ApiV1Context): Promise<Record<string, unknown>> {
  const orgRef = ctx.firestore.collection('orgs').doc(ctx.orgId)
  const [contactsSnap, companiesSnap, dealsSnap, tasksSnap, activitiesSnap, leadCounts] =
    await Promise.all([
      orgRef.collection('contacts').count().get(),
      orgRef.collection(CRM_COLLECTIONS.companies).count().get(),
      orgRef.collection(CRM_COLLECTIONS.deals).count().get(),
      orgRef.collection(CRM_COLLECTIONS.tasks).count().get(),
      orgRef.collection(CRM_COLLECTIONS.activities).count().get(),
      /*
       * ONE AGGREGATE (AGL-3275). Leads used to live under each SITE, so this
       * was one count per site the org owns, summed. They share an org
       * collection now, and a sum over per-site counts would report a lead that
       * two brands in a consent group both hold twice — so the org's size is a
       * single unscoped count, the way every other CRM collection above is.
       */
      orgRef.collection('leads').count().get(),
    ])

  // The records band is measured on the SUM (AGL-2611); the contacts entry
  // below keeps reporting the people count against it, so a client that
  // only ever read `contacts` still sees the headroom that refuses it.
  const crmRecordsQuota = checkCrmRecordsQuota(
    ctx.org as never,
    contactsSnap.data().count + companiesSnap.data().count + dealsSnap.data().count,
  )

  return {
    contacts: usageBand(
      contactsSnap.data().count,
      crmRecordsQuota.included,
      crmRecordsQuota.remaining,
      crmRecordsQuota.overageRateUsd,
    ),
    /*
     * THE BAND ITSELF (AGL-2611): contacts, companies and deals as one
     * figure against the one band the plan sells. `contacts` above keeps
     * its shape for the client that only reads it — same band, same
     * headroom — and this is the number the invoice and the console
     * meter are computed from. Companies and deals below stay as sizes.
     */
    crmRecords: usageBand(
      crmRecordsQuota.used,
      crmRecordsQuota.included,
      crmRecordsQuota.remaining,
      crmRecordsQuota.overageRateUsd,
    ),
    /*
     * The CRM collections (AGL-2606) — SIZES, in the band shape so a client
     * reads them with the code it already has. No plan bands them: a
     * company or a deal is not metered and is never refused, so `included`
     * and `remaining` are `null` — the unlimited band the docs define —
     * and `metered` is false because there is nothing to bill. What the
     * numbers are for is sizing a sync: how many pages a full walk of
     * `/v1/deals` will take, before taking it.
     */
    crm: {
      companies: usageBand(companiesSnap.data().count, UNLIMITED, UNLIMITED, null),
      deals: usageBand(dealsSnap.data().count, UNLIMITED, UNLIMITED, null),
      tasks: usageBand(tasksSnap.data().count, UNLIMITED, UNLIMITED, null),
      activities: usageBand(activitiesSnap.data().count, UNLIMITED, UNLIMITED, null),
      leads: usageBand(Number(leadCounts.data().count ?? 0), UNLIMITED, UNLIMITED, null),
    },
  }
}
