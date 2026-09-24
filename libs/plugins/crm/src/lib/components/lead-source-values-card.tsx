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
  CRM_LEAD_SOURCE_PICKLIST,
  CRM_LEAD_TEXT_MAX,
  type CrmPicklist,
  type CrmPicklistValue,
  crmPicklistActiveValues,
  newResourceScopeFields,
  ORG_SCOPE_TOKEN,
} from '@aglyn/aglyn'
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiDeleteOutline,
  mdiDragVertical,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiPencilOutline,
  mdiStarOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useLeadSourcePicklist } from '../hooks/use-lead-source-picklist'
import {
  addPicklistValue,
  crmLeadSourceValuesRouteUrl,
  type LeadSourceValuesRequest,
  type LeadSourceValuesResponse,
  movePicklistValue,
  setPicklistDefault,
  setPicklistValueActive,
  sortPicklistValues,
} from '../model/lead-source-values'
import { crmTaskCallScope } from '../model/task-routes'

export interface LeadSourceValuesCardProps {
  /** The mounted site, or `null` at the organization level. */
  hostId: string | null
  /** The org whose list this is; `null` while it settles. */
  orgId: string | null
  /** The site a newly written list records as its definer — the Fields page's own. */
  createHostId: string | null
}

/** The add and rename dialog's state: which value, if any, is being renamed. */
type NameDialog = { mode: 'add' } | { mode: 'rename'; value: CrmPicklistValue } | null

/**
 * THE LEAD SOURCE VALUES (AGL-3298) — Salesforce's Lead Source picklist,
 * managed where the org's lead fields are.
 *
 * Every move that touches only the LIST — add, reorder by drag or arrows,
 * sort A–Z, activate, deactivate, default — is one client write of the
 * whole document, guarded against a cached read like every seeded save on
 * the Fields page. The two that change RECORDS — rename, and delete with a
 * replacement — go to `crm/lead-source-values`, which rewrites the list and
 * every lead and contact holding the old label together; see that route.
 *
 * An org that has never edited its list reads the starter set, and the
 * first move here writes it down as the org's own.
 */
