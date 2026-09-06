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
  consentGroupForHost,
  type ConsolePluginPageProps,
  CRM_COLLECTIONS,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useCrmSavedView } from '../hooks/use-crm-saved-view'
import { useCrmViewGrid } from '../hooks/use-crm-view-grid'
import CrmViewsControl from './crm-views-control'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Checkbox,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmRecordNames } from '../hooks/use-crm-record-names'
import { type CrmTaskRow, useCrmTaskList, useNowMs } from '../hooks/use-crm-tasks'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import { crmRoutes } from '../model/crm-routes'
import { completeCrmTask } from '../model/task-api'
import {
  CRM_TASK_VIEW_LIMIT,
  CRM_TASK_VIEWS,
  type CrmTaskView,
  taskRecordLink,
} from '../model/task-views'
import {
  TaskDueText,
  TaskKindCell,
  TaskPriorityChip,
  TaskRecordLink,
} from './task-cells'
import TaskEditDrawer from './task-edit-drawer'

/** What an empty view is headed, by view — "nothing overdue" is good news. */
const EMPTY_LABEL: Record<CrmTaskView, string> = {
  mine: 'Nothing is assigned to you',
  overdue: 'Nothing is overdue',
  today: 'Nothing is due today',
  upcoming: 'Nothing is scheduled beyond today',
  open: 'No open tasks',
  done: 'No completed tasks yet',
}

/** The one sentence under it, by view. */
const EMPTY_COPY: Record<CrmTaskView, string> = {
  mine: 'Tasks you create are yours unless you hand them to someone.',
  overdue: 'Every dated task is on or ahead of schedule.',
  today: 'Nothing on your calendar day is owed to anyone in the CRM.',
  upcoming: 'A task with a due date past today would be listed here.',
  open: 'A task is a call, an email, a meeting or a to-do owed to a contact, a company or a deal.',
  done: 'Tasks ticked off on their record, or here, are kept for the history.',
}

/**
 * `/crm/tasks` — what the team owes the people in the CRM (AGL-2599).
 *
 * Six views over `orgs/{orgId}/crmTasks`, each a bounded listener on one of
 * the collection's indexes, chosen by a segmented control. A task hangs off
 * a contact, a company or a deal, but it is listed HERE because "what is due
 * today" is a question about the team's day and not about any one record;
 * the record pages carry their own `RecordTasksCard` for the other
 * direction.
 *
 * Completing goes through `crm/task-complete`, because completing fires the
 * `taskCompleted` host event and only the server can run a workflow.
 * Reopening is client-direct: undoing a tick has no side effect beyond the
 * document, and the rules gate it like any other CRM write.
 */
