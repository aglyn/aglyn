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
'use client'

import {
  contactDisplayName,
  normalizeContactEmail,
} from '@aglyn/aglyn/app-utils/contacts'
import {
  CRM_COLLECTIONS,
  crmViewIsListed,
  normalizeCrmViewFilters,
} from '@aglyn/aglyn/app-utils/crm'
import {
  CRM_EMAIL_TEMPLATES_LIMIT,
  crmEmailTemplateIsListed,
  normalizeCrmEmailTemplate,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import { dynamicListDimensionsForCrmView } from '@aglyn/aglyn/app-utils/dynamic-list-rule'
import { nameSearchToken } from '@aglyn/aglyn/app-utils/name-search'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { OutreachLoad } from './use-outreach-data'

/**
 * What Outreach reads from the organization's CRM (AGL-2980): the saved
 * Contacts views people can be enrolled from, the email templates a step
 * can send, and the contacts a search finds.
 *
 * Through the core's own CRM model — the collection names, the listing
 * rules, the view translation the dynamic-list sweep uses — and never
 * through the CRM plugin, which a plugin may not import. The Firestore
 * rules gate every one of these reads on `data.manage`, the same permission
 * the enroll routes ask for, so a member who cannot read the people cannot
 * enroll them either.
 */

const denied = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'permission-denied'

/** A saved Contacts view people can be enrolled from. */
export interface OutreachViewOption {
  id: string
  name: string
}

/** The most saved views the picker lists. */
export const OUTREACH_VIEWS_LIMIT = 50

/**
 * The saved Contacts views this reader may enroll from: their own and the
 * shared ones — a colleague's private view is theirs — that translate whole
 * into an audience. A view filtering on something enrolling cannot apply is
 * not offered, because dropping that filter would enroll more people than
 * the view shows.
 */
export function useOutreachSavedViews(
  orgId: string | null,
  uid: string | null,
): OutreachLoad<OutreachViewOption[]> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachViewOption[]>>({
    status: 'loading',
    data: [],
  })
  useEffect(() => {
    setResult({ status: 'loading', data: [] })
    if (!orgId) return undefined
    return onSnapshot(
      query(
        collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.views),
        where('section', '==', 'contacts'),
        orderBy('name'),
        limit(OUTREACH_VIEWS_LIMIT),
      ),
      (snapshot) =>
        setResult({
          status: 'ready',
          data: snapshot.docs
            .map((entry) => ({
              id: entry.id,
              data: entry.data() as Record<string, unknown>,
            }))
            .filter(
              ({ data }) =>
                typeof data['name'] === 'string' &&
                data['name'] !== '' &&
                crmViewIsListed(
                  {
                    shared: data['shared'] === true,
                    ownerUid: String(data['ownerUid'] ?? ''),
                  },
                  uid,
                ) &&
                dynamicListDimensionsForCrmView(
                  normalizeCrmViewFilters(data['filters']),
                ).unsupported.length === 0,
            )
            .map(({ id, data }) => ({ id, name: String(data['name']) })),
        }),
      (error) => {
        if (!denied(error))
          console.error('[outreach] saved views could not be read', error)
        setResult({ status: denied(error) ? 'refused' : 'error', data: [] })
      },
    )
  }, [firestore, orgId, uid])
  return result
}

/** A CRM email template a step can send the body of. */
export interface OutreachTemplateOption {
  id: string
  name: string
  subject: string
  body: string
}

/**
 * The CRM email templates a step at this site can use: whole letters, not
 * snippets; the team's and this reader's own; written for the whole
 * organization or for this site.
 */
export function useOutreachEmailTemplates(
  orgId: string | null,
  hostId: string | null,
  uid: string | null,
): OutreachLoad<OutreachTemplateOption[]> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachTemplateOption[]>>({
    status: 'loading',
    data: [],
  })
  useEffect(() => {
    setResult({ status: 'loading', data: [] })
    if (!orgId) return undefined
    return onSnapshot(
      query(
        collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.emailTemplates),
        orderBy('name'),
        limit(CRM_EMAIL_TEMPLATES_LIMIT),
      ),
      (snapshot) =>
        setResult({
          status: 'ready',
          data: snapshot.docs
            .map((entry) => ({
              id: entry.id,
              template: normalizeCrmEmailTemplate(entry.data()),
            }))
            .filter(
              ({ template }) =>
                template.kind === 'template' &&
                crmEmailTemplateIsListed(template, uid) &&
                (!hostId || visibleToHost(template.visibleTo, hostId)),
            )
            .map(({ id, template }) => ({
              id,
              name: template.name,
              subject: template.subject,
              body: template.body,
            })),
        }),
      (error) => {
        if (!denied(error))
          console.error('[outreach] email templates could not be read', error)
        setResult({ status: denied(error) ? 'refused' : 'error', data: [] })
      },
    )
  }, [firestore, orgId, hostId, uid])
  return result
}

/** A contact a search found. */
export interface OutreachContactOption {
  id: string
  name: string
  email: string | null
}

/** The most contacts one search answers with. */
export const OUTREACH_SEARCH_LIMIT = 25

/**
 * The contacts at `hostId` a search finds: by address when the text is one,
 * otherwise by a word of the name — the `nameTokens` the contacts carry for
 * the CRM's own search. `idle` until something is typed.
 */
export function useOutreachContactSearch(input: {
  orgId: string | null
  hostId: string | null
  contactGroupId: string | null
  text: string
}): OutreachLoad<OutreachContactOption[]> & { idle: boolean } {
  const { orgId, hostId, contactGroupId, text } = input
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachContactOption[]>>({
    status: 'ready',
    data: [],
  })
  const email = normalizeContactEmail(text)
  const token = email ? '' : nameSearchToken(text)
  const idle = !orgId || !hostId || (!email && !token)
  useEffect(() => {
    if (idle || !orgId || !hostId) {
      setResult({ status: 'ready', data: [] })
      return undefined
    }
    let current = true
    setResult((previous) => ({ status: 'loading', data: previous.data }))
    const contacts = collection(firestore, 'orgs', orgId, 'contacts')
    // Settles the typing before it reads: one query per pause, not per key.
    const timer = setTimeout(() => {
      getDocs(
        email
          ? query(
              contacts,
              where('email', '==', email),
              limit(OUTREACH_SEARCH_LIMIT),
            )
          : query(
              contacts,
              where('nameTokens', 'array-contains', token),
              orderBy('nameLower'),
              limit(OUTREACH_SEARCH_LIMIT),
            ),
      )
        .then((snapshot) => {
          if (!current) return
          setResult({
            status: 'ready',
            data: snapshot.docs
              .map((entry) => ({
                id: entry.id,
                data: entry.data() as Record<string, unknown>,
              }))
              .filter(({ data }) =>
                visibleToHost(
                  data['visibleTo'] as string[] | undefined,
                  hostId,
                ),
              )
              .map(({ id, data }) => ({
                id,
                name: contactDisplayName(data, contactGroupId ?? hostId).trim(),
                email: normalizeContactEmail(data['email']),
              })),
          })
        })
        .catch((error: unknown) => {
          if (!current) return
          if (!denied(error))
            console.error('[outreach] the contact search failed', error)
          setResult({ status: denied(error) ? 'refused' : 'error', data: [] })
        })
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [firestore, orgId, hostId, contactGroupId, email, token, idle])
  return { ...result, idle }
}
