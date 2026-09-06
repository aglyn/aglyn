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

import { CRM_COLLECTIONS } from '@aglyn/aglyn'
import { mdiAlarmSnooze } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
} from '@mui/material'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useState } from 'react'
import {
  CRM_TASK_SNOOZE_OPTIONS,
  type CrmTaskSnoozeOption,
  describeTaskDue,
  dueAtToLocalInput,
  localInputToDueAt,
  snoozeDueAt,
} from '../model/task-views'

/**
 * What a chosen date does.
 *
 * `write` is the one-field write on the stored task — a row's snooze, and
 * the drawer's for a task that exists. `pick` hands the date back to a form
 * that has no document yet, so "New task" can offer the same three choices
 * for its due date and the save is the write.
 */
export type TaskSnoozeTarget =
  | { write: { scope: readonly [string, string]; taskId: string } }
  | { pick: (dueAtMs: number) => void }

export interface TaskSnoozeMenuProps {
  /** The task's current due date; the time of day is kept across a snooze. */
  dueAtMs: number | null | undefined
  target: TaskSnoozeTarget
  /** An icon on a row, a labeled button in the drawer. */
  variant?: 'icon' | 'button'
  disabled?: boolean
  /** Told the new due date once it is applied, so a form holding a copy can follow. */
  onSnoozed?: (dueAtMs: number) => void
}

/**
 * Tomorrow, next week, or a date — one write (AGL-2619).
 *
 * A snooze is the smallest edit a task has: the due date moves and nothing
 * else changes. So it is a client-direct `updateDoc` of that one field,
 * under the same rule any CRM update answers to, and not a trip through
 * `crm/task-save` — that route rewrites every field and exists for the side
 * effects a save has (an assignee's notification), of which a snooze has
 * none. Writing one field is also why this needs no seed guard: the hazard
 * the drawer guards against is a whole form of stale values going back
 * over newer ones, and a single new value has no stale neighbors.
 *
 * Every click inside stops at this component's edge, menu and dialog
 * included, because the row it sits on opens the drawer on click and a
 * snooze is not an edit.
 */
export function TaskSnoozeMenu(props: TaskSnoozeMenuProps) {
  const { dueAtMs, target, variant = 'icon', disabled, onSnoozed } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = async (next: number) => {
    setAnchor(null)
    setPicking(false)
    if ('pick' in target) {
      target.pick(next)
      onSnoozed?.(next)
      return
    }
    setBusy(true)
    try {
      const { scope, taskId } = target.write
      await updateDoc(doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.tasks, taskId), {
        dueAtMs: next,
        updatedAt: serverTimestamp(),
      })
      enqueueSnackbar(
        `Snoozed until ${describeTaskDue({ status: 'open', dueAtMs: next }, Date.now()).label}`,
        { variant: 'success' },
      )
      onSnoozed?.(next)
    } catch (cause) {
      enqueueSnackbar(
        cause instanceof Error ? cause.message : 'The task could not be snoozed.',
        { variant: 'warning' },
      )
    } finally {
      setBusy(false)
    }
  }

  const choose = (option: CrmTaskSnoozeOption) => {
    void apply(snoozeDueAt(option, dueAtMs, Date.now()))
  }
  const openPicker = () => {
    setAnchor(null)
    // Tomorrow at the task's own time is where a person usually starts.
    setPicked(dueAtToLocalInput(snoozeDueAt('tomorrow', dueAtMs, Date.now())))
    setPicking(true)
  }
  const pickedMs = localInputToDueAt(picked)
  const confirmPick = () => {
    if (pickedMs === null) return
    void apply(pickedMs)
  }
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  const open = (event: { currentTarget: HTMLElement }) => setAnchor(event.currentTarget)
  const idle = !disabled && !busy

  return (
    <Box component="span" onClick={stop} sx={{ display: 'inline-flex' }}>
      {variant === 'button' ? (
        <Button
          size="small"
          onClick={open}
          disabled={!idle}
          startIcon={<MdiIcon path={mdiAlarmSnooze.path} fontSize="small" />}
        >
          {'Snooze'}
        </Button>
      ) : (
        <Tooltip title="Snooze">
          <span>
            <IconButton size="small" aria-label="Snooze" onClick={open} disabled={!idle}>
              <MdiIcon path={mdiAlarmSnooze.path} fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {CRM_TASK_SNOOZE_OPTIONS.map((option) => (
          <MenuItem key={option.id} onClick={() => choose(option.id)}>
            {option.label}
          </MenuItem>
        ))}
        <MenuItem onClick={openPicker}>{'Pick a date…'}</MenuItem>
      </Menu>
      <Dialog open={picking} onClose={() => setPicking(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{'Snooze until'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Due"
            type="datetime-local"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            size="small"
            fullWidth
            autoFocus
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPicking(false)}>{'Cancel'}</Button>
          <Button variant="contained" onClick={confirmPick} disabled={pickedMs === null}>
            {'Snooze'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
TaskSnoozeMenu.displayName = 'TaskSnoozeMenu'

export default TaskSnoozeMenu
