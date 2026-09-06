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

import { CRM_COLLECTIONS, findOrgMember } from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Drawer,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { deleteDoc, doc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import type { CrmTaskRow } from '../hooks/use-crm-tasks'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import { saveCrmTask } from '../model/task-api'
import {
  CRM_TASK_NOTES_MAX,
  CRM_TASK_TITLE_MAX,
  type CrmTaskFields,
  crmTaskFieldsOf,
} from '../model/task-routes'
import {
  CRM_TASK_KIND_LABELS,
  CRM_TASK_KINDS,
  CRM_TASK_PRIORITIES,
  CRM_TASK_PRIORITY_LABELS,
  dueAtToLocalInput,
  localInputToDueAt,
} from '../model/task-views'
import { useCrmScope } from '../hooks/use-crm-scope'
import CrmRecordPicker from './crm-record-picker'
import { CrmSitePicker } from './crm-site-picker'
import TaskSnoozeMenu from './task-snooze-menu'

export interface TaskEditDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * The site the drawer is opened under, or `null` at the organization
   * level (AGL-2630), where a NEW task asks which site it is filed from and
   * an edit keeps the task's own.
   */
  hostId: string | null
  org?: Record<string, unknown> | null
  orgId: string | null | undefined
  scope: readonly [string, string] | null
  /** The reader's tokens, or `null` at the organization level — no clause. */
  readTokens: readonly string[] | null
  /** The task being edited; absent while creating. */
  task?: CrmTaskRow | null
  /**
   * What a "New task" button pressed on a record fills in before the person
   * types: the record's own id, so the link is made for them.
   */
  prefill?: Partial<CrmTaskFields>
  /**
   * The verdict of the listener the edited row came from. An edit is refused
   * when the seed is unconfirmed, for the reason the contacts drawer refuses:
   * every field on this form is written back on save, and a form seeded from
   * a stale cache writes the stale values over newer ones.
   */
  seed?: { fromCache: boolean; unreadable: boolean }
  onSaved?: (taskId: string) => void
}

/**
 * Create or edit one task (AGL-2599).
 *
 * A drawer on the list, the console's standing shape for creating — the
 * list stays where it was and the form slides over it. The same drawer edits,
 * because a task is small enough that "the record's own page" would be this
 * form with more air around it.
 *
 * The form is mounted only while the drawer is open and keyed by the task,
 * so opening a different task or "New task" after an edit starts from that
 * task's values and not from whatever was last typed.
 */
export function TaskEditDrawer(props: TaskEditDrawerProps) {
  const { open, onClose, task } = props
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      {open ? <TaskForm key={task?.$id ?? 'new'} {...props} /> : null}
    </Drawer>
  )
}
TaskEditDrawer.displayName = 'TaskEditDrawer'

