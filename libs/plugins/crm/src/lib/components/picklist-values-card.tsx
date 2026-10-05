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
  CRM_LEAD_TEXT_MAX,
  type CrmPicklist,
  type CrmPicklistDefinition,
  type CrmPicklistId,
  type CrmPicklistObject,
  type CrmPicklistValue,
  isStandardPicklistValueId,
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
import { useCrmPicklist } from '../hooks/use-crm-picklist'
import {
  addPicklistValue,
  crmPicklistValuesRouteUrl,
  movePicklistValue,
  picklistAddableMeanings,
  picklistKeepsGroups,
  picklistMeaningLabel,
  picklistReplacements,
  type PicklistValuesAction,
  type PicklistValuesRequest,
  type PicklistValuesResponse,
  setPicklistDefault,
  setPicklistValueActive,
  setPicklistValueGroup,
  sortPicklistValues,
} from '../model/picklist-values'
import { crmTaskCallScope } from '../model/task-routes'

export interface PicklistValuesCardProps {
  /** Which of the CRM's standard picklists this card manages. */
  picklistId: CrmPicklistId
  /** The mounted site, or `null` at the organization level. */
  hostId: string | null
  /** The org whose list this is; `null` while it settles. */
  orgId: string | null
  /** The site a newly written list records as its definer — the Fields page's own. */
  createHostId: string | null
}

/** Each object's noun, singular and plural, for the card's sentences. */
const OBJECT_NOUNS: Record<CrmPicklistObject, [string, string]> = {
  contact: ['contact', 'contacts'],
  company: ['company', 'companies'],
  deal: ['deal', 'deals'],
  lead: ['lead', 'leads'],
  task: ['task', 'tasks'],
}

