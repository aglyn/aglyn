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

import { CRM_COLLECTIONS, pluginDocsHelp, taskDueState } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Button, Stack, Typography } from '@mui/material'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { useCrmHubPath } from '../hooks/use-crm-hub-path'
import { crmVisibleToClause, useCrmScope } from '../hooks/use-crm-scope'
import { type CrmTaskRow, useNowMs } from '../hooks/use-crm-tasks'
import { crmRoutes } from '../model/crm-routes'
import { orderTaskRows } from '../model/task-views'
import { TaskDueText, TaskKindCell } from './task-cells'

/**
 * How many of the reader's open tasks the widget reads. Enough to count
 * what is overdue and due today for anyone with a working list; a person
 * with more than fifty open tasks has a tasks section to open.
 */
const MY_TASKS_WINDOW = 50
const NEXT_UP = 5

export interface CrmTasksDueCardProps {
  /**
   * The site the card is on the dashboard of, or `null` beneath the org
   * hub's mount (AGL-2636), where the reader's tasks are read across every
   * site of the organization at once.
   */
  hostId: string | null
  /** The org hub's own path, for the link when there is no site to derive it from. */
  basePath?: string
}

/**
 * Dashboard glance at the reader's tasks (AGL-2599): how many are overdue,
 * how many are due today, and the next five, linking into the tasks section.
 *
 * Registered on the shell's `hostDashboard` slot, so it appears only on
 * workspaces with the CRM enabled and for readers who hold `data.manage` —
 * the extension's own gate, which the slot composes for every card.
 *
 * Renders NOTHING when the org has no open tasks at all. A dashboard card
 * saying "no tasks" on a workspace that has never made one is a card about a
 * feature the reader has not adopted, and the dashboard is not the place to
 * sell it. The absence is decided by a one-row probe on the whole org's open
 * tasks rather than by the reader's own list, so a person with nothing
 * assigned on a team that uses tasks still sees the card, saying so.
 *
 * ## The organization level (AGL-2636)
 *
 * Mounted with no site beneath the org hub's mount — the org's sites page
 * hands the card `hostId: null` and the hub's `basePath` — the two reads
 * carry no scope clause, exactly as the tasks section's do at that level:
 * the reader is an org-wide member (the page admits nobody else to the
 * row), the rules admit them to every row, and a clause listing every
 * site's token would need the whole site list and still miss a site the
 * list did not carry. `useCrmScope` spells both levels, so the card is one
 * component: under a site it filters on the site's own group's tokens as
 * it always has, and at the org level it filters on nothing.
 */
export function CrmTasksDueCard(props: CrmTasksDueCardProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid
  const hubPath = useCrmHubPath(basePath)
  const nowMs = useNowMs()
  // The widget is handed a host id (or none) and no org document, so under
  // a site the read scope resolves to the group of one — which a task
  // created on a grouped sibling still matches, since it carries every
  // sibling's token — and at the org level to no clause at all.
  const { scope, visibleTo } = useCrmScope({ hostId })
  const tasks = useMemo(
    () =>
      scope ? collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.tasks) : null,
    [firestore, scope],
  )

  const { data: probe, status: probeStatus } = useFirestoreCollection<CrmTaskRow>(
    () =>
      tasks
        ? query(
            tasks,
            ...crmVisibleToClause(visibleTo),
            where('status', '==', 'open'),
            orderBy('dueAtMs', 'asc'),
            limit(1),
          )
        : null,
    [tasks, visibleTo],
    { idField: '$id' },
  )
  const { data: mineDocs, status: mineStatus } = useFirestoreCollection<CrmTaskRow>(
    () =>
      tasks && uid
        ? query(
            tasks,
            ...crmVisibleToClause(visibleTo),
            where('assigneeUid', '==', uid),
            where('status', '==', 'open'),
            orderBy('dueAtMs', 'asc'),
            limit(MY_TASKS_WINDOW),
          )
        : null,
    [tasks, visibleTo, uid],
    { idField: '$id' },
  )

  const mine = useMemo(() => orderTaskRows(mineDocs ?? []), [mineDocs])
  const counts = useMemo(() => {
    let overdue = 0
    let today = 0
    for (const task of mine) {
      const state = taskDueState(task, nowMs)
      if (state === 'overdue') overdue += 1
      else if (state === 'today') today += 1
    }
    return { overdue, today }
  }, [mine, nowMs])
  const nextUp = useMemo(() => mine.slice(0, NEXT_UP), [mine])

  const tasksHref = crmRoutes(hubPath).section('tasks')

  // Nothing until the probe has answered, and nothing when it answered
  // "no open tasks anywhere": a card that flashes in and out is worse than
  // one that arrives a moment late.
  if (probeStatus !== 'success' || !probe?.length) return null

  return (
    <CardDisplay
      header={'Tasks due'}
      help={pluginDocsHelp('crmTasks', {
        anchor: '#the-dashboard-card',
        excerpt:
          'Your overdue and due-today counts and the next five tasks ' +
          'assigned to you. The Tasks section has every view.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={tasksHref}
            size="small"
            color="primary"
          >
            {'View all'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={3}>
          <Stack>
            <Typography
              variant="h5"
              sx={{ color: counts.overdue ? 'error.main' : 'text.primary' }}
            >
              {mine.length >= MY_TASKS_WINDOW ? `${counts.overdue}+` : counts.overdue}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {'Overdue'}
            </Typography>
          </Stack>
          <Stack>
            <Typography
              variant="h5"
              sx={{ color: counts.today ? 'warning.main' : 'text.primary' }}
            >
              {counts.today}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {'Due today'}
            </Typography>
          </Stack>
        </Stack>
        {mineStatus === 'success' && !nextUp.length ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing is assigned to you.'}
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {nextUp.map((task) => (
              <Stack
                key={task.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', minWidth: 0 }}
              >
                <TaskKindCell kind={task.kind} iconOnly />
                <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
                  {task.title}
                </Typography>
                <TaskDueText task={task} nowMs={nowMs} variant="caption" />
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </CardDisplay>
  )
}
CrmTasksDueCard.displayName = 'CrmTasksDueCard'

export default CrmTasksDueCard
