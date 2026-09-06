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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Section } from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import {
  Alert,
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  getCountFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useOrgMemberOptions } from '../lead-owner-select'
import { ReportExport } from './report-export'
import { reportFilename } from './report-format'
import {
  type CrmReportScope,
  reportCacheKey,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { ReportStatTile } from './report-stat-tile'
import { useAggregateRead, useWindowRead } from './use-aggregate-read'

/**
 * How many activities and how many completed tasks the leaderboard is
 * grouped from.
 *
 * The tiles are server counts and never meet these bounds; the table needs
 * each activity's kind and author and each task's completer, so it reads
 * the period's newest thousand of each and says when there were more —
 * the contacts list's bound, and the one every window on this page shares.
 */
const ACTIVITY_CEILING = 1000
const TASK_DONE_CEILING = 1000

type ActivityRow = Aglyn.CrmActivityRow
type TaskRow = Aglyn.CrmTask & { $id: string }

/** The table's columns, which are also the CSV's. */
const COLUMNS = [
  'Teammate',
  ...Aglyn.CRM_ACTIVITY_KINDS.map((kind) => Aglyn.CRM_ACTIVITY_KIND_LABELS[kind]),
  'Activities',
  'Tasks done',
] as const

export interface ActivityCardProps {
  report: CrmReportScope
}

/**
 * Activity by teammate (AGL-2624): the calls, emails, meetings and notes
 * each member logged in the period, and the tasks they ticked off,
 * busiest first.
 *
 * ## Two windows, two indexes, one table
 *
 * Activities are read newest-first within the period through the
 * `(visibleTo, atMs)` index the activity feed already uses — a range on
 * `atMs` ordered by `atMs` is that index's own shape, so this read adds
 * none. Completed tasks are read the same way on `completedAtMs`, under
 * `status == 'done'`, which is the one index this card adds
 * (`visibleTo, status, completedAtMs`). The two reads are independent so
 * that a missing task index degrades ONE column to a dash and a notice
 * rather than the whole card: the activities were read, and the
 * leaderboard draws them.
 *
 * A task ordered by `completedAtMs` is a task the complete route stamped;
 * a task marked done some other way, without the stamp, is not in the
 * window and the caption says what the column is grouped from.
 *
 * ## Names
 *
 * Every activity carries the name it was signed with, for the reason
 * `CrmActivity.byName` gives — a scoped reader cannot resolve a colleague's
 * uid. The roster is read too, through the members route any member may
 * ask, and wins when it knows the uid, so a renamed teammate reads by
 * their current name; the signed name covers a uid the roster no longer
 * has, and the uid itself covers the rest.
 */
export function ActivityCard(props: ActivityCardProps) {
  const { report } = props
  const { scope, tokens, range, period, routes } = report
  const firestore = useFirestore()
  const roster = useOrgMemberOptions(scope[1])

  const activitiesBetween = (from: number, to: number) =>
    query(
      scopedCollection(firestore, scope, Aglyn.CRM_COLLECTIONS.activities),
      ...visibleToClause(tokens),
      where('atMs', '>=', from),
      where('atMs', '<', to),
    )
  const tasksDoneBetween = (from: number, to: number) =>
    query(
      scopedCollection(firestore, scope, Aglyn.CRM_COLLECTIONS.tasks),
      ...visibleToClause(tokens),
      where('status', '==', 'done'),
      where('completedAtMs', '>=', from),
      where('completedAtMs', '<', to),
    )
  const countOf = (target: ReturnType<typeof query>) =>
    getCountFromServer(target).then((snapshot) => snapshot.data().count)

  const activityCounts = useAggregateRead(
    () =>
      Promise.all([
        countOf(activitiesBetween(range.from, range.to)),
        countOf(activitiesBetween(range.previousFrom, range.previousTo)),
      ]).then(([current, previous]) => ({ current, previous })),
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'activity:counts') },
  )
  const taskCounts = useAggregateRead(
    () =>
      Promise.all([
        countOf(tasksDoneBetween(range.from, range.to)),
        countOf(tasksDoneBetween(range.previousFrom, range.previousTo)),
      ]).then(([current, previous]) => ({ current, previous })),
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'activity:tasks-counts') },
  )

  const activityWindow = useWindowRead<ActivityRow>(
    () =>
      query(
        activitiesBetween(range.from, range.to),
        orderBy('atMs', 'desc'),
        limit(ACTIVITY_CEILING + 1),
      ),
    ACTIVITY_CEILING,
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'activity:window') },
  )
  const taskWindow = useWindowRead<TaskRow>(
    () =>
      query(
        tasksDoneBetween(range.from, range.to),
        orderBy('completedAtMs', 'desc'),
        limit(TASK_DONE_CEILING + 1),
      ),
    TASK_DONE_CEILING,
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'activity:tasks-window') },
  )

  const rows = useMemo(
    () => Aglyn.activityLeaderboard(activityWindow.rows, taskWindow.rows),
    [activityWindow, taskWindow],
  )
  const nameOf = (row: Aglyn.ActivityLeaderboardRow): string => {
    if (!row.uid) return 'No teammate'
    return Aglyn.findOrgMember(roster.options, row.uid)?.label ?? row.name ?? row.uid
  }
  const teammates = rows.filter((row) => row.uid).length

  const activitiesRead = activityWindow.status === 'success'
  const tasksRead = taskWindow.status === 'success'
  const settled = activityWindow.status !== 'loading' && taskWindow.status !== 'loading'
  const caption = [
    activityWindow.truncated
      ? `Grouped from the ${ACTIVITY_CEILING.toLocaleString()} most recent activities in the period`
      : null,
    taskWindow.truncated
      ? `the ${TASK_DONE_CEILING.toLocaleString()} most recently completed tasks`
      : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const activityFigures = activityCounts.value
  const taskFigures = taskCounts.value

  return (
    <Box sx={{ gridColumn: { lg: '1 / -1' } }}>
      <CardDisplay
        header={'Activity by teammate'}
        help={Aglyn.pluginDocsHelp('crmReports', {
          anchor: '#activity-by-teammate',
          excerpt:
            'The calls, emails, meetings and notes each teammate logged in ' +
            'the period, and the tasks they completed, busiest first. ' +
            'Grouped from the period’s newest thousand of each.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
            <ReportStatTile
              label={'Activities logged'}
              value={activityFigures ? activityFigures.current.toLocaleString() : null}
              deltaPct={
                activityFigures
                  ? Aglyn.deltaPercent(activityFigures.current, activityFigures.previous)
                  : null
              }
              note={'counted on the server'}
              href={routes.section('contacts')}
            />
            <ReportStatTile
              label={'Tasks completed'}
              value={taskFigures ? taskFigures.current.toLocaleString() : null}
              deltaPct={
                taskFigures
                  ? Aglyn.deltaPercent(taskFigures.current, taskFigures.previous)
                  : null
              }
              note={'ticked off in the period'}
              href={routes.section('tasks')}
            />
            <ReportStatTile
              label={'Teammates active'}
              value={settled ? teammates.toLocaleString() : null}
              note={'logged or completed something'}
            />
          </Stack>
          {activityCounts.status === 'error' || activityWindow.status === 'error' ? (
            <Alert severity="warning">{'The activities could not be read.'}</Alert>
          ) : null}
          {taskCounts.status === 'error' || taskWindow.status === 'error' ? (
            <Alert severity="warning">
              {'The completed-task counts could not be read; the Tasks done column is left blank.'}
            </Alert>
          ) : null}
          <Section title={'Who did what'}>
            {rows.length ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {COLUMNS.map((column, index) => (
                      <TableCell key={column} align={index ? 'right' : 'left'}>
                        {column}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.uid || '$nobody'}>
                      <TableCell>{nameOf(row)}</TableCell>
                      {Aglyn.CRM_ACTIVITY_KINDS.map((kind) => (
                        <TableCell key={kind} align="right">
                          {row.kinds[kind].toLocaleString()}
                        </TableCell>
                      ))}
                      <TableCell align="right">{row.activities.toLocaleString()}</TableCell>
                      <TableCell align="right">
                        {tasksRead ? row.tasksDone.toLocaleString() : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {settled ? 'Nothing logged or completed in this period.' : 'Reading…'}
              </Typography>
            )}
            {rows.some((row) => !row.uid) ? (
              <Typography variant="caption" color="text.secondary">
                {'No teammate — activities an automation logged, and tasks completed with nobody assigned.'}
              </Typography>
            ) : null}
            <ReportExport
              filename={reportFilename('activity', period)}
              columns={COLUMNS}
              rows={() =>
                rows.map((row) => [
                  nameOf(row),
                  ...Aglyn.CRM_ACTIVITY_KINDS.map((kind) => row.kinds[kind]),
                  row.activities,
                  tasksRead ? row.tasksDone : '',
                ])
              }
              disabled={!activitiesRead || !rows.length}
              caption={caption ? `${caption}; the tiles are counted on the server.` : undefined}
            />
          </Section>
        </Stack>
      </CardDisplay>
    </Box>
  )
}
ActivityCard.displayName = 'ActivityCard'

export default ActivityCard
