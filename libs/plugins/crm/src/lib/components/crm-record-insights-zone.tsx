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
  type ConsoleWidgetSlotRenderer,
  useConsoleWidgetSlot,
} from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ConsoleRecordInsightsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import type { ConsoleProposedTask } from '@aglyn/aglyn/plugin-manager/record-zone-props'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback, useMemo, useState } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import type { DealStageApi, DealStageRef } from '../hooks/use-deal-stage-api'
import { openStages, type PipelineDoc } from '../model/deal-board-model'
import type { CrmTaskFields } from '../model/task-routes'
import TaskEditDrawer from './task-edit-drawer'

/** The record links a task proposed on a record's page is filed under. */
export type CrmRecordTaskLink = Pick<Partial<CrmTaskFields>, 'contactId' | 'companyId' | 'dealId'>

export interface CrmRecordInsightsZoneProps {
  /** The site the page is under, or `null` at the organization level; a lead's own site on a lead's page. */
  hostId: string | null
  org?: Record<string, unknown> | null
  kind: 'contact' | 'company' | 'deal' | 'lead'
  recordId: string
  /** The record's name as the page shows it. */
  name: string
  /**
   * The links a proposed next step is filed under. Absent for a lead, which a
   * task cannot name, so the zone offers no task there.
   */
  taskLink?: CrmRecordTaskLink
  /** A deal's stage controls: its pipeline, the deal as the stage route names it, and the route. */
  deal?: { pipeline: PipelineDoc | null; ref: DealStageRef; stageId: string; status: string; api: DealStageApi }
}

/** The due time a proposed task opens the form with: the end of the working day, `days` from today. */
export function crmProposedDueAtMs(dueInDays: number, nowMs: number = Date.now()): number {
  const due = new Date(nowMs)
  due.setDate(due.getDate() + Math.max(0, Math.round(dueInDays)))
  due.setHours(17, 0, 0, 0)
  return due.getTime()
}

/** A proposed next step as the task form's fields, linked to the record. */
export function crmProposedTaskFields(
  task: ConsoleProposedTask,
  link: CrmRecordTaskLink,
  nowMs: number = Date.now(),
): Partial<CrmTaskFields> {
  return {
    ...link,
    title: task.title,
    notes: task.notes,
    kind: task.kind,
    priority: task.priority,
    dueAtMs: crmProposedDueAtMs(task.dueInDays, nowMs),
  }
}

/**
 * The `recordInsights` zone on a CRM record's page (AGL-2917), hosted through
 * the renderer the console shell hands down, as the product editor hosts
 * `seoFields`: outside the shell it renders nothing, and inside it every gate
 * a console page's slot applies applies here.
 *
 * A widget proposes; this page writes. A proposed task opens the CRM's own
 * task form with the proposal filled in, and the form's Save is the write,
 * through `crm/task-save`. A proposed stage is confirmed first and then moved
 * through `crm/deal-stage`, the one writer of a deal's stage, so the move
 * emits the event every automation listens for. Only an open stage is
 * accepted: winning or losing a deal is a decision the stage card takes.
 */
export function CrmRecordInsightsZone(props: CrmRecordInsightsZoneProps) {
  const Slot = useConsoleWidgetSlot()
  // Outside the console shell there is no workspace to gate on, and nothing
  // below is read.
  return Slot ? <HostedRecordInsightsZone {...props} Slot={Slot} /> : null
}
CrmRecordInsightsZone.displayName = 'CrmRecordInsightsZone'

function HostedRecordInsightsZone(props: CrmRecordInsightsZoneProps & { Slot: ConsoleWidgetSlotRenderer }) {
  const { hostId, org, kind, recordId, name, deal, Slot } = props
  // By the ids it names, so a page that passes a fresh object each render
  // hands the widget the same callback.
  const contactId = props.taskLink?.contactId
  const companyId = props.taskLink?.companyId
  const dealId = props.taskLink?.dealId
  const linked = Boolean(props.taskLink)
  const taskLink = useMemo<CrmRecordTaskLink | undefined>(
    () =>
      linked
        ? { ...(contactId ? { contactId } : {}), ...(companyId ? { companyId } : {}), ...(dealId ? { dealId } : {}) }
        : undefined,
    [linked, contactId, companyId, dealId],
  )
  const { scope, orgId, visibleTo } = useCrmScope({ hostId, org })
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  const [proposed, setProposed] = useState<{ key: string; fields: Partial<CrmTaskFields> } | null>(null)

  const proposeTask = useCallback(
    (task: ConsoleProposedTask, key: string) => {
      if (!taskLink) return
      setProposed({ key, fields: crmProposedTaskFields(task, taskLink) })
    },
    [taskLink],
  )

  const stages = useMemo(
    () => (deal ? openStages(deal.pipeline).map((stage) => ({ id: stage.id, name: stage.name })) : undefined),
    [deal],
  )

  const proposeStage = useCallback(
    async (stageId: string) => {
      if (!deal || deal.status !== 'open') return
      const stage = stages?.find((entry) => entry.id === stageId)
      if (!stage || stage.id === deal.stageId) return
      const agreed = await confirm({
        title: `Move this deal to ${stage.name}?`,
        description: 'The deal moves as it would from its stage card, and any automation that listens for a stage change runs.',
        confirmationText: `Move to ${stage.name}`,
      })
        .then(() => true)
        .catch(() => false)
      if (!agreed) return
      try {
        await deal.api.moveToStage(deal.ref, stage.id)
        enqueueSnackbar(`Moved to ${stage.name}`, { variant: 'success', persist: false })
      } catch (error) {
        enqueueSnackbar(error instanceof Error ? error.message : 'The deal could not be moved.', { variant: 'warning' })
      }
    },
    [deal, stages, confirm, enqueueSnackbar],
  )

  const zone: ConsoleRecordInsightsZoneProps = {
    hostId,
    orgId: orgId ?? undefined,
    record: { kind, id: recordId, name },
    ...(taskLink ? { proposeTask } : {}),
    ...(deal && stages ? { stages, stageId: deal.stageId, proposeStage: (stageId: string) => void proposeStage(stageId) } : {}),
  }
  return (
    <>
      <Slot slot="recordInsights" {...zone} />
      {taskLink ? (
        <TaskEditDrawer
          key={proposed?.key ?? 'none'}
          open={Boolean(proposed)}
          onClose={() => setProposed(null)}
          hostId={hostId}
          org={org}
          orgId={orgId}
          scope={scope}
          readTokens={visibleTo}
          prefill={proposed?.fields}
          onSaved={() => setProposed(null)}
        />
      ) : null}
    </>
  )
}

export default CrmRecordInsightsZone
