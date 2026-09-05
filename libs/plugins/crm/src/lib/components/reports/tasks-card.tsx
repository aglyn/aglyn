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

import * as Aglyn from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Section } from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import {
  Alert,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import {
  type CrmReportScope,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { useAggregateRead } from './use-aggregate-read'

/**
 * How many open tasks the by-assignee table is grouped from.
 *
 * The tiles are counts the server takes; the table needs each task's
 * assignee and due state, so it reads the soonest-due thousand and says
 * when there were more.
 */
const OPEN_TASK_CEILING = 1000
/** One `in` query's worth of member documents, for the assignee names. */
const ASSIGNEE_NAME_CEILING = 30

type TaskRow = Aglyn.CrmTask & { $id: string }

interface AssigneeLoad {
  uid: string
  overdue: number
  today: number
  upcoming: number
  undated: number
  open: number
}

export interface TasksCardProps {
  report: CrmReportScope
}

/**
 * The task load: open, overdue and due today, and who is carrying what
 * (AGL-2604).
 *
 * "Today" and "overdue" are decided on the LOCAL calendar day, the same day
 * `taskDueState` decides them on, so the count here and the chip on the
 * tasks list agree about the same task at 11 p.m. The counts are range
 * queries on `dueAtMs`, which the `(visibleTo, status, dueAtMs)` index
 * serves; a task with no due date is in the open count and in none of the
 * dated ones.
 *
 * The table reads open tasks ordered by due date. An ordered read admits
 * only documents that CARRY the field, so a task written without `dueAtMs`
 * at all — rather than with `null`, which sorts first — is counted in the
 * tile and absent from the table. The model types the field as optional,
 * so the table says what it is grouped from.
 */
export function TasksCard(props: TasksCardProps) {
  const { report } = props
  const { scope, tokens, nowMs, routes } = report
  const firestore = useFirestore()
  const day = useMemo(() => Aglyn.localDayBounds(nowMs), [nowMs])

  const openTasks = () =>
    query(
      scopedCollection(firestore, scope, Aglyn.CRM_COLLECTIONS.tasks),
      visibleToClause(tokens),
      where('status', '==', 'open'),
    )

  const counts = useAggregateRead(
    () =>
      Promise.all([
        getCountFromServer(openTasks()),
        getCountFromServer(query(openTasks(), where('dueAtMs', '<', day.start))),
        getCountFromServer(
          query(
            openTasks(),
            where('dueAtMs', '>=', day.start),
            where('dueAtMs', '<', day.end),
          ),
        ),
      ]).then(([open, overdue, today]) => ({
        open: open.data().count,
        overdue: overdue.data().count,
        today: today.data().count,
      })),
    [firestore, scope, tokens, day],
  )

  const { data: taskDocs, status: tasksStatus } = useFirestoreCollection<TaskRow>(
    () =>
      query(
        openTasks(),
        orderBy('dueAtMs', 'asc'),
        limit(OPEN_TASK_CEILING + 1),
      ),
    [firestore, scope, tokens],
    { idField: '$id' },
  )
  const taskWindow = useMemo(
    () => ceilingedWindow(taskDocs ?? undefined, OPEN_TASK_CEILING),
    [taskDocs],
  )

  const load = useMemo(() => {
    const byAssignee = new Map<string, AssigneeLoad>()
    for (const task of taskWindow.rows) {
      const uid = task.assigneeUid || ''
      const row = byAssignee.get(uid) ?? {
        uid,
        overdue: 0,
        today: 0,
        upcoming: 0,
        undated: 0,
        open: 0,
      }
      const state = Aglyn.taskDueState(task, nowMs)
      if (state === 'overdue') row.overdue += 1
      else if (state === 'today') row.today += 1
      else if (state === 'upcoming') row.upcoming += 1
      else row.undated += 1
      row.open += 1
      byAssignee.set(uid, row)
    }
    return [...byAssignee.values()].sort(
      (a, b) => b.open - a.open || a.uid.localeCompare(b.uid),
    )
  }, [taskWindow, nowMs])

  /*
   * The assignees' names, from their member documents — one `in` query for
   * up to thirty, which is Firestore's cap on the operator and more assignees
   * than a tasks list has. Anyone past it, or a member document the reader
   * cannot open, shows as their id rather than blocking the table.
   */
  const uids = load.map((row) => row.uid).filter(Boolean).slice(0, ASSIGNEE_NAME_CEILING)
  const uidKey = uids.join(',')
  const names = useAggregateRead<Record<string, string>>(
    () =>
      uids.length
        ? getDocs(
            query(
              scopedCollection(firestore, scope, 'members'),
              where(documentId(), 'in', uids),
            ),
          ).then((snapshot) =>
            Object.fromEntries(
              snapshot.docs.map((member) => [
                member.id,
                String(member.get('displayName') || member.get('email') || member.id),
              ]),
            ),
          )
        : Promise.resolve({}),
    [firestore, scope, uidKey],
  )

  const figures = counts.value
  return (
    <CardDisplay
      header={'Tasks'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#tasks',
        excerpt:
          'Open tasks, how many are overdue or due today, and the open ' +
          'load per assignee. Today and overdue are decided on your calendar ' +
          'day, the same way the tasks list decides them.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={routes.section('tasks')}
            size="small"
            color="primary"
          >
            {'Open tasks'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <ReportStatTile
            label={'Open tasks'}
            value={figures ? figures.open.toLocaleString() : null}
            note={'counted on the server'}
            href={routes.section('tasks')}
          />
          <ReportStatTile
            label={'Overdue'}
            value={figures ? figures.overdue.toLocaleString() : null}
            note={'due before today'}
            color={figures?.overdue ? 'error.main' : undefined}
            href={routes.section('tasks')}
          />
          <ReportStatTile
            label={'Due today'}
            value={figures ? figures.today.toLocaleString() : null}
            note={'on your calendar day'}
            href={routes.section('tasks')}
          />
        </Stack>
        {counts.status === 'error' ? (
          <Alert severity="warning">{'The task counts could not be read.'}</Alert>
        ) : null}
        <Section title={'Open tasks by assignee'}>
          {load.length ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Assignee'}</TableCell>
                  <TableCell align="right">{'Overdue'}</TableCell>
                  <TableCell align="right">{'Today'}</TableCell>
                  <TableCell align="right">{'Upcoming'}</TableCell>
                  <TableCell align="right">{'No date'}</TableCell>
                  <TableCell align="right">{'Open'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {load.map((row) => (
                  <TableRow key={row.uid || '$unassigned'}>
                    <TableCell>
                      {row.uid ? names.value?.[row.uid] ?? row.uid : 'Unassigned'}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={row.overdue ? { color: 'error.main' } : undefined}
                    >
                      {row.overdue.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">{row.today.toLocaleString()}</TableCell>
                    <TableCell align="right">{row.upcoming.toLocaleString()}</TableCell>
                    <TableCell align="right">{row.undated.toLocaleString()}</TableCell>
                    <TableCell align="right">{row.open.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {tasksStatus === 'loading' ? 'Reading…' : 'No open tasks.'}
            </Typography>
          )}
          {taskWindow.truncated ? (
            <Typography variant="caption" color="text.secondary">
              {`Grouped from the ${OPEN_TASK_CEILING.toLocaleString()} soonest-due open tasks; the tiles are counted on the server.`}
            </Typography>
          ) : null}
        </Section>
      </Stack>
    </CardDisplay>
  )
}
TasksCard.displayName = 'TasksCard'

export default TasksCard
