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
 * The bar over the deals table, for whatever rows are ticked (AGL-2621).
 *
 * Move them to a stage, mark them lost, hand them to an owner, take them
 * into a spreadsheet, or delete them. The owner and the delete are
 * document writes and go through the shared runner in batches; the stage
 * and the loss go through `crm/deal-stage`, ONE REQUEST PER DEAL, because
 * a stage change is what an automation listens for and only the route
 * emits the event — a batch that wrote `stageId` would move forty deals
 * and tell no workflow. Each refusal carries the route's own sentence,
 * named by the deal.
 *
 * ## Set stage needs one pipeline
 *
 * A stage belongs to a pipeline, and a selection that spans two has no
 * one list of stages to offer. The dialog says so rather than offering the
 * first pipeline's stages to a deal in the second, which the route would
 * refuse one row at a time.
 */

import { CRM_COLLECTIONS, dealStageById } from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useFirestore, useHostActivityLogger } from '@aglyn/tenant-feature-instance'
import { Button, MenuItem, TextField, Typography } from '@mui/material'
import { deleteField, doc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmBulkApply } from '../hooks/use-crm-bulk-apply'
import type { DealStageApi } from '../hooks/use-deal-stage-api'
import type { OrgMemberDirectory } from '../hooks/use-org-member-directory'
import { downloadTextFile } from '../model/contacts-csv'
import {
  type CrmBulkPlan,
  type CrmBulkWrite,
  crmBulkWriters,
  runCrmBulkCalls,
  runCrmBulkWrites,
} from '../model/crm-bulk-writes'
import {
  type DealDoc,
  type PipelineDoc,
  closingStage,
  openStages,
} from '../model/deal-board-model'
import { type DealCsvOptions, dealsCsv } from '../model/deals-csv'
import {
  type CrmBulkNoun,
  CrmBulkBarFrame,
  CrmBulkValueDialog,
  countNoun,
} from './crm-bulk-bar-frame'
import { LostReasonDialog } from './lost-reason-dialog'

