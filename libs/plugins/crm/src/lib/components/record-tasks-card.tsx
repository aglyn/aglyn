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

import { CRM_COLLECTIONS, pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Button, Checkbox, Stack, Typography } from '@mui/material'
import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmHubPath } from '../hooks/use-crm-hub-path'
import {
  type CrmRecordRef,
  type CrmTaskRow,
  useCrmRecordTasks,
  useNowMs,
} from '../hooks/use-crm-tasks'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import { crmRoutes } from '../model/crm-routes'
import { completeCrmTask } from '../model/task-api'
import { TaskDueText, TaskKindCell, TaskPriorityChip } from './task-cells'
import TaskEditDrawer from './task-edit-drawer'
import TaskSnoozeMenu from './task-snooze-menu'

export interface RecordTasksCardProps extends CrmRecordRef {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  /** The org document the shell passed the page; scopes the read when present. */
  org?: Record<string, unknown> | null
  /**
   * The hub's path, for the link to the full tasks list. A page the hub
   * rendered has one to pass; a card mounted anywhere else leaves it out and
   * the path is rebuilt from the URL.
   */
  basePath?: string
}

/**
 * The open tasks for ONE contact, company or deal, on that record's page
 * (AGL-2599).
 *
 * Exactly one of `contactId`, `companyId`, `dealId` names the record; the
 * first present one wins. A record page drops this in beside its other
 * cards: `<RecordTasksCard hostId={hostId} org={org} contactId={id} />`.
 * Tasks are completed inline and created with the record
 * already linked; everything else about a task is edited by opening it.
 *
 * Open tasks are listed and completed ones are counted, because a record's
 * page is where somebody decides what to do next about the person, and the
 * history of what was done lives in the Done view of the tasks section.
 */
export function RecordTasksCard(props: RecordTasksCardProps) {
  const { hostId, org, basePath, contactId, companyId, dealId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const nowMs = useNowMs()
  const hubPath = useCrmHubPath(basePath)
  const routes = useMemo(() => crmRoutes(hubPath), [hubPath])
  const record = useMemo<CrmRecordRef>(
    () =>
      contactId ? { contactId } : companyId ? { companyId } : { dealId },
    [contactId, companyId, dealId],
  )
  const { tasks, status, fromCache, scope, orgId, readTokens } = useCrmRecordTasks({
    hostId,
    org,
    record,
  })
  const directory = useOrgMemberDirectory(orgId)
  const open = useMemo(() => tasks.filter((task) => task.status !== 'done'), [tasks])
  const doneCount = tasks.length - open.length

  const [drawer, setDrawer] = useState<{ open: boolean; task: CrmTaskRow | null }>({
    open: false,
    task: null,
  })
  const [busyId, setBusyId] = useState<string | null>(null)

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
        } else {
          // The mounted site, or at the organization level the task's own.
          await completeCrmTask(user, { hostId: hostId ?? task.hostId, taskId: task.$id })
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

  return (
    <>
      <CardDisplay
        header={'Tasks'}
        help={pluginDocsHelp('crmTasks', {
          anchor: '#tasks-on-a-contact-company-or-deal',
          excerpt:
            'The open tasks about this record. Tick one to complete it, or ' +
            'add a call, an email, a meeting or a to-do already linked here.',
        })}
        subheader={
          doneCount
            ? `${open.length} open · ${doneCount} done`
            : open.length
              ? `${open.length} open`
              : undefined
        }
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1}>
              <Button
                component={AppLink as any}
                {...({ componentVariant: 'naked', nativeButton: false } as any)}
                href={routes.section('tasks')}
                size="small"
                color="primary"
              >
                {'All tasks'}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() => setDrawer({ open: true, task: null })}
              >
                {'New task'}
              </Button>
            </Stack>
          ),
        }}
      >
        {status === 'error' ? (
          <Typography variant="body2" color="error">
            {'The tasks could not be loaded.'}
          </Typography>
        ) : status === 'success' && !open.length ? (
          <EmptyStateComponent
            compact
            label={doneCount ? 'Everything here is done' : 'No tasks yet'}
            description={
              doneCount
                ? 'The completed ones are kept on the Tasks list.'
                : 'A call, an email, a meeting or a to-do owed to this record.'
            }
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
          <Stack spacing={1}>
            {open.map((task) => (
              <Stack
                key={task.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', minWidth: 0 }}
              >
                <Checkbox
                  size="small"
                  checked={false}
                  disabled={busyId === task.$id}
                  onClick={() => void toggleDone(task)}
                  slotProps={{
                    input: { 'aria-label': `Complete "${task.title}"` },
                  }}
                />
                <Stack
                  sx={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
                  onClick={() => setDrawer({ open: true, task })}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <TaskKindCell kind={task.kind} iconOnly />
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      {task.title}
                    </Typography>
                    {task.priority === 'high' ? (
                      <TaskPriorityChip priority={task.priority} />
                    ) : null}
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TaskDueText task={task} nowMs={nowMs} variant="caption" />
                    {task.assigneeUid ? (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {`· ${directory.nameOf(task.assigneeUid)}`}
                      </Typography>
                    ) : null}
                    {scope ? (
                      <TaskSnoozeMenu
                        dueAtMs={task.dueAtMs}
                        target={{ write: { scope, taskId: task.$id } }}
                        disabled={busyId === task.$id}
                      />
                    ) : null}
                  </Stack>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </CardDisplay>
      <TaskEditDrawer
        open={drawer.open}
        onClose={() => setDrawer((prev) => ({ ...prev, open: false }))}
        hostId={hostId}
        org={org}
        orgId={orgId}
        scope={scope}
        readTokens={readTokens}
        task={drawer.task}
        prefill={record}
        seed={{ fromCache, unreadable: status === 'error' }}
      />
    </>
  )
}
RecordTasksCard.displayName = 'RecordTasksCard'

export default RecordTasksCard
