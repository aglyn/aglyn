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

/*==========================================
 * WHAT THE TEAM LOGGED, AS A FILE (AGL-3528) — `crm.activities`, exported.
 *
 * Every call, email, meeting and note logged against a contact, a company,
 * a deal or a lead, with who logged it and what it was about: the record of
 * the team's work, taken out to report on or to keep. An activity is
 * logged on a record, as it happens, so the resource is exported and never
 * imported (`directions: ["export"]`).
 *=========================================*/

import {
  CRM_ACTIVITY_DIRECTION_LABELS,
  CRM_ACTIVITY_KIND_LABELS,
  CRM_COLLECTIONS,
  CRM_EMAIL_DELIVERY_STATE_LABELS,
  type CrmActivityDirection,
  type CrmActivityKind,
  type CrmEmailDeliveryState,
} from '@aglyn/aglyn/server'
import { TRANSFER_ID_FIELD } from '@aglyn/aglyn/data-transfer'
import {
  countCrmExport,
  crmMemberEmails,
  crmTransferEnv,
  type CrmTransferEnv,
  isoOf,
  lookupById,
  lookupResult,
  pickValues,
  readCrmExportPage,
  requireCrmRecords,
  textOf,
  type TransferExportHooks,
  visibleIn,
} from './common'
import { ACTIVITY_TRANSFER_FIELDS, ACTIVITY_TRANSFER_GROUPS, CRM_TIMESTAMP_FIELDS } from './fields'

const activitiesOf = (env: CrmTransferEnv) => env.orgRef.collection(CRM_COLLECTIONS.activities)

/** The words an export writes for the records an activity is about. */
interface ActivityNames {
  by?: (uid: string) => string | undefined
  contact?: (id: string) => string | undefined
  company?: (id: string) => string | undefined
  deal?: (id: string) => string | undefined
  lead?: (id: string) => string | undefined
}

/** One activity as values by field id. */
export function activityTransferValues(
  id: string,
  activity: Record<string, unknown>,
  names: ActivityNames = {},
): Record<string, unknown> {
  const text = (value: unknown) => textOf(value) || null
  const link = (value: unknown, resolve?: (id: string) => string | undefined) => {
    const linked = text(value)
    return linked ? (resolve?.(linked) ?? linked) : null
  }
  const kind = textOf(activity['kind']) as CrmActivityKind
  const direction = textOf(activity['direction']) as CrmActivityDirection
  const delivery = textOf(activity['deliveryState']) as CrmEmailDeliveryState
  return {
    subject: text(activity['subject']),
    kind: CRM_ACTIVITY_KIND_LABELS[kind] ?? text(kind),
    direction: CRM_ACTIVITY_DIRECTION_LABELS[direction] ?? text(direction),
    at: isoOf(activity['atMs']),
    body: text(activity['body']),
    outcome: text(activity['outcome']),
    durationMinutes: typeof activity['durationMinutes'] === 'number' ? activity['durationMinutes'] : null,
    by: link(activity['byUid'], names.by) ?? text(activity['byName']),
    to: text(activity['to']),
    from: text(activity['from']),
    deliveryState: CRM_EMAIL_DELIVERY_STATE_LABELS[delivery] ?? text(delivery),
    contact: link(activity['contactId'], names.contact),
    company: link(activity['companyId'], names.company),
    deal: link(activity['dealId'], names.deal),
    lead: link(activity['leadId'], names.lead),
    createdAt: isoOf(activity['createdAt']),
    updatedAt: isoOf(activity['updatedAt']),
    [TRANSFER_ID_FIELD]: id,
  }
}

/** Reads one field of each linked record by id. */
async function namesOf(
  env: CrmTransferEnv,
  collection: string,
  ids: Iterable<string>,
  field: (data: Record<string, unknown>) => string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set(ids)].filter((id) => id && !id.includes('/'))
  for (let at = 0; at < wanted.length; at += 500) {
    const refs = wanted.slice(at, at + 500).map((id) => env.orgRef.collection(collection).doc(id))
    for (const snapshot of await env.firestore.getAll(...refs)) {
      if (snapshot.exists) out.set(snapshot.id, field(snapshot.data() ?? {}))
    }
  }
  return out
}

/** The `crm.activities` hooks: an export, and the reads undo would ask. */
export function activitiesTransferResource(): TransferExportHooks {
  return {
    fields: () => ({ standard: ACTIVITY_TRANSFER_FIELDS, system: CRM_TIMESTAMP_FIELDS, groups: ACTIVITY_TRANSFER_GROUPS }),
    matchKeys: [{ fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' }],

    async count(ctx, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'activities')
      return countCrmExport(env, activitiesOf(env), options, (data) => visibleIn(env, data['visibleTo'], options.scopeTokens))
    },

    async readPage(ctx, cursor, fieldIds, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'activities')
      const emails = fieldIds.includes('by') ? await crmMemberEmails(env.orgId) : new Map<string, string>()
      return readCrmExportPage(
        env,
        activitiesOf(env),
        cursor,
        options,
        (data) => visibleIn(env, data['visibleTo'], options?.scopeTokens),
        async (docs) => {
          const ids = (field: string) => docs.map((doc) => textOf(doc.data[field])).filter(Boolean)
          const wants = (field: string) => fieldIds.includes(field)
          const empty = new Map<string, string>()
          const [contacts, companies, deals, leads] = await Promise.all([
            wants('contact') ? namesOf(env, 'contacts', ids('contactId'), (data) => textOf(data['email'])) : empty,
            wants('company') ? namesOf(env, CRM_COLLECTIONS.companies, ids('companyId'), (data) => textOf(data['name'])) : empty,
            wants('deal') ? namesOf(env, CRM_COLLECTIONS.deals, ids('dealId'), (data) => textOf(data['title'])) : empty,
            wants('lead') ? namesOf(env, 'leads', ids('leadId'), (data) => textOf(data['email'])) : empty,
          ])
          return docs.map((doc) =>
            pickValues(
              activityTransferValues(doc.id, doc.data, {
                by: (uid) => emails.get(uid),
                contact: (id) => contacts.get(id) || undefined,
                company: (id) => companies.get(id) || undefined,
                deal: (id) => deals.get(id) || undefined,
                lead: (id) => leads.get(id) || undefined,
              }),
              fieldIds,
            ),
          )
        },
      )
    },

    async lookup(ctx, requests) {
      const env = await crmTransferEnv(ctx)
      const found = { lookup: new Map<string, string[]>(), docs: new Map<string, Record<string, unknown>>() }
      for (const request of requests) {
        if (request.fieldId === TRANSFER_ID_FIELD) {
          await lookupById(env, activitiesOf(env), request, (data) => visibleIn(env, data['visibleTo']), found)
        }
      }
      return lookupResult(found, (id, data) => activityTransferValues(id, data))
    },
  }
}