export function LeadSourceValuesCard(props: LeadSourceValuesCardProps) {
  const { hostId, orgId, createHostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { picklist, stored, ready, fromCache } = useLeadSourcePicklist(orgId)
  const [busy, setBusy] = useState(false)
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)
  const [draftName, setDraftName] = useState('')
  const [nameError, setNameError] = useState('')
  const [deleting, setDeleting] = useState<CrmPicklistValue | null>(null)
  const [replaceWith, setReplaceWith] = useState('')
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  /** Write the whole list — the list-only moves above. */
  const save = useCallback(
    async (next: CrmPicklist, done: string) => {
      if (!orgId || busy) return
      setBusy(true)
      try {
        const verdict = await writeGuardedBySeed({ subject: 'lead source list', fromCache }, () =>
          setDoc(
            doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.picklists, CRM_LEAD_SOURCE_PICKLIST),
            {
              values: next.values,
              defaultValueId: next.defaultValueId,
              updatedAt: serverTimestamp(),
              // The org-wide stamp the rules require of a new CRM document,
              // the same one a field definition carries.
              ...(stored
                ? {}
                : {
                    hostId: createHostId,
                    createdAt: serverTimestamp(),
                    ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
                  }),
            },
            { merge: true },
          ),
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
          return
        }
        enqueueSnackbar(done, { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('The lead sources could not be saved.', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusy(false)
      }
    },
    [orgId, busy, fromCache, firestore, stored, createHostId, enqueueSnackbar],
  )

  /** A rename or a delete — the moves that change records too. */
  const post = useCallback(
    async (request: LeadSourceValuesRequest): Promise<LeadSourceValuesResponse | null> => {
      const scope = crmTaskCallScope(hostId, orgId)
      if (!scope || busy) return null
      setBusy(true)
      try {
        const response = await authorizedFetch(user, crmLeadSourceValuesRouteUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, ...scope }),
        })
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        if (!response.ok) {
          enqueueSnackbar(payload.error || 'The lead sources could not be saved.', {
            variant: 'warning',
            persist: false,
          })
          return null
        }
        return payload as LeadSourceValuesResponse
      } catch (error) {
        console.error(error)
        enqueueSnackbar('The lead sources could not be saved.', { variant: 'error', allowDuplicate: true })
        return null
      } finally {
        setBusy(false)
      }
    },
    [hostId, orgId, busy, user, enqueueSnackbar],
  )

  const moved = (result: LeadSourceValuesResponse) => {
    const records = result.leads + result.contacts
    return records
      ? ` — ${result.leads.toLocaleString()} lead${result.leads === 1 ? '' : 's'} and ` +
          `${result.contacts.toLocaleString()} contact${result.contacts === 1 ? '' : 's'} updated`
      : ''
  }

  const openAdd = () => {
    setDraftName('')
    setNameError('')
    setNameDialog({ mode: 'add' })
  }
  const openRename = (value: CrmPicklistValue) => {
    setDraftName(value.label)
    setNameError('')
    setNameDialog({ mode: 'rename', value })
  }

  const submitName = async () => {
    if (!nameDialog) return
    if (nameDialog.mode === 'add') {
      const move = addPicklistValue(picklist, draftName)
      if (move.ok === false) return void setNameError(move.error)
      setNameDialog(null)
      await save(move.picklist, `“${draftName.trim()}” added`)
      return
    }
    const result = await post({ action: 'rename', valueId: nameDialog.value.id, label: draftName })
    if (!result) return
    setNameDialog(null)
    enqueueSnackbar(`Renamed${moved(result)}`, { variant: 'success', persist: false })
  }

  const openDelete = (value: CrmPicklistValue) => {
    setReplaceWith('')
    setDeleting(value)
  }
  const submitDelete = async () => {
    if (!deleting) return
    const result = await post({
      action: 'delete',
      valueId: deleting.id,
      replaceWith: replaceWith || null,
    })
    if (!result) return
    setDeleting(null)
    enqueueSnackbar(`“${deleting.label}” deleted${moved(result)}`, {
      variant: 'success',
      persist: false,
    })
  }

  const move = (from: number, to: number) =>
    void save(movePicklistValue(picklist, from, to), 'Order saved')

  const rowActions = (value: CrmPicklistValue): RowActionsMenuItem[] => {
    const isDefault = picklist.defaultValueId === value.id
    return [
      {
        key: 'rename',
        label: 'Rename',
        icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
        disabled: busy,
        onClick: () => openRename(value),
      },
      {
        key: 'default',
        label: isDefault ? 'Clear default' : 'Make default',
        icon: <MdiIcon path={mdiStarOutline.path} size={0.8} />,
        disabled: busy || (!isDefault && !value.active),
        disabledReason: !value.active ? 'An inactive value cannot be the default' : undefined,
        onClick: () =>
          void save(
            setPicklistDefault(picklist, isDefault ? null : value.id),
            isDefault ? 'Default cleared' : `New leads start as “${value.label}”`,
          ),
      },
      {
        key: 'active',
        label: value.active ? 'Deactivate' : 'Activate',
        icon: (
          <MdiIcon path={value.active ? mdiEyeOffOutline.path : mdiEyeOutline.path} size={0.8} />
        ),
        disabled: busy,
        onClick: () =>
          void save(
            setPicklistValueActive(picklist, value.id, !value.active),
            value.active ? `“${value.label}” deactivated` : `“${value.label}” activated`,
          ),
      },
      {
        key: 'delete',
        label: 'Delete…',
        icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
        destructive: true,
        disabled: busy,
        onClick: () => openDelete(value),
      },
    ]
  }

  const replacements = crmPicklistActiveValues(picklist).filter(
    (value) => value.id !== deleting?.id,
  )

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Stack spacing={0.25}>
          <Typography variant="subtitle1">{'Lead source values'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {'The choices in every lead’s Lead source select, in this order. ' +
              'An import or an API write naming anything else is refused. ' +
              'A deactivated value stays on the records that hold it.'}
          </Typography>
        </Stack>
        {orgId ? (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              size="small"
              disabled={busy || picklist.values.length < 2}
              onClick={() => void save(sortPicklistValues(picklist), 'Sorted A–Z')}
            >
              {'Sort A–Z'}
            </Button>
            <Button size="small" variant="outlined" disabled={busy} onClick={openAdd}>
              {'Add value'}
            </Button>
          </Stack>
        ) : null}
      </Stack>
      {!ready ? null : (
        <ScrollTable size="small" aria-label="Lead source values">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 120 }}>{'Order'}</TableCell>
              <TableCell>{'Value'}</TableCell>
              <TableCell>{'Status'}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {picklist.values.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary">
                    {'No values yet. Add one, and every lead can be given it.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
            {picklist.values.map((value, index) => (
              <TableRow
                key={value.id}
                hover
                // Native drag and drop for a pointer; the arrows beside the
                // handle are the same move for a keyboard or a touch screen.
                draggable={!busy}
                onDragStart={(event) => {
                  setDragFrom(index)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  if (dragFrom === null) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragFrom !== null && dragFrom !== index) move(dragFrom, index)
                  setDragFrom(null)
                }}
                onDragEnd={() => setDragFrom(null)}
                sx={{
                  ...(value.active ? {} : { opacity: 0.6 }),
                  ...(dragFrom === index ? { outline: 1, outlineColor: 'primary.main' } : {}),
                }}
              >
                <TableCell>
                  <Stack direction="row" spacing={0} sx={{ alignItems: 'center' }}>
                    <MdiIcon
                      path={mdiDragVertical.path}
                      size={0.8}
                      style={{ cursor: busy ? 'default' : 'grab' }}
                      aria-hidden
                    />
                    <IconButton
                      size="small"
                      disabled={index === 0 || busy}
                      onClick={() => move(index, index - 1)}
                    >
                      <MdiIcon path={mdiArrowUp.path} size={0.7} />
                      <SrOnly>{`Move ${value.label} up`}</SrOnly>
                    </IconButton>
                    <IconButton
                      size="small"
                      disabled={index === picklist.values.length - 1 || busy}
                      onClick={() => move(index, index + 1)}
                    >
                      <MdiIcon path={mdiArrowDown.path} size={0.7} />
                      <SrOnly>{`Move ${value.label} down`}</SrOnly>
                    </IconButton>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{value.label}</Typography>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    {value.active ? null : (
                      <Chip size="small" variant="outlined" color="warning" label="Inactive" />
                    )}
                    {picklist.defaultValueId === value.id ? (
                      <Chip size="small" variant="outlined" color="primary" label="Default" />
                    ) : null}
                    {value.active && picklist.defaultValueId !== value.id ? (
                      <Typography variant="body2" color="text.secondary">
                        {'Active'}
                      </Typography>
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={{ width: 56 }}>
                  <RowActionsMenu label={value.label} items={rowActions(value)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ScrollTable>
      )}
      {ready && !stored ? (
        <Typography variant="caption" color="text.secondary">
          {'This is the starter list. Your first change here makes it your organization’s own.'}
        </Typography>
      ) : null}

      <Dialog open={nameDialog !== null} onClose={() => setNameDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {nameDialog?.mode === 'rename' ? `Rename “${nameDialog.value.label}”` : 'Add a lead source'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {nameDialog?.mode === 'rename' ? (
              <DialogContentText variant="body2">
                {'Every lead and contact holding this value is updated to the new name.'}
              </DialogContentText>
            ) : null}
            <TextField
              size="small"
              label="Value"
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value)
                setNameError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitName()
              }}
              error={Boolean(nameError)}
              helperText={nameError || ' '}
              slotProps={{ htmlInput: { maxLength: CRM_LEAD_TEXT_MAX } }}
              autoFocus
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNameDialog(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={busy || !draftName.trim()}
            onClick={() => void submitName()}
          >
            {nameDialog?.mode === 'rename' ? 'Rename' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} fullWidth maxWidth="xs">
        <DialogTitle>{`Delete “${deleting?.label ?? ''}”?`}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <DialogContentText variant="body2">
              {'The value leaves the list for good. Leads and contacts that hold it ' +
                'are moved to the value you pick here, or cleared. To keep it on ' +
                'those records instead, deactivate it.'}
            </DialogContentText>
            <TextField
              select
              size="small"
              label="Replace it on existing records with"
              value={replaceWith}
              onChange={(event) => setReplaceWith(String(event.target.value))}
              fullWidth
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            >
              <MenuItem value="">{'None — clear it'}</MenuItem>
              {replacements.map((value) => (
                <MenuItem key={value.id} value={value.label}>
                  {value.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy}
            onClick={() => void submitDelete()}
          >
            {'Delete value'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
LeadSourceValuesCard.displayName = 'LeadSourceValuesCard'

export default LeadSourceValuesCard
