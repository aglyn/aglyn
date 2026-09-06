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

/**
 * The bar over the tasks list, for whatever rows are ticked (AGL-2621).
 *
 * Complete them, hand them to somebody, move their due date, take them
 * into a spreadsheet, or delete them. Two of these have a side effect
 * outside the document and go through their ROUTE one task at a time:
 * completing fires `taskCompleted`, which only the server emits, and
 * assigning tells the assignee, which only the server may write into
 * somebody's inbox — so Complete goes through `crm/task-complete` and
 * Assign through `crm/task-save`, exactly as the checkbox and the drawer
 * do for one task. The due date and the delete have no effect beyond the
 * document, so they are batched client-direct writes under the rules,
 * as reopening is.
 */

import { CRM_COLLECTIONS } from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Button, MenuItem, TextField } from '@mui/material'
import { doc, serverTimestamp } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmBulkApply } from '../hooks/use-crm-bulk-apply'
import type { CrmTaskRow } from '../hooks/use-crm-tasks'
import type { OrgMemberDirectory } from '../hooks/use-org-member-directory'
import { downloadTextFile } from '../model/contacts-csv'
import {
  type CrmBulkPlan,
  type CrmBulkWrite,
  crmBulkWriters,
  runCrmBulkCalls,
  runCrmBulkWrites,
} from '../model/crm-bulk-writes'
import { completeCrmTask, saveCrmTask } from '../model/task-api'
import { crmTaskFieldsOf } from '../model/task-routes'
import { dueAtToLocalInput, localInputToDueAt } from '../model/task-views'
import { type TaskCsvOptions, tasksCsv } from '../model/tasks-csv'
import {
  type CrmBulkNoun,
  CrmBulkBarFrame,
  CrmBulkValueDialog,
  countNoun,
} from './crm-bulk-bar-frame'