function TaskForm(props: TaskEditDrawerProps) {
  const { onClose, hostId, org, orgId, scope, readTokens, task, prefill, seed, onSaved } =
    props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const directory = useOrgMemberDirectory(orgId)
  // The viewing group under a site, for a linked contact's facet name; null
  // at the organization level, where the picker names each contact through
  // its own holder. The site the route files a NEW task from is the mounted
  // one or the picked one; an edit goes back to the task's own.
  const { consentGroup, createHostId } = useCrmScope({ hostId, org })
  const groupId = consentGroup?.groupId ?? null
  const taskHostId = task ? (task.hostId ?? null) : createHostId

  const [fields, setFields] = useState<CrmTaskFields>(() => {
    const base = crmTaskFieldsOf(task ?? {})
    if (task) return base
    // A new task is the creator's own unless a button said otherwise: it
    // lands in "My tasks", and assigning it elsewhere is a choice made in
    // the picker rather than a default that notifies a teammate by accident.
    return { ...base, assigneeUid: user?.uid ?? null, ...prefill }
  })
  const assignee = findOrgMember(directory.members, fields.assigneeUid)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof CrmTaskFields>(key: K, value: CrmTaskFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    if (!fields.title.trim()) {
      setError('A task needs a title.')
      return
    }
    if (!taskHostId) {
      setError('Pick the site this task is filed from.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const write = async () => {
        const result = await saveCrmTask(user, {
          hostId: taskHostId,
          ...(task ? { taskId: task.$id } : {}),
          task: { ...fields, title: fields.title.trim() },
        })
        enqueueSnackbar(
          task
            ? 'Task saved'
            : result.notified
              ? 'Task created and the assignee notified'
              : 'Task created',
          { variant: 'success' },
        )
        onSaved?.(result.taskId)
        onClose()
      }
      if (task) {
        const verdict = await writeGuardedBySeed(
          {
            subject: 'task',
            fromCache: seed?.fromCache ?? false,
            unreadable: seed?.unreadable ?? false,
          },
          write,
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message ?? 'The task could not be saved.', {
            variant: 'warning',
          })
        }
      } else {
        await write()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The task could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  /*
   * Deleting is client-direct: it has no side effect outside the document,
   * and the rules gate it on the same predicate as any other CRM write.
   */
  const remove = async () => {
    if (!task || !scope) return
    const confirmed = await confirm({
      title: 'Delete this task?',
      description: `"${task.title}" is removed for everyone who can see it. Completed tasks can be kept instead — tick it done.`,
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await deleteDoc(
        doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.tasks, task.$id),
      )
      enqueueSnackbar('Task deleted', { variant: 'success' })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The task could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack
      component="form"
      spacing={2}
      sx={{ width: { xs: '100vw', sm: 420 }, p: 3 }}
      onSubmit={(event: { preventDefault: () => void }) => {
        event.preventDefault()
        void save()
      }}
    >
      <Typography variant="h6">{task ? 'Edit task' : 'New task'}</Typography>
      {/* Only a new task at the organization level asks — see `taskHostId`. */}
      {task ? null : <CrmSitePicker hostId={hostId} disabled={busy} />}
      <TextField
        label="Title"
        value={fields.title}
        onChange={(event) => set('title', event.target.value)}
        size="small"
        autoFocus
        required
        slotProps={{ htmlInput: { maxLength: CRM_TASK_TITLE_MAX } }}
      />
      <Stack direction="row" spacing={1}>
        <TextField
          select
          label="Kind"
          value={fields.kind}
          onChange={(event) => set('kind', event.target.value as CrmTaskFields['kind'])}
          size="small"
          sx={{ flex: 1 }}
        >
          {CRM_TASK_KINDS.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {CRM_TASK_KIND_LABELS[kind]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Priority"
          value={fields.priority}
          onChange={(event) =>
            set('priority', event.target.value as CrmTaskFields['priority'])
          }
          size="small"
          sx={{ flex: 1 }}
        >
          {CRM_TASK_PRIORITIES.map((priority) => (
            <MenuItem key={priority} value={priority}>
              {CRM_TASK_PRIORITY_LABELS[priority]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          label="Due"
          type="datetime-local"
          value={dueAtToLocalInput(fields.dueAtMs)}
          onChange={(event) => set('dueAtMs', localInputToDueAt(event.target.value))}
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
          helperText="Leave empty for a task with no due date."
          sx={{ flex: 1 }}
        />
        {/*
          A stored task is snoozed in place — the one write lands and the
          field follows it, so a later Save carries the same date. A task
          that does not exist yet has nothing to write, so the same menu
          fills the field and the save is the write.
        */}
        <TaskSnoozeMenu
          variant="button"
          dueAtMs={fields.dueAtMs}
          disabled={busy}
          target={
            task && scope
              ? { write: { scope, taskId: task.$id } }
              : { pick: (dueAtMs) => set('dueAtMs', dueAtMs) }
          }
          onSnoozed={(dueAtMs) => set('dueAtMs', dueAtMs)}
        />
      </Stack>
      <TextField
        select
        label="Assignee"
        // The stored assignee resolved to a member — by uid, or by an
        // address the roster has — so the picker highlights the person and
        // a save writes their uid. One the roster does not hold is kept as
        // its own option: a controlled select whose value is absent from
        // its options renders empty, which reads as unassigned.
        value={assignee?.uid ?? fields.assigneeUid ?? ''}
        onChange={(event) => set('assigneeUid', event.target.value || null)}
        size="small"
        disabled={directory.loading}
        helperText={
          directory.error ??
          (fields.assigneeUid && fields.assigneeUid !== user?.uid
            ? 'They will be notified when you save.'
            : undefined)
        }
      >
        <MenuItem value="">{'Unassigned'}</MenuItem>
        {fields.assigneeUid && !assignee ? (
          <MenuItem value={fields.assigneeUid}>{directory.nameOf(fields.assigneeUid)}</MenuItem>
        ) : null}
        {directory.members.map((member) => (
          <MenuItem key={member.uid} value={member.uid}>
            {member.label}
            {member.uid === user?.uid ? ' (you)' : ''}
          </MenuItem>
        ))}
      </TextField>
      <Typography variant="overline" color="text.secondary">
        {'Linked to'}
      </Typography>
      <CrmRecordPicker
        kind="contact"
        scope={scope}
        readTokens={readTokens}
        groupId={groupId}
        org={org}
        value={fields.contactId}
        onChange={(id) => set('contactId', id)}
        disabled={busy}
      />
      <CrmRecordPicker
        kind="company"
        scope={scope}
        readTokens={readTokens}
        groupId={groupId}
        org={org}
        value={fields.companyId}
        onChange={(id) => set('companyId', id)}
        disabled={busy}
      />
      <CrmRecordPicker
        kind="deal"
        scope={scope}
        readTokens={readTokens}
        groupId={groupId}
        org={org}
        value={fields.dealId}
        onChange={(id) => set('dealId', id)}
        disabled={busy}
      />
      <TextField
        label="Notes"
        value={fields.notes}
        onChange={(event) => set('notes', event.target.value)}
        size="small"
        multiline
        minRows={3}
        slotProps={{ htmlInput: { maxLength: CRM_TASK_NOTES_MAX } }}
      />
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {task ? (
          <Button
            color="error"
            onClick={() => void remove()}
            disabled={busy}
            sx={{ mr: 'auto' }}
          >
            {'Delete'}
          </Button>
        ) : null}
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !taskHostId}>
          {task ? 'Save' : 'Create task'}
        </Button>
      </Stack>
    </Stack>
  )
}
TaskForm.displayName = 'TaskForm'

export default TaskEditDrawer