export interface DealsBulkBarProps {
  hostId: string
  /** `['orgs', orgId]`, or `null` while the org is unresolved. */
  scope: readonly ['orgs', string] | null
  rows: readonly DealDoc[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
  /** The pipeline a deal's `pipelineId` names, for the stage list. */
  pipelineById: (id: string | undefined) => PipelineDoc | null
  /** The section's roster — already read for the Owner column. */
  roster: OrgMemberDirectory
  /** The one door a stage change goes through. */
  api: DealStageApi
  /** How the export names the pipeline, the stage and the owner — the table's own. */
  csv?: DealCsvOptions
}

const NOUN: CrmBulkNoun = { singular: 'deal', plural: 'deals' }

type PendingAction = 'stage' | 'owner'

const ACTION_TITLES: Record<PendingAction, string> = {
  stage: 'Set the stage',
  owner: 'Set the owner',
}

/** The label a report lists a deal under. */
const labelOf = (deal: DealDoc): string => deal.title || 'Untitled deal'

export function DealsBulkBar(props: DealsBulkBarProps) {
  if (!props.selected.length) return null
  return <DealsBulkBarBody {...props} />
}
DealsBulkBar.displayName = 'DealsBulkBar'

function DealsBulkBarBody(props: DealsBulkBarProps) {
  const { hostId, scope, rows, selected, onSelectedChange, pipelineById, roster, api, csv } =
    props
  const firestore = useFirestore()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const { busy, report, apply, dismissReport } = useCrmBulkApply()

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected)
    return rows.filter((row) => chosen.has(row.$id))
  }, [rows, selected])

  /*
   * The one pipeline the selection is in, or `null` when it spans more
   * than one — in which case Set stage has no list to offer.
   */
  const pipeline = useMemo(() => {
    const ids = new Set(selectedRows.map((deal) => String(deal.pipelineId ?? '')))
    return ids.size === 1 ? pipelineById([...ids][0]) : null
  }, [selectedRows, pipelineById])
  const stages = useMemo(() => {
    if (!pipeline) return []
    const won = closingStage(pipeline, 'won')
    return [...openStages(pipeline), ...(won ? [won] : [])]
  }, [pipeline])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [value, setValue] = useState('')
  const [losing, setLosing] = useState(false)

  const writers = useMemo(
    () =>
      crmBulkWriters(firestore, (id) =>
        doc(firestore, scope?.[0] ?? 'orgs', scope?.[1] ?? '', CRM_COLLECTIONS.deals, id),
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

  /** One route request per deal, in order, named by title. */
  const runCalls = useCallback(
    (call: (deal: DealDoc) => Promise<unknown>, done: (count: number) => string) =>
      apply({
        attempted: selectedRows.length,
        skipped: [],
        job: () => runCrmBulkCalls(selectedRows, labelOf, call),
        done,
      }),
    [apply, selectedRows],
  )

  const handleApply = useCallback(async () => {
    if (!pending || !scope) return
    const action = pending
    setPending(null)
    if (action === 'stage') {
      const stage = dealStageById(pipeline, value)
      if (!stage) return
      await runCalls(
        (deal) => api.moveToStage(deal.$id, stage.id),
        (count) => `Moved ${countNoun(count, NOUN)} to ${stage.name}`,
      )
      return
    }
    const nowMs = Date.now()
    const writes: CrmBulkWrite[] = selectedRows.map((deal) => ({
      id: deal.$id,
      label: labelOf(deal),
      kind: 'update',
      data: {
        ownerUid: value ? value : deleteField(),
        updatedAt: new Date(nowMs),
      },
    }))
    await runPlan({ writes, skipped: [] }, (count) => `Owner set on ${countNoun(count, NOUN)}`)
  }, [pending, scope, value, pipeline, selectedRows, api, runCalls, runPlan])

  const handleLost = useCallback(
    async (reason: string) => {
      setLosing(false)
      await runCalls(
        (deal) => api.markLost(deal.$id, reason),
        (count) => `Marked ${countNoun(count, NOUN)} lost`,
      )
    },
    [api, runCalls],
  )

  const handleExport = useCallback(() => {
    downloadTextFile('deals-selected.csv', 'text/csv', dealsCsv(selectedRows, csv))
  }, [selectedRows, csv])

  const handleDelete = useCallback(async () => {
    if (!scope || !selectedRows.length) return
    const count = selectedRows.length
    const confirmed = await confirm({
      title: count === 1 ? 'Delete this deal?' : `Delete ${count} deals?`,
      description:
        `${count === 1 ? 'It is' : 'They are'} removed from the pipeline along ` +
        'with their notes. The contacts and the companies they name are not ' +
        'touched.',
      confirmationText: count === 1 ? 'Delete deal' : 'Delete deals',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel.
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const writes: CrmBulkWrite[] = selectedRows.map((deal) => ({
      id: deal.$id,
      label: labelOf(deal),
      kind: 'delete',
    }))
    const outcome = await runPlan(
      { writes, skipped: [] },
      (done) => `Deleted ${countNoun(done, NOUN)}`,
    )
    // One line per deal that went, as its own page would write.
    const refused = new Set(outcome.refused.map((row) => row.label))
    for (const deal of selectedRows) {
      if (!refused.has(labelOf(deal))) {
        logActivity('Deleted deal', { type: 'deal', id: deal.$id, name: deal.title })
      }
    }
    onSelectedChange(
      selectedRows.filter((deal) => refused.has(labelOf(deal))).map((deal) => deal.$id),
    )
  }, [scope, selectedRows, confirm, runPlan, logActivity, onSelectedChange])

  return (
    <CrmBulkBarFrame
      count={selected.length}
      noun={NOUN}
      busy={busy}
      onClear={() => onSelectedChange([])}
      report={report}
      onDismissReport={dismissReport}
      extras={
        <>
          <CrmBulkValueDialog
            open={pending !== null}
            title={pending ? ACTION_TITLES[pending] : ''}
            count={selected.length}
            noun={NOUN}
            busy={busy}
            canApply={pending === 'owner' || Boolean(value)}
            onClose={() => setPending(null)}
            onApply={() => void handleApply()}
          >
            {pending === 'stage' ? (
              pipeline ? (
                <TextField
                  select
                  size="small"
                  label="Stage"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  helperText={`${pipeline.name} — each move fires its event, as a drag does`}
                >
                  {stages.map((stage) => (
                    <MenuItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {'The selected deals are in different pipelines, so there is ' +
                    'no one list of stages to move them to. Select deals from ' +
                    'one pipeline.'}
                </Typography>
              )
            ) : pending === 'owner' ? (
              <TextField
                select
                size="small"
                label="Owner"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={roster.loading}
                error={Boolean(roster.error)}
                helperText={roster.error ?? (roster.loading ? 'Loading the team…' : undefined)}
              >
                <MenuItem value="">{'Nobody — clear the owner'}</MenuItem>
                {roster.members.map((member) => (
                  <MenuItem key={member.uid} value={member.uid}>
                    {member.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </CrmBulkValueDialog>
          <LostReasonDialog
            open={losing}
            dealTitle={selectedRows[0]?.title ?? ''}
            count={selectedRows.length}
            busy={busy}
            onClose={() => setLosing(false)}
            onConfirm={(reason) => void handleLost(reason)}
          />
        </>
      }
    >
      <Button size="small" disabled={busy || !scope} onClick={() => openAction('stage')}>
        {'Set stage'}
      </Button>
      <Button size="small" disabled={busy || !scope} onClick={() => openAction('owner')}>
        {'Set owner'}
      </Button>
      <Button size="small" disabled={busy || !scope} onClick={() => setLosing(true)}>
        {'Mark lost'}
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
DealsBulkBarBody.displayName = 'DealsBulkBarBody'

export default DealsBulkBar
