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
  dealContactRolesOf,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  writeGuardedBySeed,
  type ListenHandle,
} from '@aglyn/tenant-feature-instance'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import {
  isSeedChecking,
  seedCheckingText,
} from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'
import { useCallback, useMemo, useState } from 'react'
import { useCrmPicklist } from '../hooks/use-crm-picklist'
import { useCrmRecordNames } from '../hooks/use-crm-record-names'
import { type CrmOrgDoc, useCrmScope } from '../hooks/use-crm-scope'
import { CRM_DEAL_CONTACT_ROLE_LIST_FIELDS, crmClientListFields } from '../model/crm-list-query'
import type { CrmRoutes } from '../model/crm-routes'
import type { DealDoc } from '../model/deal-board-model'
import { dealContactRolesSave } from '../model/deal-contact-roles'
import { ContactRolesEditor } from './contact-roles-editor'

export interface DealContactRolesCardProps {
  deal: DealDoc
  /** The site the page is read under, or `null` at the organization level. */
  hostId: string | null
  org: CrmOrgDoc
  routes: CrmRoutes
  /** The listener's verdict on the deal, for the stale-seed guard. */
  fromCache: boolean
  unreadable: boolean
  /** The deal's listener, so a save waits on that read alone (AGL-4135). */
  listen?: ListenHandle | null
}

/**
 * Salesforce's Opportunity Contact Roles on a deal's page (AGL-3521): the
 * people on the deal, the part each plays, and which one is Primary.
 *
 * Every edit is one client-direct write of the whole list beside the
 * `contactId` its Primary names — the field every reader that came before
 * roles still reads — and the list fields a contact's page finds the deal
 * by. A role is one of the org's `opportunityContactRole` values, kept on
 * the Deals tab of Fields; a contact keeps the role it holds even once that
 * value is deactivated. Adding opens a dialog rather than a row of fields
 * above the list.
 */
export function DealContactRolesCard(props: DealContactRolesCardProps) {
  const { deal, hostId, org, routes, fromCache, unreadable, listen } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const scope = useCrmScope({ hostId, org })
  const groupId = scope.consentGroup?.groupId ?? null
  const roles = useMemo(() => dealContactRolesOf(deal), [deal])
  const roleList = useCrmPicklist('opportunityContactRole', scope.orgId)
  const nameOf = useCrmRecordNames({
    orgId: scope.orgId,
    groupId,
    org: (org ?? null) as Record<string, unknown> | null,
    records: roles.map((row) => ({ kind: 'contact' as const, id: row.contactId })),
  })
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  /** The one write: the list, its Primary as `contactId`, and the list fields. */
  const save = useCallback(
    async (next: CrmDealContactRole[], done: string) => {
      if (!scope.orgId) return false
      const verdict = dealContactRolesSave(deal, next, roleList.picklist)
      if (verdict.ok === false) {
        enqueueSnackbar(verdict.error, { variant: 'warning', persist: false })
        return false
      }
      const primaryName = verdict.contactId ? nameOf('contact', verdict.contactId) : undefined
      const patch: Record<string, unknown> = {
        contactRoles: verdict.contactRoles,
        contactId: verdict.contactId ?? deleteField(),
        // The name the drawer copies beside `contactId`, moved with the Primary.
        ...(verdict.primaryChanged ? { contactName: primaryName || deleteField() } : {}),
      }
      setBusy(true)
      try {
        const written = await writeGuardedBySeed(
          { subject: 'deal', unreadable, fromCache, listen },
          async () => {
            await updateDoc(doc(firestore, 'orgs', scope.orgId as string, CRM_COLLECTIONS.deals, deal.$id), {
              ...patch,
              ...crmClientListFields(
                'deals',
                deal as unknown as Record<string, unknown>,
                patch,
                CRM_DEAL_CONTACT_ROLE_LIST_FIELDS,
              ),
              updatedAt: new Date(),
            })
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
    [scope.orgId, deal, roleList.picklist, nameOf, unreadable, fromCache, listen, firestore, enqueueSnackbar],
  )

  return (
    <ContactRolesEditor
      noun="deal"
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
      help={pluginDocsHelp('deals', { anchor: '#contact-roles' })}
      emptyDescription="Name the people on the deal and the part each plays — one of them Primary."
      save={save}
      checkingText={
        isSeedChecking({ fromCache, unreadable }) ? seedCheckingText('deal') : undefined
      }
    />
  )
}
DealContactRolesCard.displayName = 'DealContactRolesCard'

export default DealContactRolesCard
