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

import type {
  PluginIndexedRecord,
  PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldPath } from 'firebase-admin/firestore'
import { orgCampaignSendRef } from './campaign-conversion-attribution'

/** The record kind a campaign's email send is published under. */
export const EMAIL_SEND_RECORD_KIND = 'emailSend'

/**
 * One send as another plugin reads it (AGL-3080): named by the name the team
 * gave it, else its subject, with the site it is sent as and its subject as
 * facts. An unnamed send — no name and no subject — is left out, as the
 * index contract asks.
 */
export function emailSendIndexedRecord(
  id: string,
  data: Readonly<Record<string, unknown>> | undefined,
): PluginIndexedRecord | null {
  if (!id || !data) return null
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const subject = text(data['subject'])
  const name = text(data['displayName']) || subject
  if (!name) return null
  const hostId = text(data['hostId'])
  return {
    id,
    name,
    facts: {
      ...(hostId ? { hostId } : {}),
      ...(subject ? { subject } : {}),
      status: text(data['status']) || null,
    },
  }
}

/** The organization a scope names, resolving it from the site when only a site is given. */
async function scopeOrg(scope: { orgId?: string | null; hostId?: string | null }): Promise<string | null> {
  const given = String(scope.orgId ?? '')
  if (isDocumentId(given)) return given
  const hostId = String(scope.hostId ?? '')
  return isDocumentId(hostId) ? await resolveOrgIdForHost(hostId) : null
}

/**
 * The organization's email sends, indexed for another plugin (AGL-3080) — a
 * person's timeline naming the campaign email it lists from the delivery
 * log. Sends are the ORGANIZATION's (`orgs/{orgId}/campaigns`), each stamped
 * with the one site it is sent as; asked with a site, the index answers that
 * site's sends only.
 */
export const emailSendRecordIndex: PluginRecordIndex = {
  async list(request) {
    const orgId = await scopeOrg(request)
    if (!orgId) return { records: [], truncated: false }
    const firestore = firebaseAdmin.app().firestore()
    let sends: FirebaseFirestore.Query = firestore.collection('orgs').doc(orgId).collection('campaigns')
    if (request.hostId) sends = sends.where('hostId', '==', request.hostId)
    const max = Math.max(1, request.limit)
    const snapshot = await sends.orderBy(FieldPath.documentId()).limit(max + 1).get()
    const records = snapshot.docs
      .slice(0, max)
      .map((doc) => emailSendIndexedRecord(doc.id, doc.data()))
      .filter((record): record is PluginIndexedRecord => record !== null)
    return { records, truncated: snapshot.size > max }
  },
  async get(request) {
    if (!isDocumentId(request.id)) return null
    const orgId = await scopeOrg(request)
    if (!orgId) return null
    const snapshot = await orgCampaignSendRef(orgId, request.id).get()
    if (!snapshot.exists) return null
    const record = emailSendIndexedRecord(snapshot.id, snapshot.data())
    if (record && request.hostId && record.facts['hostId'] !== request.hostId) return null
    return record
  },
}