export interface TasksBulkBarProps {
  /**
   * The site the task routes run as, or `null` at the organization level
   * (AGL-2630), where each call runs as its task's own capturing site.
   */
  hostId: string | null
  /** `['orgs', orgId]`, or `null` while the org is unresolved. */
  scope: readonly [string, string] | null
  rows: readonly CrmTaskRow[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
  /** The section's roster — already read for the Assignee column. */
  directory: OrgMemberDirectory
  /** How the export names the assignee and the linked records — the list's own. */
  csv?: TaskCsvOptions
}

const NOUN: CrmBulkNoun = { singular: 'task', plural: 'tasks' }

type PendingAction = 'assign' | 'due'

const ACTION_TITLES: Record<PendingAction, string> = {
  assign: 'Assign to',
  due: 'Set the due date',
}

const labelOf = (task: CrmTaskRow): string => task.title || task.$id

export function TasksBulkBar(props: TasksBulkBarProps) {
  if (!props.selected.length) return null
  return <TasksBulkBarBody {...props} />
}
TasksBulkBar.displayName = 'TasksBulkBar'

function TasksBulkBarBody(props: TasksBulkBarProps) {
  const { hostId, scope, rows, selected, onSelectedChange, directory, csv } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { confirm } = useConfirmationContext()
  const { busy, report, apply, dismissReport } = useCrmBulkApply({ recordKind: 'task' })

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected)
    return rows.filter((row) => chosen.has(row.$id))
  }, [rows, selected])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [value, setValue] = useState('')

  const writers = useMemo(
    () =>
      crmBulkWriters(firestore, (id) =>
        doc(firestore, scope?.[0] ?? 'orgs', scope?.[1] ?? '', CRM_COLLECTIONS.tasks, id),
      ),
    [firestore, scope],
  )

  const openAction = (action: PendingAction) => {
    setValue('')
    setPending(action)
  }

  const runPlan = useCallback(
    (plan: CrmBulkPlan, done: (count: number) => string) =>
      apply({
        attempted: plan.writes.length,
        skipped: plan.skipped,
        job: () => runCrmBulkWrites(writers, plan.writes, (write) => write.label),
        done,
      }),
    [apply, writers],
  )

  /** One route request per task, in order, named by title. */
  const runCalls = useCallback(
    (
      tasks: readonly CrmTaskRow[],
      call: (task: CrmTaskRow) => Promise<unknown>,
      done: (count: number) => string,
    ) =>
      apply({
        attempted: tasks.length,
        skipped: [],
        job: () => runCrmBulkCalls(tasks, labelOf, call),
        done,
      }),
    [apply],
  )

  /*
   * A task already done is left alone rather than sent: the route would
   * answer `alreadyDone` and write nothing, and a request that can only
   * answer nothing is not worth its round trip.
   */
  const handleComplete = useCallback(async () => {
    const open = selectedRows.filter((task) => task.status !== 'done')
    await runCalls(
      open,
      (task) => completeCrmTask(user, { hostId: hostId ?? task.hostId, taskId: task.$id }),
      (count) => `Completed ${countNoun(count, NOUN)}`,
    )
  }, [selectedRows, runCalls, user, hostId])

  const handleApply = useCallback(async () => {
    if (!pending || !scope) return
    const action = pending
    setPending(null)
    if (action === 'assign') {
      const assigneeUid = value || null
      const who = assigneeUid ? directory.nameOf(assigneeUid) : 'nobody'
      await runCalls(
        selectedRows,
        (task) =>
          saveCrmTask(user, {
            hostId: hostId ?? task.hostId,
            taskId: task.$id,
            task: { ...crmTaskFieldsOf(task), assigneeUid },
          }),
        (count) => `Assigned ${countNoun(count, NOUN)} to ${who}`,
      )
      return
    }
    const dueAtMs = localInputToDueAt(value)
    const writes: CrmBulkWrite[] = selectedRows.map((task) => ({
      id: task.$id,
      label: labelOf(task),
      kind: 'update',
      // `null` rather than a deleted field: every view orders by `dueAtMs`,
      // and a document missing it drops out of the `orderBy` entirely.
      data: { dueAtMs, updatedAt: serverTimestamp() },
    }))
    await runPlan(
      { writes, skipped: [] },
      (count) =>
        dueAtMs === null
          ? `Due date cleared on ${countNoun(count, NOUN)}`
          : `Due date set on ${countNoun(count, NOUN)}`,
    )
  }, [pending, scope, value, directory, selectedRows, runCalls, user, hostId, runPlan])

  const handleExport = useCallback(() => {
    downloadTextFile('tasks-selected.csv', 'text/csv', tasksCsv(selectedRows, csv))
  }, [selectedRows, csv])

  const handleDelete = useCallback(async () => {
    if (!scope || !selectedRows.length) return
    const count = selectedRows.length
    const confirmed = await confirm({
      title: count === 1 ? 'Delete this task?' : `Delete ${count} tasks?`,
      description:
        `${count === 1 ? 'It is' : 'They are'} removed for everyone who can ` +
        'see them. A finished task is better ticked done, which keeps it in ' +
        'the Done view.',
      confirmationText: count === 1 ? 'Delete task' : 'Delete tasks',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel.
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const writes: CrmBulkWrite[] = selectedRows.map((task) => ({
      id: task.$id,
      label: labelOf(task),
      kind: 'delete',
    }))
    const outcome = await runPlan(
      { writes, skipped: [] },
      (done) => `Deleted ${countNoun(done, NOUN)}`,
    )
    const refused = new Set(outcome.refused.map((row) => row.label))
    onSelectedChange(
      selectedRows.filter((task) => refused.has(labelOf(task))).map((task) => task.$id),
    )
  }, [scope, selectedRows, confirm, runPlan, onSelectedChange])

  return (
    <CrmBulkBarFrame
      count={selected.length}
      noun={NOUN}
      busy={busy}
      onClear={() => onSelectedChange([])}
      report={report}
      onDismissReport={dismissReport}
      extras={
        <CrmBulkValueDialog
          open={pending !== null}
          title={pending ? ACTION_TITLES[pending] : ''}
          count={selected.length}
          noun={NOUN}
          busy={busy}
          canApply
          onClose={() => setPending(null)}
          onApply={() => void handleApply()}
        >
          {pending === 'assign' ? (
            <TextField
              select
              size="small"
              label="Assignee"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={directory.loading}
              error={Boolean(directory.error)}
              helperText={
                directory.error ??
                (directory.loading
                  ? 'Loading the team…'
                  : 'Somebody other than you is told, as the drawer tells them')
              }
            >
              <MenuItem value="">{'Nobody — clear the assignee'}</MenuItem>
              {directory.members.map((member) => (
                <MenuItem key={member.uid} value={member.uid}>
                  {member.label}
                </MenuItem>
              ))}
            </TextField>
          ) : pending === 'due' ? (
            <TextField
              size="small"
              type="datetime-local"
              label="Due"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              helperText="Leave it empty to clear the due date"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          ) : null}
        </CrmBulkValueDialog>
      }
    >
      <Button size="small" disabled={busy || !scope} onClick={() => void handleComplete()}>
        {'Complete'}
      </Button>
      <Button size="small" disabled={busy || !scope} onClick={() => openAction('assign')}>
        {'Assign'}
      </Button>
      <Button
        size="small"
        disabled={busy || !scope}
        onClick={() => {
          openAction('due')
          // Start from the first task's own date, so a nudge is an edit
          // rather than a retype.
          setValue(dueAtToLocalInput(selectedRows[0]?.dueAtMs))
        }}
      >
        {'Set due'}
      </Button>
      <Button size="small" disabled={busy} onClick={handleExport}>
        {'Export CSV'}
      </Button>
      <Button
        size="small"
        color="error"
        disabled={busy || !scope}
        onClick={() => void handleDelete()}
      >
        {'Delete'}
      </Button>
    </CrmBulkBarFrame>
  )
}
TasksBulkBarBody.displayName = 'TasksBulkBarBody'

export default TasksBulkBar
