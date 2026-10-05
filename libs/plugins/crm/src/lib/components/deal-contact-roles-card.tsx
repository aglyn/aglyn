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
  dealContactRolesWithout,
  dealContactRolesWithPrimary,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiAccountPlusOutline, mdiAccountRemoveOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmPicklist } from '../hooks/use-crm-picklist'
import { useCrmRecordNames } from '../hooks/use-crm-record-names'
import { type CrmOrgDoc, useCrmScope } from '../hooks/use-crm-scope'
import { CRM_DEAL_CONTACT_ROLE_LIST_FIELDS, crmClientListFields } from '../model/crm-list-query'
import type { CrmRoutes } from '../model/crm-routes'
import type { DealDoc } from '../model/deal-board-model'
import {
  dealContactRoleAddProblem,
  dealContactRolesAdded,
  dealContactRolesSave,
  dealContactRolesWithRole,
} from '../model/deal-contact-roles'
import CrmRecordPicker from './crm-record-picker'
import { CrmPicklistSelect } from './picklist-select'

export interface DealContactRolesCardProps {
  deal: DealDoc
  /** The site the page is read under, or `null` at the organization level. */
  hostId: string | null
  org: CrmOrgDoc
  routes: CrmRoutes
  /** The listener's verdict on the deal, for the stale-seed guard. */
  fromCache: boolean
  unreadable: boolean
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
  const { deal, hostId, org, routes, fromCache, unreadable } = props
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
          { subject: 'deal', unreadable, fromCache },
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
    [scope.orgId, deal, roleList.picklist, nameOf, unreadable, fromCache, firestore, enqueueSnackbar],
  )

  const addButton = (variant: 'text' | 'contained') => (
    <Button
      size="small"
      variant={variant}
      startIcon={<MdiIcon path={mdiAccountPlusOutline.path} size={0.8} />}
      disabled={busy || !scope.orgId}
      onClick={() => setAdding(true)}
    >
      {'Add contact'}
    </Button>
  )

  return (
    <>
      <CardDisplay
        header={'Contact roles'}
        help={pluginDocsHelp('deals', { anchor: '#contact-roles' })}
        HeaderProps={{ action: addButton('text') }}
        contentGutterX
        contentGutterY
      >
        {roles.length === 0 ? (
          <EmptyStateComponent
            compact
            label={'No contacts on this deal'}
            description={'Name the people on the deal and the part each plays — one of them Primary.'}
            action={addButton('contained')}
          />
        ) : (
          <Stack spacing={1.5}>
            {roles.map((row) => {
              const name = nameOf('contact', row.contactId) || row.contactId
              return (
                <Stack
                  key={row.contactId}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: { sm: 'center' } }}
                >
                  <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
                    <Typography variant="body2" noWrap>
                      <AppLink href={routes.contact(row.contactId)}>{name}</AppLink>
                    </Typography>
                    {row.primary ? <Chip size="small" color="primary" label="Primary" /> : null}
                  </Stack>
                  <Box sx={{ width: { xs: '100%', sm: 220 } }}>
                    <CrmPicklistSelect
                      picklistId="opportunityContactRole"
                      picklist={roleList.picklist}
                      label="Role"
                      value={row.role ?? ''}
                      stored={row.role}
                      disabled={busy}
                      onChange={(role) =>
                        void save(dealContactRolesWithRole(roles, row.contactId, role), 'Role saved')
                      }
                    />
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    {row.primary ? null : (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() =>
                          void save(dealContactRolesWithPrimary(roles, row.contactId), 'Primary contact set')
                        }
                      >
                        {'Make primary'}
                      </Button>
                    )}
                    <Tooltip title={`Remove ${name} from this deal`}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Remove ${name} from this deal`}
                          disabled={busy}
                          onClick={() =>
                            void save(dealContactRolesWithout(roles, row.contactId), 'Contact removed')
                          }
                        >
                          <MdiIcon path={mdiAccountRemoveOutline.path} size={0.8} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
              )
            })}
          </Stack>
        )}
      </CardDisplay>
      <AddContactRoleDialog
        open={adding}
        busy={busy}
        roles={roles}
        hostId={hostId}
        org={org}
        picklist={roleList.picklist}
        onClose={() => setAdding(false)}
        onAdd={async (added) => {
          const ok = await save(dealContactRolesAdded(roles, added), 'Contact added')
          if (ok) setAdding(false)
          return ok
        }}
      />
    </>
  )
}
DealContactRolesCard.displayName = 'DealContactRolesCard'

interface AddContactRoleDialogProps {
  open: boolean
  busy: boolean
  roles: readonly CrmDealContactRole[]
  hostId: string | null
  org: CrmOrgDoc
  picklist: ReturnType<typeof useCrmPicklist>['picklist']
  onClose: () => void
  /** Answers whether the contact was added — the dialog keeps its picks when not. */
  onAdd: (added: { contactId: string; role?: string; primary: boolean }) => Promise<boolean>
}

/** Pick a contact, the part they play, and whether they are the Primary. */
function AddContactRoleDialog(props: AddContactRoleDialogProps) {
  const { open, busy, roles, hostId, org, picklist, onClose, onAdd } = props
  const scope = useCrmScope({ hostId, org })
  const [contactId, setContactId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  // The first contact on a deal is always its Primary; later ones when ticked.
  const [primary, setPrimary] = useState(false)
  const problem = contactId ? dealContactRoleAddProblem(roles, contactId) : null

  const reset = () => {
    setContactId(null)
    setRole('')
    setPrimary(false)
  }
  const close = () => {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs">
      <DialogTitle>{'Add a contact to this deal'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <CrmRecordPicker
            kind="contact"
            scope={scope.scope}
            readTokens={scope.visibleTo}
            groupId={scope.consentGroup?.groupId ?? null}
            org={(org ?? null) as Record<string, unknown> | null}
            value={contactId}
            onChange={setContactId}
            disabled={busy}
            helperText={problem ?? undefined}
          />
          <CrmPicklistSelect
            picklistId="opportunityContactRole"
            picklist={picklist}
            label="Role"
            value={role}
            onChange={setRole}
            disabled={busy}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={primary || roles.length === 0}
                disabled={busy || roles.length === 0}
                onChange={(event) => setPrimary(event.target.checked)}
              />
            }
            label="Primary contact"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !contactId || Boolean(problem)}
          onClick={async () => {
            if (!contactId) return
            const added = await onAdd({
              contactId,
              role: role || undefined,
              primary: primary || roles.length === 0,
            })
            if (added) reset()
          }}
        >
          {'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default DealContactRolesCard
