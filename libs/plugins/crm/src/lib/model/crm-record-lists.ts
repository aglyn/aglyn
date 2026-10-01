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

import { contactDisplayName, normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import {
  CRM_COLLECTIONS,
  crmLeadDisplayName,
  crmViewIsListed,
  isCrmLeadOpen,
  normalizeCrmViewFilters,
} from '@aglyn/aglyn/app-utils/crm'
import {
  CRM_EMAIL_TEMPLATES_LIMIT,
  crmEmailTemplateIsListed,
  normalizeCrmEmailTemplate,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import { dynamicListDimensionsForCrmView } from '@aglyn/aglyn/app-utils/dynamic-list-rule'
import { nameSearchToken } from '@aglyn/aglyn/app-utils/name-search'
import { scopeTokensForHost, visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  registerPluginRecordListSource,
  type PluginRecordListSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * The CRM's records, FOUND in the console for another plugin's picker
 * (AGL-3080) — a sales sequence choosing whom to enroll and what to send —
 * through `plugin-record-lists`, so the reader never learns where the CRM
 * keeps any of it or which rule its security rules hold a query to.
 *
 * Four kinds, each org-scoped (`orgId` required) and each the query the
 * CRM's own console reads the same records by:
 *
 * `savedView` — the saved views of the Contacts and Leads lists this member
 * may list: their own and the shared ones. Facts:
 * `{ recordKind: 'contact' | 'lead', takeable: boolean }`. `takeable` is
 * whether the view can be taken whole as an audience: a Leads view narrows by
 * status alone, which is always applied; a Contacts view filtering on
 * something only the list itself can apply is not, because dropping that
 * filter would take more people than the view shows.
 *
 * `messageTemplate` — the email templates and snippets this member may list,
 * written for the whole organization or for the named site. Facts:
 * `{ kind: 'template' | 'snippet', subject, body }`.
 *
 * `contact` — a SEARCH of the site's contacts: by address when the text is
 * one, otherwise by a word of the name. None with nothing typed. Named as the
 * site's consent group knows them. Facts: `{ email }`.
 *
 * `lead` — the site's most recently seen leads, newest first. Facts:
 * `{ email, open }`, `open` being a lead nobody has closed or converted.
 */

const named = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const savedViewRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.orgId) return null
    return query(
      collection(firestore, 'orgs', request.orgId, CRM_COLLECTIONS.views),
      where('section', 'in', ['contacts', 'leads']),
      orderBy('name'),
      limit(request.limit),
    )
  },
  record(id, data, request) {
    const name = named(data['name'])
    if (!name) return null
    // A colleague's private view is theirs.
    if (
      !crmViewIsListed(
        { shared: data['shared'] === true, ownerUid: String(data['ownerUid'] ?? '') },
        request?.viewerUid ?? null,
      )
    ) {
      return null
    }
    const leads = data['section'] === 'leads'
    const takeable =
      leads || dynamicListDimensionsForCrmView(normalizeCrmViewFilters(data['filters'])).unsupported.length === 0
    return { id, name, facts: { recordKind: leads ? 'lead' : 'contact', takeable } }
  },
}

export const messageTemplateRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.orgId) return null
    return query(
      collection(firestore, 'orgs', request.orgId, CRM_COLLECTIONS.emailTemplates),
      orderBy('name'),
      limit(Math.min(request.limit, CRM_EMAIL_TEMPLATES_LIMIT)),
    )
  },
  record(id, data, request) {
    const template = normalizeCrmEmailTemplate(data)
    if (!template.name) return null
    // The team's and this member's own, written for the organization or the site.
    if (!crmEmailTemplateIsListed(template, request?.viewerUid ?? null)) return null
    if (request?.hostId && !visibleToHost(template.visibleTo, request.hostId)) return null
    return {
      id,
      name: template.name,
      facts: { kind: template.kind, subject: template.subject, body: template.body },
    }
  },
}

export const contactRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.orgId || !request.hostId) return null
    const email = normalizeContactEmail(request.search)
    const token = email ? '' : nameSearchToken(request.search)
    if (!email && !token) return null
    const contacts = collection(firestore, 'orgs', request.orgId, 'contacts')
    return email
      ? query(contacts, where('email', '==', email), limit(request.limit))
      : query(contacts, where('nameTokens', 'array-contains', token), orderBy('nameLower'), limit(request.limit))
  },
  record(id, data, request) {
    const hostId = request?.hostId
    if (hostId && !visibleToHost(data['visibleTo'] as string[] | undefined, hostId)) return null
    const email = normalizeContactEmail(data['email'])
    const name = contactDisplayName(data, request?.consentGroupId || hostId || '').trim() || email || ''
    if (!name) return null
    return { id, name, facts: { email } }
  },
}

export const leadRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.orgId || !request.hostId) return null
    // The org collection, narrowed to the site (AGL-3275) — unscoped it would
    // offer one agency client another client's people.
    return query(
      collection(firestore, 'orgs', request.orgId, 'leads'),
      where('visibleTo', 'array-contains-any', scopeTokensForHost(request.hostId)),
      orderBy('lastSeenAtMs', 'desc'),
      limit(request.limit),
    )
  },
  record(id, data) {
    const name = crmLeadDisplayName(data)
    if (!name) return null
    return {
      id,
      name,
      facts: {
        email: normalizeContactEmail(data['email']),
        open: isCrmLeadOpen(data as never) && !data['convertedContactId'],
      },
    }
  },
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerCrmRecordLists(): void {
  const owner = { pluginId: BUNDLE_ID }
  registerPluginRecordListSource('savedView', savedViewRecordListSource, owner)
  registerPluginRecordListSource('messageTemplate', messageTemplateRecordListSource, owner)
  registerPluginRecordListSource('contact', contactRecordListSource, owner)
  registerPluginRecordListSource('lead', leadRecordListSource, owner)
}
