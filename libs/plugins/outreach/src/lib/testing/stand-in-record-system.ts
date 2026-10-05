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

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { scopeTokensForHost, seenOnlyThroughGrant, visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  registerPluginPersonRecords,
  type PluginPersonRecord,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { registerPluginRecordEmailStateWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { registerPluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * A plugin that keeps people, standing in for the one that does (AGL-3080).
 *
 * Sequences read the people a rep enrolls, the company each works for, the
 * templates a step sends and the saved views people are taken from — and
 * tell the record system when a lead was mailed or wrote back — through the
 * core's seams (`plugin-person-records`, `plugin-record-index`,
 * `plugin-record-email-state`), importing no record system. Their specs
 * stand an owner up the way the loader would, over the spec's own Firestore
 * — the in-memory double or the emulator. One plugin may not import another,
 * which is why this is here rather than borrowed from the CRM.
 *
 * It imitates the owner's storage as the CRM keeps it (contacts, leads keyed
 * by the person, companies, saved views, templates, the activity log) so a
 * spec seeds documents the way it always has. That the real owner answers
 * the same is held by the CRM's own `person-records.spec.ts`,
 * `crm-record-indexes.spec.ts` and `lead-nurturing.spec.ts`.
 */

type Firestore = FirebaseFirestore.Firestore
type Data = Record<string, unknown>

const KIND_STORED_IN: Readonly<Record<string, string>> = { contact: 'contacts', lead: 'leads' }

const email = (value: unknown): string | null => {
  const text = String(value ?? '').trim().toLowerCase()
  return text.includes('@') ? text : null
}

export interface StandInRecordSystemOptions {
  firestore: () => Firestore
  /** What the dynamic-list sweep reads out of a saved Contacts view, by view id. */
  viewEmails?: (viewId: string) => { emails: string[]; complete: boolean }
  /**
   * The clauses of a saved Contacts view that only the list itself can
   * apply, named as the owner names them; none by default. A view with any
   * is refused whole, as the owner refuses it.
   */
  unsupported?: (filters: readonly Data[]) => string[]
  /** The consent group a site files a contact's facet under. The site alone by default. */
  groupIdForHost?: (hostId: string) => string
}

export function standInRecordSystem(options: StandInRecordSystemOptions): void {
  const org = (orgId: string) => options.firestore().collection('orgs').doc(orgId)
  const person = (kind: string, snapshot: FirebaseFirestore.DocumentSnapshot): PluginPersonRecord => {
    const data = (snapshot.data() ?? {}) as Data
    return { kind, id: snapshot.id, email: email(data['email']), data }
  }
  const leadStatus = (lead: Data) => String(lead['status'] ?? 'new')
  const moveLeads = async (
    request: { orgId: string; hostId: string; emails: readonly string[] },
    from: readonly string[],
    to: string,
  ) => {
    let moved = 0
    for (const address of request.emails) {
      const key = personKey(address)
      if (!key) continue
      const ref = org(request.orgId).collection('leads').doc(key)
      const lead = (await ref.get()).data() as Data | undefined
      if (!lead || lead['convertedContactId']) continue
      if (!visibleToHost(lead['visibleTo'] as string[] | undefined, request.hostId)) continue
      if (!from.includes(leadStatus(lead))) continue
      await ref.set({ status: to }, { merge: true })
      moved += 1
    }
    return { records: moved }
  }

  registerPluginPersonRecords(
    {
      async find(request) {
        const address = email(request.email)
        const orgId = String(request.orgId ?? '')
        if (!address || !orgId) return null
        const found = (await org(orgId).collection('contacts').where('email', '==', address).limit(1).get()).docs[0]
        if (found) {
          const visible =
            !request.onlyVisibleToSite ||
            visibleToHost(found.get('visibleTo') as string[] | undefined, String(request.hostId))
          return visible ? person('contact', found) : null
        }
        if (!request.anyKind) return null
        const lead = await org(orgId).collection('leads').doc(String(personKey(address))).get()
        return lead.exists ? person('lead', lead) : null
      },
      async read(request) {
        return Promise.all(
          request.records.map(async (record) => {
            const collection = KIND_STORED_IN[record.kind]
            if (!collection || !record.id) return null
            const snapshot = await org(request.orgId).collection(collection).doc(record.id).get()
            return snapshot.exists ? person(record.kind, snapshot) : null
          }),
        )
      },
      async fileUnder(request) {
        const collection = KIND_STORED_IN[request.record.kind]
        if (!collection) return { filed: false }
        const ref = org(String(request.orgId)).collection(collection).doc(request.record.id)
        if (!(await ref.get()).exists) return { filed: false }
        const field =
          request.record.kind === 'lead'
            ? `${request.containerKind}Ids`
            : `facets.${options.groupIdForHost?.(request.hostId) ?? request.hostId}.${request.containerKind}Ids`
        await ref.update({ [field]: FieldValue.arrayUnion(...request.ids) })
        return { filed: true }
      },
      async peopleInView(request) {
        const view = (await org(request.orgId).collection('crmViews').doc(request.viewId).get()).data() as
          | Data
          | undefined
        if (!view || (view['shared'] !== true && view['ownerUid'] !== request.viewerUid)) {
          return { ok: false, reason: 'not-found' }
        }
        if (view['section'] === 'leads') {
          const filters = Array.isArray(view['filters']) ? (view['filters'] as Data[]) : []
          const wanted = String(filters.find((clause) => clause['field'] === 'status')?.['value'] ?? 'open')
          const window = await org(request.orgId)
            .collection('leads')
            .where('visibleTo', 'array-contains-any', scopeTokensForHost(request.hostId))
            .orderBy('lastSeenAtMs', 'desc')
            .limit(201)
            .get()
          const matching = window.docs.slice(0, 200).filter((doc) => {
            const lead = (doc.data() ?? {}) as Data
            if (seenOnlyThroughGrant(lead, request.hostId)) return false
            if (wanted === 'all') return true
            if (wanted === 'open') {
              return ['new', 'nurturing', 'working'].includes(leadStatus(lead)) && !lead['convertedContactId']
            }
            return leadStatus(lead) === wanted
          })
          return {
            ok: true,
            people: matching.slice(0, request.limit).map((doc) => ({ kind: 'lead', id: doc.id })),
            total: matching.length,
            truncated: matching.length > request.limit || window.docs.length > 200,
          }
        }
        if (view['section'] !== 'contacts') return { ok: false, reason: 'not-people' }
        const unsupported = options.unsupported?.(Array.isArray(view['filters']) ? (view['filters'] as Data[]) : []) ?? []
        if (unsupported.length) return { ok: false, reason: 'unsupported', unsupported }
        const { emails, complete } = options.viewEmails?.(request.viewId) ?? { emails: [], complete: true }
        const ordered = [...new Set(emails)].sort()
        const ids = new Set<string>()
        for (const address of ordered.slice(0, request.limit)) {
          const found = (await org(request.orgId).collection('contacts').where('email', '==', address).limit(1).get())
            .docs[0]
          if (found && visibleToHost(found.get('visibleTo') as string[] | undefined, request.hostId)) ids.add(found.id)
        }
        return {
          ok: true,
          people: [...ids].map((id) => ({ kind: 'contact', id })),
          total: ordered.length,
          truncated: ordered.length > request.limit || !complete,
        }
      },
      async wroteIn(request) {
        return Promise.all(
          request.records.map(async (record) => {
            const field = record.kind === 'contact' ? 'contactId' : record.kind === 'lead' ? 'leadId' : null
            if (!field || !record.id) return null
            const found = await org(request.orgId)
              .collection('crmActivities')
              .where(field, '==', record.id)
              .where('direction', '==', 'inbound')
              .limit(1)
              .get()
            return !found.empty
          }),
        )
      },
    },
    { pluginId: 'record-system' },
  )

  const index = (collection: string, facts: (data: Data) => Data) => ({
    async list() {
      return { records: [], truncated: false }
    },
    async get(request: { orgId?: string | null; id: string }) {
      if (!request.orgId) return null
      const snapshot = await org(request.orgId).collection(collection).doc(request.id).get()
      const data = snapshot.data() as Data | undefined
      return data ? { id: snapshot.id, name: String(data['name'] ?? '') || snapshot.id, facts: facts(data) } : null
    },
  })
  registerPluginRecordIndex('company', index('companies', (data) => ({ ...data })), { pluginId: 'record-system' })
  registerPluginRecordIndex(
    'messageTemplate',
    index('crmEmailTemplates', (data) => ({
      kind: data['kind'] === 'snippet' ? 'snippet' : 'template',
      subject: String(data['subject'] ?? ''),
      body: String(data['body'] ?? ''),
    })),
    { pluginId: 'record-system' },
  )

  registerPluginRecordEmailStateWriter(
    {
      async stamp() {
        return { records: 0 }
      },
      reached: (request) => moveLeads(request, ['new'], 'nurturing'),
      replied: (request) => moveLeads(request, ['new', 'nurturing'], 'working'),
    },
    { pluginId: 'record-system' },
  )
}
