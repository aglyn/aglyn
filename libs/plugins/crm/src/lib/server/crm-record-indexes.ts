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

import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { normalizeCrmEmailTemplate } from '@aglyn/aglyn/app-utils/crm-email-templates'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  PluginIndexedRecord,
  PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * Two more of the CRM's record kinds, as another plugin reads them on the
 * server (AGL-3080) — a sales sequence judging the company a person works
 * for, and sending the body of a template a rep wrote — without knowing where
 * either is stored.
 *
 * Both org-scoped (`orgId` required; a site-only scope answers nothing). With
 * a `hostId`, only what that site may see.
 *
 * `company` — `name` is the company's, else its domain, else its id. Its
 * `facts` are the company as the CRM stores it: `name`, `domain`, `address`
 * (`{ line1, city, region, postalCode, country }`), `phone`, `website`,
 * `industry` and the rest of the record's fields.
 *
 * `messageTemplate` — the CRM's email templates and snippets, by the name a
 * rep gave it; one saved without a name is left out. Its `facts`:
 * `{ kind: 'template' | 'snippet', subject: string, body: string }`, the body
 * in the CRM's merge-field grammar.
 */

type Firestore = FirebaseFirestore.Firestore

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export function companyIndexedRecord(
  id: string,
  data: Record<string, unknown> | undefined,
): PluginIndexedRecord | null {
  if (!data) return null
  return { id, name: str(data['name']) || str(data['domain']) || id, facts: { ...data } }
}

export function messageTemplateIndexedRecord(
  id: string,
  data: Record<string, unknown> | undefined,
): PluginIndexedRecord | null {
  if (!data) return null
  const template = normalizeCrmEmailTemplate(data)
  if (!template.name) return null
  return {
    id,
    name: template.name,
    facts: { kind: template.kind, subject: template.subject, body: template.body },
  }
}

function orgIndex(
  collection: string,
  record: (id: string, data: Record<string, unknown> | undefined) => PluginIndexedRecord | null,
  firestore: () => Firestore,
): PluginRecordIndex {
  const of = (orgId: string) => firestore().collection('orgs').doc(orgId).collection(collection)
  const visible = (data: Record<string, unknown> | undefined, hostId: string | null | undefined) =>
    !hostId || visibleToHost(data?.['visibleTo'] as string[] | undefined, hostId)
  return {
    async list({ orgId, hostId, limit }) {
      if (!orgId || limit <= 0) return { records: [], truncated: false }
      // One more than asked, so `truncated` is a fact; scope and names are
      // applied after the read.
      const snapshot = await of(orgId).orderBy('name').limit(limit + 1).get()
      const records = snapshot.docs
        .slice(0, limit)
        .filter((doc) => visible(doc.data(), hostId))
        .map((doc) => record(doc.id, doc.data()))
        .filter((entry): entry is PluginIndexedRecord => entry !== null)
      return { records, truncated: snapshot.docs.length > limit }
    },
    async get({ orgId, hostId, id }) {
      if (!orgId || !id) return null
      const snapshot = await of(orgId).doc(id).get()
      if (!snapshot.exists || !visible(snapshot.data(), hostId)) return null
      return record(snapshot.id, snapshot.data())
    },
  }
}

const adminFirestore = () => firebaseAdmin.app().firestore()

/** Builds the two indexes over a Firestore; the CRM registers them over the admin app's. */
export function crmRecordIndexes(firestore: () => Firestore = adminFirestore): {
  company: PluginRecordIndex
  messageTemplate: PluginRecordIndex
} {
  return {
    company: orgIndex(CRM_COLLECTIONS.companies, companyIndexedRecord, firestore),
    messageTemplate: orgIndex(CRM_COLLECTIONS.emailTemplates, messageTemplateIndexedRecord, firestore),
  }
}