/** "a", "a and b", "a, b and c". */
function sentenceList(words: readonly string[]): string {
  return words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** The objects whose records hold the field's label, in the definition's order. */
function targetObjects(definition: CrmPicklistDefinition): CrmPicklistObject[] {
  return [...new Set(definition.targets.map((target) => target.object))]
}

/** The add and rename dialog's state: which value, if any, is being renamed. */
type NameDialog = { mode: 'add' } | { mode: 'rename'; value: CrmPicklistValue } | null

/**
 * ONE STANDARD PICKLIST'S VALUES (AGL-3298, AGL-3510) — Salesforce's
 * picklist value set for a standard field, managed on the Fields tab of the
 * object the field belongs to.
 *
 * Standard values are marked, and cannot be deleted — every org has them —
 * but rename, reorder, regroup, deactivate and default are theirs as much
 * as an added value's. Every move that touches only the LIST — add,
 * reorder by drag or arrows, sort A–Z, activate, deactivate, group,
 * default — is one client write of the whole document, guarded against a
 * cached read like every seeded save on the Fields page. The ones that
 * change RECORDS — rename, and delete with a replacement, and on a list
 * whose records keep the value's group (Lead source's direction, AGL-3577)
 * group and add — go to `crm/picklist-values`, which rewrites the list and
 * every record the definition's targets name together; see that route.
 *
 * An org that has never edited the list reads the standard values, and the
 * first move here writes them down as the org's own.
 */
export function PicklistValuesCard(props: PicklistValuesCardProps) {
  const { picklistId, hostId, orgId, createHostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { definition, picklist, stored, ready, fromCache } = useCrmPicklist(picklistId, orgId)
  const [busy, setBusy] = useState(false)
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)
  const [draftName, setDraftName] = useState('')
  const [draftGroup, setDraftGroup] = useState('')
  const [draftMeaning, setDraftMeaning] = useState('')
  const [nameError, setNameError] = useState('')
  const [deleting, setDeleting] = useState<CrmPicklistValue | null>(null)
  const [replaceWith, setReplaceWith] = useState('')
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const groups = definition.groups ?? []
  // Whether records keep a value's group, so a regroup and an add change them too.
  const keepsGroups = picklistKeepsGroups(definition)
  const meanings = definition.meanings ?? []
  // An added value may not take a meaning only the platform sets (AGL-3512).
  const addableMeanings = picklistAddableMeanings(definition)
  const [noun, nouns] = OBJECT_NOUNS[definition.object]
  const holders = targetObjects(definition).map((object) => OBJECT_NOUNS[object])
  // A list of suggestions only — a task's subjects (AGL-3517) — that no record holds.
  const suggestions = holders.length === 0
  const field = definition.label.toLowerCase()
  const failed = `The ${definition.plural} could not be saved.`
  const isStandard = (value: CrmPicklistValue) => isStandardPicklistValueId(definition, value.id)

  /** Write the whole list — the list-only moves above. */
  const save = useCallback(
    async (next: CrmPicklist, done: string) => {
      if (!orgId || busy) return
      setBusy(true)
      try {
        const verdict = await writeGuardedBySeed({ subject: `${field} list`, fromCache }, () =>
          setDoc(
            doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.picklists, picklistId),
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
        enqueueSnackbar(failed, { variant: 'error', allowDuplicate: true })
      } finally {
        setBusy(false)
      }
    },
    [orgId, busy, field, fromCache, firestore, picklistId, stored, createHostId, enqueueSnackbar, failed],
  )

  /** A rename or a delete — the moves that change records too. */
  const post = useCallback(
    async (request: PicklistValuesAction): Promise<PicklistValuesResponse | null> => {
      const scope = crmTaskCallScope(hostId, orgId)
      if (!scope || busy) return null
      setBusy(true)
      try {
        const response = await authorizedFetch(user, crmPicklistValuesRouteUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, picklistId, ...scope } satisfies PicklistValuesRequest),
        })
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        if (!response.ok) {
          enqueueSnackbar(payload.error || failed, { variant: 'warning', persist: false })
          return null
        }
        return payload as PicklistValuesResponse
      } catch (error) {
        console.error(error)
        enqueueSnackbar(failed, { variant: 'error', allowDuplicate: true })
        return null
      } finally {
        setBusy(false)
      }
    },
    [hostId, orgId, busy, user, picklistId, enqueueSnackbar, failed],
  )

  /** " — 2 leads and 1 contact updated", or nothing when no record held the value. */
  const moved = (result: PicklistValuesResponse) => {
    const counts = targetObjects(definition).map((object) => {
      const count = result.updated?.[object] ?? 0
      const [one, many] = OBJECT_NOUNS[object]
      return { count, text: `${count.toLocaleString()} ${count === 1 ? one : many}` }
    })
    return counts.some((entry) => entry.count)
      ? ` — ${sentenceList(counts.map((entry) => entry.text))} updated`
      : ''
  }

  const openAdd = () => {
    setDraftName('')
    setDraftGroup('')
    setDraftMeaning('')
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
      const move = addPicklistValue(definition, picklist, draftName, {
        group: draftGroup || null,
        meaning: draftMeaning || null,
      })
      if (move.ok === false) return void setNameError(move.error)
      if (keepsGroups) {
        // Records may already hold the label, and keep its group (AGL-3577).
        const result = await post({
          action: 'add',
          label: draftName,
          group: draftGroup || null,
          meaning: draftMeaning || null,
        })
        if (!result) return
        setNameDialog(null)
        enqueueSnackbar(`“${draftName.trim()}” added${moved(result)}`, {
          variant: 'success',
          persist: false,
        })
        return
      }
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
    const items: RowActionsMenuItem[] = [
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
            isDefault ? 'Default cleared' : `New ${nouns} start as “${value.label}”`,
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
    ]
    // A standard value is every organization's: it is deactivated, never deleted.
    if (!isStandard(value)) {
      items.push({
        key: 'delete',
        label: 'Delete…',
        icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
        destructive: true,
        disabled: busy,
        onClick: () => openDelete(value),
      })
    }
    return items
  }

  const replacements = deleting ? picklistReplacements(definition, picklist, deleting.id) : []
  const columns = 4 + (groups.length ? 1 : 0) + (meanings.length ? 1 : 0)
  const heldBy = sentenceList(holders.map(([, many]) => many)).replace(/^./, (letter) =>
    letter.toUpperCase(),
  )

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Stack spacing={0.25}>
          <Typography variant="subtitle1">{`${definition.label} values`}</Typography>
          <Typography variant="body2" color="text.secondary">
            {(suggestions
              ? `The suggestions every ${noun}’s ${definition.label} offers, in this order. ` +
                'Any text may still be typed, and renaming or deleting a suggestion ' +
                `changes no ${noun}. `
              : `The choices in every ${noun}’s ${definition.label} select, in this order. ` +
                (definition.restricted
                  ? 'An import or an API write naming anything else is refused. '
                  : '') +
                'A deactivated value stays on the records that hold it. ') +
              'Standard values come with every organization and cannot be deleted; ' +
              'add your own beside them.'}
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
        <ScrollTable size="small" aria-label={`${definition.label} values`}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 120 }}>{'Order'}</TableCell>
              <TableCell>{'Value'}</TableCell>
              {groups.length ? <TableCell>{'Group'}</TableCell> : null}
              {meanings.length ? <TableCell>{'Means'}</TableCell> : null}
              <TableCell>{'Status'}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {picklist.values.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns}>
                  <Typography variant="body2" color="text.secondary">
                    {`No values yet. Add one, and every ${noun} can be given it.`}
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
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2">{value.label}</Typography>
                    {isStandard(value) ? (
                      <Chip size="small" variant="outlined" label="Standard" />
                    ) : null}
                  </Stack>
                </TableCell>
                {groups.length ? (
                  <TableCell sx={{ minWidth: 150 }}>
                    <TextField
                      select
                      size="small"
                      variant="standard"
                      value={value.group ?? ''}
                      disabled={busy || !orgId}
                      onChange={(event) => {
                        const group = String(event.target.value) || null
                        const name = groups.find((entry) => entry.id === group)?.label
                        const done = name ? `“${value.label}” is ${name}` : `“${value.label}” has no group`
                        if (!keepsGroups) {
                          void save(setPicklistValueGroup(definition, picklist, value.id, group), done)
                          return
                        }
                        // Its records keep the group too (AGL-3577): the route moves both.
                        void post({ action: 'group', valueId: value.id, group }).then((result) => {
                          if (result) {
                            enqueueSnackbar(`${done}${moved(result)}`, { variant: 'success', persist: false })
                          }
                        })
                      }}
                      fullWidth
                      slotProps={{
                        select: { displayEmpty: true, 'aria-label': `Group of ${value.label}` },
                      }}
                    >
                      <MenuItem value="">{'None'}</MenuItem>
                      {groups.map((group) => (
                        <MenuItem key={group.id} value={group.id}>
                          {group.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                ) : null}
                {meanings.length ? (
                  // What the value means to the CRM: fixed for a standard value, and
                  // chosen when an added one is made.
                  <TableCell>
                    <Typography variant="body2" color={value.meaning ? 'text.primary' : 'text.secondary'}>
                      {value.meaning ? picklistMeaningLabel(definition, value.meaning) : '—'}
                    </Typography>
                  </TableCell>
                ) : null}
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
          {'These are the standard values. Your first change here makes the list your ' +
            'organization’s own.'}
        </Typography>
      ) : null}

      <Dialog open={nameDialog !== null} onClose={() => setNameDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {nameDialog?.mode === 'rename' ? `Rename “${nameDialog.value.label}”` : `Add a ${field}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {nameDialog?.mode === 'rename' && !suggestions ? (
              <DialogContentText variant="body2">
                {`Every ${sentenceList(holders.map(([one]) => one))} holding this value ` +
                  'is updated to the new name.'}
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
            {nameDialog?.mode === 'add' && groups.length ? (
              <TextField
                select
                size="small"
                label="Group"
                value={draftGroup}
                onChange={(event) => setDraftGroup(String(event.target.value))}
                fullWidth
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              >
                <MenuItem value="">{'None'}</MenuItem>
                {groups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {nameDialog?.mode === 'add' && meanings.length ? (
              <TextField
                select
                size="small"
                label="Means"
                value={draftMeaning}
                onChange={(event) => {
                  setDraftMeaning(String(event.target.value))
                  setNameError('')
                }}
                fullWidth
              >
                {addableMeanings.map((meaning) => (
                  <MenuItem key={meaning} value={meaning}>
                    {picklistMeaningLabel(definition, meaning)}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
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
              {suggestions
                ? `The suggestion leaves the list for good. No ${noun} changes.`
                : `The value leaves the list for good. ${heldBy} that hold it ` +
                  (meanings.length
                    ? 'are moved to the value you pick here, which means the same. '
                    : 'are moved to the value you pick here, or cleared. ') +
                  'To keep it on those records instead, deactivate it.'}
            </DialogContentText>
            {suggestions ? null : (
              <TextField
                select
                size="small"
                label="Replace it on existing records with"
                value={replaceWith}
                onChange={(event) => setReplaceWith(String(event.target.value))}
                fullWidth
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              >
                {/* A value with a meaning moves its records to another of that meaning, never off. */}
                {meanings.length ? null : <MenuItem value="">{'None — clear it'}</MenuItem>}
                {replacements.map((value) => (
                  <MenuItem key={value.id} value={value.label}>
                    {value.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy || (meanings.length > 0 && !replaceWith)}
            onClick={() => void submitDelete()}
          >
            {'Delete value'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
PicklistValuesCard.displayName = 'PicklistValuesCard'

export default PicklistValuesCard
