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
  CRM_COLLECTIONS,
  CRM_EMAIL_TEMPLATES_LIMIT,
  type CrmEmailTemplateRow,
  crmEmailTemplateIsListed,
  normalizeCrmEmailTemplate,
  ORG_SCOPE_TOKEN,
  type ScopeToken,
} from '@aglyn/aglyn'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  type CrmOrgDoc,
  crmScopeListable,
  crmVisibleToClause,
  useCrmScope,
} from './use-crm-scope'

const ORG_TOKENS: readonly ScopeToken[] = Object.freeze([ORG_SCOPE_TOKEN])
const NO_ROWS: CrmEmailTemplateRow[] = []

export interface CrmEmailTemplateScope {
  /** The org data root, or `null` until the org lookup settles or when there is none. */
  scope: readonly ['orgs', string] | null
  orgId: string | null
  ready: boolean
  /** The listener's clause under a site; `null` at the organization level. */
  visibleTo: readonly ScopeToken[] | null
  /**
   * The site a template written here is filed under, or `null` for the
   * organization's own — see {@link useCrmEmailTemplateScope}.
   */
  createHostId: string | null
  /** What a template written here is stamped with; empty while no site is known. */
  createTokens: readonly ScopeToken[]
  /** The holder group whose facet the merge fields read a contact by. */
  groupId: string | null
}

/**
 * Where an email template lives, for the surface writing or listing it
 * (AGL-2658).
 *
 * Under a site it is the site's, as a task is: stamped with the site's
 * tokens and `hostId`. From the ORGANIZATION's own hub it is the
 * organization's — `hostId: null`, the org token alone — the way an
 * organization task is (AGL-2637): a letter the whole workspace keeps is
 * not one brand's, and the org-level reader is an org-wide member who may
 * stamp it so. Every site's hub lists it beside its own, because a site's
 * read tokens carry the org token.
 */
export function useCrmEmailTemplateScope(props: {
  hostId: string | null | undefined
  org?: CrmOrgDoc
}): CrmEmailTemplateScope {
  const crmScope = useCrmScope(props)
  return useMemo(
    () =>
      crmScope.level === 'org'
        ? {
            scope: crmScope.scope,
            orgId: crmScope.orgId,
            ready: crmScope.ready,
            visibleTo: null,
            createHostId: null,
            createTokens: ORG_TOKENS,
            groupId: crmScope.createGroup?.groupId ?? null,
          }
        : {
            scope: crmScope.scope,
            orgId: crmScope.orgId,
            ready: crmScope.ready,
            visibleTo: crmScope.visibleTo,
            createHostId: crmScope.createHostId,
            createTokens: crmScope.createTokens,
            groupId: crmScope.consentGroup?.groupId ?? null,
          },
    [crmScope],
  )
}

/**
 * The templates and snippets this member may pick from (AGL-2658): every
 * shared one the reader's scope reaches, and the personal ones they own.
 *
 * ONE bounded listener, filtered on the reader's tokens like every CRM read
 * and ordered by name — the `(visibleTo, name)` index under a site, the
 * automatic single-field one at the organization level. A colleague's
 * personal template is readable under the rules and hidden here by
 * `crmEmailTemplateIsListed`, for the reason a private saved view is
 * (AGL-2617). Rows past the window are not listed; the console's create
 * stops at the window, so a workspace cannot write what its menu cannot
 * show.
 */
export function useCrmEmailTemplates(options: {
  scope: readonly ['orgs', string] | null
  /** The reader's tokens, or `null` at the organization level — no clause. */
  visibleTo: readonly string[] | null
  uid: string | null | undefined
}): { templates: CrmEmailTemplateRow[]; ready: boolean; fromCache: boolean } {
  const { scope, visibleTo, uid } = options
  const firestore = useFirestore()
  const { data, status, fromCache } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      scope && crmScopeListable(visibleTo)
        ? query(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.emailTemplates),
            ...crmVisibleToClause(visibleTo),
            orderBy('name'),
            limit(CRM_EMAIL_TEMPLATES_LIMIT),
          )
        : null,
    [firestore, scope, visibleTo],
    { idField: '$id' },
  )
  const templates = useMemo<CrmEmailTemplateRow[]>(() => {
    if (!data?.length) return NO_ROWS
    return data
      .map((row) => ({ $id: String(row['$id']), ...normalizeCrmEmailTemplate(row) }))
      .filter((template) => template.name && crmEmailTemplateIsListed(template, uid))
  }, [data, uid])
  return { templates, ready: Boolean(scope) && status !== 'loading', fromCache }
}

export default useCrmEmailTemplates
