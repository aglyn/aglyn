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
  type CrmDealContactRole,
  dealContactRolesWithout,
  dealContactRolesWithPrimary,
} from '@aglyn/aglyn'
import { mdiAccountPlusOutline, mdiAccountRemoveOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
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
import { useHeldSave } from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'
import { type ComponentProps, useState } from 'react'
import type { useCrmPicklist } from '../hooks/use-crm-picklist'
import { type CrmOrgDoc, useCrmScope } from '../hooks/use-crm-scope'
import type { CrmRoutes } from '../model/crm-routes'
import {
  dealContactRoleAddProblem,
  dealContactRolesAdded,
  dealContactRolesWithRole,
} from '../model/deal-contact-roles'
import CrmRecordPicker from './crm-record-picker'
import { CrmPicklistSelect } from './picklist-select'

/** What the roles are on, as a sentence names it. */
export type ContactRolesNoun = 'deal' | 'company'

export interface ContactRolesEditorProps {
  noun: ContactRolesNoun
  roles: readonly CrmDealContactRole[]
  busy: boolean
  adding: boolean
  onAddingChange: (adding: boolean) => void
  /** The org has loaded, so a contact can be picked. */
  ready: boolean
  hostId: string | null
  org: CrmOrgDoc
  routes: CrmRoutes
  picklist: ReturnType<typeof useCrmPicklist>['picklist']
  nameOf: (kind: 'contact', id: string) => string | undefined
  help: ComponentProps<typeof CardDisplay>['help']
  emptyDescription: string
  /** Writes the whole list, and answers whether it landed. */
  save: (next: CrmDealContactRole[], done: string) => Promise<boolean>
  /**
   * The record is not confirmed by the server yet (AGL-4047): every change is
   * held, with this sentence beside it, rather than pressed into a wait that
   * can end refused. Build it with `seedCheckingText`.
   */
  checkingText?: string
}

/**
 * THE PEOPLE ON A RECORD, AND THE PART EACH PLAYS: Salesforce's Contact Roles,
 * on a deal (AGL-3521) and on a company (AGL-4122).
 *
 * One card, because the two differ only in what a save writes, which is each
 * record's own. A role is one of the org's `opportunityContactRole` values, and
 * adding opens a dialog rather than a row of fields above the list.
 */
export function ContactRolesEditor(props: ContactRolesEditorProps) {
  const {
    noun,
    roles,
    busy,
    adding,
    onAddingChange,
    ready,
    hostId,
    org,
    routes,
    picklist,
    nameOf,
    help,
    emptyDescription,
    save,
    checkingText,
  } = props
  // Held while the server has not answered, the same as while a save runs.
  const held = busy || Boolean(checkingText)

  const addButton = (variant: 'text' | 'contained') => (
    <Button
      size="small"
      variant={variant}
      startIcon={<MdiIcon path={mdiAccountPlusOutline.path} size={0.8} />}
      disabled={held || !ready}
      onClick={() => onAddingChange(true)}
    >
      {'Add contact'}
    </Button>
  )

  return (
    <>
      <CardDisplay
        header={'Contact roles'}
        help={help}
        HeaderProps={{ action: addButton('text') }}
        contentGutterX
        contentGutterY
      >
        {checkingText ? (
          <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>
            {checkingText}
          </Typography>
        ) : null}
        {roles.length === 0 ? (
          <EmptyStateComponent
            compact
            label={`No contacts on this ${noun}`}
            description={emptyDescription}
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
                      picklist={picklist}
                      label="Role"
                      value={row.role ?? ''}
                      stored={row.role}
                      disabled={held}
                      onChange={(role) =>
                        void save(dealContactRolesWithRole(roles, row.contactId, role), 'Role saved')
                      }
                    />
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    {row.primary ? null : (
                      <Button
                        size="small"
                        disabled={held}
                        onClick={() =>
                          void save(dealContactRolesWithPrimary(roles, row.contactId), 'Primary contact set')
                        }
                      >
                        {'Make primary'}
                      </Button>
                    )}
                    <Tooltip title={`Remove ${name} from this ${noun}`}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Remove ${name} from this ${noun}`}
                          disabled={held}
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
        noun={noun}
        open={adding}
        busy={busy}
        checkingText={checkingText}
        roles={roles}
        hostId={hostId}
        org={org}
        picklist={picklist}
        onClose={() => onAddingChange(false)}
        onAdd={async (added) => {
          const ok = await save(dealContactRolesAdded(roles, added), 'Contact added')
          if (ok) onAddingChange(false)
          return ok
        }}
      />
    </>
  )
}
ContactRolesEditor.displayName = 'ContactRolesEditor'

interface AddContactRoleDialogProps {
  noun: ContactRolesNoun
  open: boolean
  busy: boolean
  /** Add is held while the record is unconfirmed (AGL-4047). */
  checkingText?: string
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
  const { noun, open, busy, checkingText, roles, hostId, org, picklist, onClose, onAdd } = props
  const scope = useCrmScope({ hostId, org })
  const [contactId, setContactId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  // The first contact on a record is always its Primary; later ones when ticked.
  const [primary, setPrimary] = useState(false)
  const problem = contactId ? dealContactRoleAddProblem(roles, contactId, noun) : null

  const reset = () => {
    setContactId(null)
    setRole('')
    setPrimary(false)
  }
  const close = () => {
    reset()
    onClose()
  }
  const add = async () => {
    if (!contactId) return
    const added = await onAdd({
      contactId,
      role: role || undefined,
      primary: primary || roles.length === 0,
    })
    if (added) reset()
  }
  /*
   * An Add pressed while the record is held is kept, and adds once the record
   * is confirmed, onto the confirmed roles (AGL-4047). If no confirmation
   * comes, the refusal shows here and nothing is added.
   */
  const held = useHeldSave(add, {
    checking: Boolean(checkingText),
    subject: noun,
  })

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs">
      <DialogTitle>{`Add a contact to this ${noun}`}</DialogTitle>
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
        {held.refusal ? (
          <Typography variant="body2" color="warning.main" role="alert" sx={{ mr: 'auto' }}>
            {held.refusal}
          </Typography>
        ) : checkingText ? (
          <Typography variant="body2" color="text.secondary" role="status" sx={{ mr: 'auto' }}>
            {checkingText}
          </Typography>
        ) : null}
        <Button onClick={close} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || held.saving || !contactId || Boolean(problem)}
          onClick={held.press}
        >
          {held.saving ? 'Saving…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
