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

import type { CrmTask, CrmTaskKind, CrmTaskPriority } from '@aglyn/aglyn'
import {
  mdiAccountGroupOutline,
  mdiAccountOutline,
  mdiCheckboxMarkedCircleOutline,
  mdiDomain,
  mdiEmailOutline,
  mdiHandshakeOutline,
  mdiPhoneOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Chip, Stack, Typography } from '@mui/material'
import type { CrmRoutes } from '../model/crm-routes'
import type { CrmRecordKind } from '../hooks/use-crm-record-names'
import {
  CRM_TASK_KIND_LABELS,
  CRM_TASK_PRIORITY_LABELS,
  describeTaskDue,
  TASK_DUE_COLORS,
  taskRecordLink,
} from '../model/task-views'

/**
 * The cells a task is drawn with, shared by the tasks section, the record
 * cards and the dashboard widget (AGL-2599) so a call reads as a call on
 * every surface and an overdue date is the same red everywhere.
 */

export const TASK_KIND_ICONS: Record<CrmTaskKind, string> = {
  call: mdiPhoneOutline.path,
  email: mdiEmailOutline.path,
  meeting: mdiAccountGroupOutline.path,
  todo: mdiCheckboxMarkedCircleOutline.path,
}

export const RECORD_KIND_ICONS: Record<CrmRecordKind, string> = {
  contact: mdiAccountOutline.path,
  company: mdiDomain.path,
  deal: mdiHandshakeOutline.path,
}

export function TaskKindCell(props: { kind: CrmTaskKind; iconOnly?: boolean }) {
  const { kind, iconOnly } = props
  const label = CRM_TASK_KIND_LABELS[kind] ?? kind
  return (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: 'center', color: 'text.secondary' }}
      title={iconOnly ? label : undefined}
    >
      <MdiIcon path={TASK_KIND_ICONS[kind] ?? TASK_KIND_ICONS.todo} fontSize="small" />
      {iconOnly ? null : <Typography variant="body2">{label}</Typography>}
    </Stack>
  )
}
TaskKindCell.displayName = 'TaskKindCell'

/**
 * Priority as a chip. Only `high` is colored: a column where every row
 * carries a colored chip is a column nobody scans, and "normal" is the
 * absence of a flag rather than a flag of its own.
 */
export function TaskPriorityChip(props: { priority: CrmTaskPriority }) {
  const { priority } = props
  return (
    <Chip
      size="small"
      label={CRM_TASK_PRIORITY_LABELS[priority] ?? priority}
      color={priority === 'high' ? 'error' : 'default'}
      variant={priority === 'normal' ? 'filled' : 'outlined'}
    />
  )
}
TaskPriorityChip.displayName = 'TaskPriorityChip'

/** The due date, painted by where it stands against the reader's clock. */
export function TaskDueText(props: {
  task: Pick<CrmTask, 'status' | 'dueAtMs'>
  nowMs: number
  variant?: 'body2' | 'caption'
}) {
  const { task, nowMs, variant = 'body2' } = props
  const { state, label } = describeTaskDue(task, nowMs)
  return (
    <Typography
      variant={variant}
      sx={{
        color: TASK_DUE_COLORS[state],
        fontWeight: state === 'overdue' || state === 'today' ? 'fontWeightMedium' : undefined,
        textDecoration: state === 'done' ? 'line-through' : undefined,
      }}
      data-due-state={state}
    >
      {label}
    </Typography>
  )
}
TaskDueText.displayName = 'TaskDueText'

/**
 * The record a task is for, as a link into the hub, with its name when the
 * cache has resolved one and its id until then. An unlinked task shows a
 * dash rather than nothing, so an empty cell reads as "none" and not as
 * "still loading".
 */
export function TaskRecordLink(props: {
  task: Pick<CrmTask, 'contactId' | 'companyId' | 'dealId'>
  routes: CrmRoutes
  nameOf: (kind: CrmRecordKind, id: string) => string | undefined
}) {
  const { task, routes, nameOf } = props
  const link = taskRecordLink(task, routes)
  if (!link) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'—'}
      </Typography>
    )
  }
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
      <MdiIcon
        path={RECORD_KIND_ICONS[link.kind]}
        fontSize="small"
        sx={{ color: 'text.secondary' }}
      />
      <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
        <AppLink
          href={link.href}
          onClick={(event: { stopPropagation: () => void }) =>
            event.stopPropagation()
          }
        >
          {nameOf(link.kind, link.id) || link.id}
        </AppLink>
      </Typography>
    </Stack>
  )
}
TaskRecordLink.displayName = 'TaskRecordLink'
