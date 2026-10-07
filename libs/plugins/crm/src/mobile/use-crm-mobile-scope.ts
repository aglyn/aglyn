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

import { useLiveDoc, useOrgAccess, type MobileOrgAccess } from '@aglyn/mobile-core'
import { useMemo } from 'react'
import { crmMobileScope, type CrmMobileScope, type CrmMobileScopeGap } from './crm-mobile-scope'

/*
 * The CRM's scope for the picked workspace and site, live (AGL-3622): the
 * org document (the consent groups) and the member's own row (their reach),
 * through `crmMobileScope` — the console's `useCrmScope` and
 * `useCrmFoldsScope` for the app.
 */

export interface CrmMobileScopeState {
  scope: CrmMobileScope | CrmMobileScopeGap
  access: MobileOrgAccess
  /** The org document, `{}` when it cannot be read, null while it loads. */
  org: Record<string, unknown> | null
}

export function useCrmMobileScope(
  firestore: unknown,
  orgId: string | null,
  hostId: string | null,
  uid: string | null,
): CrmMobileScopeState {
  const access = useOrgAccess(firestore, orgId, uid)
  const orgDoc = useLiveDoc<Record<string, unknown>>(firestore, orgId ? ['orgs', orgId] : null)
  const org = useMemo(
    () => (orgDoc.ready ? (orgDoc.data ?? {}) : null),
    [orgDoc.ready, orgDoc.data],
  )
  const scope = useMemo(
    () => crmMobileScope({ orgId, hostId, org, reach: access }),
    [orgId, hostId, org, access],
  )
  return { scope, access, org }
}
