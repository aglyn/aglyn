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
  type CrmDealContactRole,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import { doc, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmPicklist } from '../hooks/use-crm-picklist'
import { useCrmRecordNames } from '../hooks/use-crm-record-names'
import { type CrmOrgDoc, useCrmScope } from '../hooks/use-crm-scope'
import type { CrmRoutes } from '../model/crm-routes'
import { companyContactRolesOf, companyContactRolesSave } from '../model/deal-contact-roles'
import { ContactRolesEditor } from './contact-roles-editor'

export interface CompanyContactRolesCardProps {
  companyId: string
  company: { contactRoles?: unknown }
  /** The site the page is read under, or `null` at the organization level. */
  hostId: string | null
  org: CrmOrgDoc
  routes: CrmRoutes
  /** The listener's verdict on the company, for the stale-seed guard. */
  fromCache: boolean
  unreadable: boolean
}

/**
 * Salesforce's Account Contact Roles (AGL-4122): who at a company plays which
 * part, and who the Primary is. Separate from the roles on a deal, as there: a
 * person's part in the company is a fact about the account, and their part in
 * one deal can differ. The same list of roles serves both.
 */
export function CompanyContactRolesCard(props: CompanyContactRolesCardProps) {
  const { companyId, company, hostId, org, routes, fromCache, unreadable } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const scope = useCrmScope({ hostId, org })
  const groupId = scope.consentGroup?.groupId ?? null
  const roles = useMemo(() => companyContactRolesOf(company), [company])
  const roleList = useCrmPicklist('opportunityContactRole', scope.orgId)
  const nameOf = useCrmRecordNames({
    orgId: scope.orgId,
    groupId,
    org: (org ?? null) as Record<string, unknown> | null,
    records: roles.map((row) => ({ kind: 'contact' as const, id: row.contactId })),
  })
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const save = useCallback(
    async (next: CrmDealContactRole[], done: string) => {
      if (!scope.orgId) return false
      const verdict = companyContactRolesSave(company, next, roleList.picklist)
      if (verdict.ok === false) {
        enqueueSnackbar(verdict.error, { variant: 'warning', persist: false })
        return false
      }
      setBusy(true)
      try {
        const written = await writeGuardedBySeed(
          { subject: 'company', unreadable, fromCache },
          async () => {
            await updateDoc(
              doc(firestore, 'orgs', scope.orgId as string, CRM_COLLECTIONS.companies, companyId),
              {
                contactRoles: verdict.contactRoles,
                contactRoleContactIds: verdict.contactRoleContactIds,
                contactRoleKeys: verdict.contactRoleKeys,
                updatedAt: new Date(),
              },
            )
          },
        )
        if (!written.ok) {
          enqueueSnackbar(written.message, { variant: 'warning', persist: false })
          return false
        }
        enqueueSnackbar(done, { variant: 'success', persist: false })
        return true
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
        return false
      } finally {
        setBusy(false)
      }
    },
    [scope.orgId, company, roleList.picklist, unreadable, fromCache, firestore, companyId, enqueueSnackbar],
  )

  return (
    <ContactRolesEditor
      noun="company"
      roles={roles}
      busy={busy}
      adding={adding}
      onAddingChange={setAdding}
      ready={Boolean(scope.orgId)}
      hostId={hostId}
      org={org}
      routes={routes}
      picklist={roleList.picklist}
      nameOf={nameOf}
      help={pluginDocsHelp('companies', { anchor: '#contact-roles' })}
      emptyDescription="Name who at the company plays which part, one of them Primary."
      save={save}
    />
  )
}
CompanyContactRolesCard.displayName = 'CompanyContactRolesCard'

export default CompanyContactRolesCard