export function TasksSection(props: ConsolePluginPageProps) {
  const { hostId, org, basePath = '' } = props
  const orgRecord = org as Record<string, unknown> | undefined
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const nowMs = useNowMs()
  const routes = useMemo(() => crmRoutes(basePath), [basePath])
  const groupId = useMemo(
    () => consentGroupForHost(orgRecord ?? null, hostId).groupId,
    [orgRecord, hostId],
  )

  /*
   * Which of the six task views is open is the saved VIEW'S (AGL-2617): a
   * saved view of tasks holds the task view beside the columns and the
   * sort, and the toggle below writes into it. Unset reads as "My tasks",
   * which is what the section opened on before views existed.
   */
  const views = useCrmSavedView({ section: 'tasks', hostId, org: orgRecord, basePath })
  const view: CrmTaskView = useMemo(() => {
    const value = views.state.filters.find((clause) => clause.field === 'view')?.value
    return CRM_TASK_VIEWS.some((option) => option.id === value)
      ? (value as CrmTaskView)
      : 'mine'
  }, [views.state.filters])
  const setView = useCallback(
    (next: CrmTaskView) =>
      views.setFilters([{ field: 'view', op: 'equals', value: next }]),
    [views.setFilters],
  )
  const list = useCrmTaskList({
    hostId,
    org: orgRecord,
    view,
    uid: user?.uid,
    nowMs,
  })
  const { tasks, status, fromCache, truncated, scope, orgId, readTokens } = list
  const directory = useOrgMemberDirectory(orgId)

  const linked = useMemo(
    () =>
      tasks.flatMap((task) => {
        const link = taskRecordLink(task, routes)
        return link ? [{ kind: link.kind, id: link.id }] : []
      }),
    [tasks, routes],
  )
  const nameOf = useCrmRecordNames({ orgId, groupId, records: linked })

  const [drawer, setDrawer] = useState<{ open: boolean; task: CrmTaskRow | null }>({
    open: false,
    task: null,
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  /*
   * Tick or untick. The two directions are two different writes on purpose
   * — see the module comment — and the row is disabled while either is in
   * flight so a double-click cannot complete a task and reopen it in the
   * same breath.
   */
  const toggleDone = useCallback(
    async (task: CrmTaskRow) => {
      if (!scope || busyId) return
      setBusyId(task.$id)
      try {
        if (task.status === 'done') {
          await updateDoc(
            doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.tasks, task.$id),
            {
              status: 'open',
              completedAtMs: null,
              completedByUid: deleteField(),
              updatedAt: serverTimestamp(),
            },
          )
          enqueueSnackbar('Task reopened', { variant: 'success' })
        } else {
          await completeCrmTask(user, { hostId, taskId: task.$id })
          enqueueSnackbar('Task completed', { variant: 'success' })
        }
      } catch (cause) {
        enqueueSnackbar(
          cause instanceof Error ? cause.message : 'The task could not be updated.',
          { variant: 'warning' },
        )
      } finally {
        setBusyId(null)
      }
    },
    [scope, busyId, firestore, user, hostId, enqueueSnackbar],
  )

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'status',
        headerName: '',
        width: 56,
        sortable: false,
        filterable: false,
        renderCell: ({ row }: { row: CrmTaskRow }) => (
          <Checkbox
            size="small"
            checked={row.status === 'done'}
            disabled={busyId === row.$id}
            onClick={(event) => {
              event.stopPropagation()
              void toggleDone(row)
            }}
            slotProps={{
              input: {
                'aria-label':
                  row.status === 'done'
                    ? `Reopen "${row.title}"`
                    : `Complete "${row.title}"`,
              },
            }}
          />
        ),
      },
      {
        field: 'title',
        headerName: 'Task',
        flex: 2,
        minWidth: 220,
        sortable: false,
        renderCell: ({ row }: { row: CrmTaskRow }) => (
          <Stack sx={{ justifyContent: 'center', height: '100%', minWidth: 0 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{
                textDecoration: row.status === 'done' ? 'line-through' : undefined,
                color: row.status === 'done' ? 'text.secondary' : undefined,
              }}
            >
              {row.title}
            </Typography>
            {row.notes ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {row.notes}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'kind',
        headerName: 'Kind',
        width: 120,
        sortable: false,
        renderCell: ({ row }: { row: CrmTaskRow }) => <TaskKindCell kind={row.kind} />,
      },
      {
        field: 'priority',
        headerName: 'Priority',
        width: 110,
        sortable: false,
        renderCell: ({ row }: { row: CrmTaskRow }) => (
          <TaskPriorityChip priority={row.priority} />
        ),
      },
      {
        field: 'dueAtMs',
        headerName: 'Due',
        width: 220,
        sortable: false,
        renderCell: ({ row }: { row: CrmTaskRow }) => (
          <TaskDueText task={row} nowMs={nowMs} />
        ),
      },
      {
        field: 'assigneeUid',
        headerName: 'Assignee',
        flex: 1,
        minWidth: 140,
        sortable: false,
        valueGetter: (_value: unknown, row: CrmTaskRow) =>
          directory.nameOf(row.assigneeUid),
        renderCell: ({ row }: { row: CrmTaskRow }) => (
          <Typography variant="body2" color={row.assigneeUid ? undefined : 'text.secondary'}>
            {row.assigneeUid ? directory.nameOf(row.assigneeUid) : 'Unassigned'}
          </Typography>
        ),
      },
      {
        field: 'record',
        headerName: 'For',
        flex: 1,
        minWidth: 160,
        sortable: false,
        renderCell: ({ row }: { row: CrmTaskRow }) => (
          <TaskRecordLink task={row} routes={routes} nameOf={nameOf} />
        ),
      },
    ],
    [busyId, toggleDone, nowMs, directory, routes, nameOf],
  )
  /* The column and sort models are the view's (AGL-2617). */
  const grid = useCrmViewGrid(views, columns)

  return (
    <>
      <CardDisplay
        header={'Tasks'}
        help={pluginDocsHelp('crmTasks', {
          anchor: '#the-tasks-page',
          excerpt:
            'Calls, emails, meetings and to-dos, each linked to the contact, ' +
            'company or deal it is for. Overdue and today are read off the ' +
            'due date as you look.',
        })}
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: (
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={() => setDrawer({ open: true, task: null })}
            >
              {'New task'}
            </Button>
          ),
        }}
      >
        <Stack spacing={2}>
          {/* The saved view this list is showing, beside the task view it narrows to (AGL-2617). */}
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <CrmViewsControl controller={views} allLabel="All tasks" />
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={view}
              onChange={(_event, next) => {
                if (next) setView(next as CrmTaskView)
              }}
              aria-label="Task view"
            >
              {CRM_TASK_VIEWS.map((option) => (
                <ToggleButton key={option.id} value={option.id}>
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
          {status === 'error' ? (
            <Typography variant="body2" color="error">
              {'The tasks could not be loaded. Reload to try again.'}
            </Typography>
          ) : status === 'success' && !tasks.length ? (
            <EmptyStateComponent
              label={EMPTY_LABEL[view]}
              description={EMPTY_COPY[view]}
              action={
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  onClick={() => setDrawer({ open: true, task: null })}
                >
                  {'New task'}
                </Button>
              }
            />
          ) : (
            <>
              {truncated ? (
                <Typography variant="caption" color="text.secondary">
                  {`Showing the first ${CRM_TASK_VIEW_LIMIT} — narrow the view to see the rest.`}
                </Typography>
              ) : null}
              <ListTable
                rows={tasks}
                columns={columns}
                loading={status === 'loading'}
                onOpen={(id) => {
                  const found = tasks.find((row) => row.$id === id)
                  if (found) setDrawer({ open: true, task: found })
                }}
                disableColumnFilter
                // Columns and sort are the view's, controlled (AGL-2617).
                columnVisibilityModel={grid.columnVisibilityModel}
                onColumnVisibilityModelChange={grid.onColumnVisibilityModelChange}
                sortModel={grid.sortModel}
                onSortModelChange={grid.onSortModelChange}
              />
            </>
          )}
        </Stack>
      </CardDisplay>
      <TaskEditDrawer
        open={drawer.open}
        onClose={() => setDrawer((prev) => ({ ...prev, open: false }))}
        hostId={hostId}
        org={orgRecord}
        orgId={orgId}
        scope={scope}
        readTokens={readTokens}
        task={drawer.task}
        seed={{ fromCache, unreadable: status === 'error' }}
      />
    </>
  )
}
TasksSection.displayName = 'TasksSection'

export default TasksSection
