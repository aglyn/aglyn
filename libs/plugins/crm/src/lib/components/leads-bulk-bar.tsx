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
 * The bar over the Leads table, for whatever rows are ticked (AGL-2662).
 *
 * Hand them to an owner, set their status, unqualify them with one reason,
 * or take them into a spreadsheet. Every act here is a document write and
 * nothing more — a lead's status and owner are the team's own notes on a
 * capture, with no event and no notification behind them, which is why the
 * row's inline select writes them client-direct — so the whole bar goes
 * through the shared batched runner under the same rules.
 *
 * ## A row names its own site
 *
 * A lead lives at `hosts/{hostId}/leads/{leadId}`, and at the organization
 * level the selection spans sites, so the reference for a write is built
 * from the ROW rather than from a scope the bar was handed: the row knows
 * its site, the bar need not. Under a site every row names the same one.
 *
 * ## What is declined, by name
 *
 * A converted lead's status IS its conversion, stamped by the route, and
 * the bar leaves it alone under Set status and Unqualify the way the row
 * menu and the inline select do. A lead already closed is not unqualified
 * twice. A lead already at the asked status is skipped rather than rewritten
 * so "Nothing to change" means what it says.
 */

import {
  CRM_LEAD_STATUS_LABELS,
  type CrmLeadFields,
  type CrmLeadStatus,
  crmLeadStatus,
  isCrmLeadOpen,
} from '@aglyn/aglyn'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Button, MenuItem, TextField } from '@mui/material'
import { deleteField, doc, serverTimestamp } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmBulkApply } from '../hooks/use-crm-bulk-apply'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import { downloadTextFile } from '../model/contacts-csv'
import {
  type CrmBulkPlan,
  type CrmBulkSkip,
  type CrmBulkWrite,
  crmBulkWriters,
  runCrmBulkWrites,
} from '../model/crm-bulk-writes'
import { type LeadCsvOptions, leadsCsv } from '../model/leads-csv'
import {
  type CrmBulkNoun,
  CrmBulkBarFrame,
  CrmBulkValueDialog,
  countNoun,
} from './crm-bulk-bar-frame'
import CrmExportAllButton from './crm-export-all-button'
import { LeadOwnerSelect } from './lead-owner-select'
import { UNQUALIFY_REASON_MAX } from './lead-unqualify-dialog'

/**
 * One row of the Leads list as the bar needs it: the document's fields,
 * the grid's key, and which document under which site a write names.
 */
export type LeadBulkRow = Record<string, unknown> &
  CrmLeadFields & { $id: string; leadId: string; hostId: string }

export interface LeadsBulkBarProps {
  rows: readonly LeadBulkRow[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
  /** The section's roster — already read for the Owner column. */
  roster: OrgMemberOptions
  /** How the export names the owner and, at the org level, the site — the list's own. */
  csv?: LeadCsvOptions
  /** The organization these leads belong to; null while it is unresolved. */
  orgId?: string | null
  /**
   * The site the list is read under, or `null` at the organization level
   * where the complete export spans every site (AGL-2662).
   */
  hostId?: string | null
}

const NOUN: CrmBulkNoun = { singular: 'lead', plural: 'leads' }

type PendingAction = 'owner' | 'status' | 'unqualify'

const ACTION_TITLES: Record<PendingAction, string> = {
  owner: 'Set the owner',
  status: 'Set the status',
  unqualify: 'Unqualify',
}

/** The statuses the bar can set — the open ones; closing goes through Unqualify. */
const SETTABLE_STATUSES: readonly CrmLeadStatus[] = ['new', 'working']

/** The label a report lists a lead under — its name, else its address. */
const labelOf = (lead: LeadBulkRow): string =>
  String(lead['name'] || lead['email'] || lead.leadId)

export function LeadsBulkBar(props: LeadsBulkBarProps) {
  if (!props.selected.length) return null
  return <LeadsBulkBarBody {...props} />
}
LeadsBulkBar.displayName = 'LeadsBulkBar'

function LeadsBulkBarBody(props: LeadsBulkBarProps) {
  const { rows, selected, onSelectedChange, roster, csv } = props
  const orgId = props.orgId ?? null
  const hostId = props.hostId ?? null
  const firestore = useFirestore()
  const { busy, report, apply, dismissReport } = useCrmBulkApply({ recordKind: 'lead' })

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected)
    return rows.filter((row) => chosen.has(row.$id))
  }, [rows, selected])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [value, setValue] = useState('')

  // The reference a write names is the row's own site and document.
  const writers = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.$id, row]))
    return crmBulkWriters(firestore, (id) => {
      const row = byId.get(id)
      return doc(firestore, 'hosts', row?.hostId ?? '', 'leads', row?.leadId ?? id)
    })
  }, [firestore, rows])

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

  const handleApply = useCallback(async () => {
    if (!pending) return
    const action = pending
    setPending(null)
    const writes: CrmBulkWrite[] = []
    const skipped: CrmBulkSkip[] = []
    if (action === 'owner') {
      for (const lead of selectedRows) {
        writes.push({
          id: lead.$id,
          label: labelOf(lead),
          kind: 'update',
          data: { ownerUid: value ? value : deleteField(), updatedAt: serverTimestamp() },
        })
      }
      await runPlan(
        { writes, skipped },
        (count) => (value ? `Owner set on ${countNoun(count, NOUN)}` : `Owner cleared on ${countNoun(count, NOUN)}`),
      )
      return
    }
    if (action === 'status') {
      const status = value as CrmLeadStatus
      for (const lead of selectedRows) {
        const current = crmLeadStatus(lead)
        if (lead.convertedContactId) {
          skipped.push({ label: labelOf(lead), reason: 'was converted' })
        } else if (current === status) {
          skipped.push({
            label: labelOf(lead),
            reason: `already ${CRM_LEAD_STATUS_LABELS[status]}`,
          })
        } else {
          writes.push({
            id: lead.$id,
            label: labelOf(lead),
            kind: 'update',
            data: {
              status,
              // Reopening an unqualified lead clears its reason, as the row does.
              ...(current === 'unqualified' ? { unqualifiedReason: deleteField() } : {}),
              updatedAt: serverTimestamp(),
            },
          })
        }
      }
      await runPlan(
        { writes, skipped },
        (count) => `Status set on ${countNoun(count, NOUN)}`,
      )
      return
    }
    const reason = value.trim().slice(0, UNQUALIFY_REASON_MAX)
    for (const lead of selectedRows) {
      if (lead.convertedContactId) {
        skipped.push({ label: labelOf(lead), reason: 'was converted' })
      } else if (!isCrmLeadOpen(lead)) {
        skipped.push({ label: labelOf(lead), reason: 'is already closed' })
      } else {
        writes.push({
          id: lead.$id,
          label: labelOf(lead),
          kind: 'update',
          data: {
            status: 'unqualified' satisfies CrmLeadStatus,
            unqualifiedReason: reason,
            updatedAt: serverTimestamp(),
          },
        })
      }
    }
    await runPlan(
      { writes, skipped },
      (count) => `Marked ${countNoun(count, NOUN)} unqualified`,
    )
  }, [pending, value, selectedRows, runPlan])

  const handleExport = useCallback(() => {
    downloadTextFile('leads-selected.csv', 'text/csv', leadsCsv(selectedRows, csv))
  }, [selectedRows, csv])

  const canApply =
    pending === 'owner' || (pending === 'status' ? Boolean(value) : Boolean(value.trim()))

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
          canApply={canApply}
          applyLabel={pending === 'unqualify' ? 'Unqualify' : undefined}
          onClose={() => setPending(null)}
          onApply={() => void handleApply()}
        >
          {pending === 'owner' ? (
            <LeadOwnerSelect value={value} onChange={setValue} roster={roster} size="medium" />
          ) : pending === 'status' ? (
            <TextField
              select
              size="small"
              label="Status"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              helperText="Closing a lead goes through Unqualify, which asks why."
            >
              {SETTABLE_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {CRM_LEAD_STATUS_LABELS[status]}
                </MenuItem>
              ))}
            </TextField>
          ) : pending === 'unqualify' ? (
            <TextField
              label="Reason"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              multiline
              minRows={2}
              autoFocus
              helperText="One reason for every selected lead, kept on each so it can be counted later."
              slotProps={{ htmlInput: { maxLength: UNQUALIFY_REASON_MAX } }}
            />
          ) : null}
        </CrmBulkValueDialog>
      }
    >
      <Button size="small" disabled={busy} onClick={() => openAction('owner')}>
        {'Set owner'}
      </Button>
      <Button size="small" disabled={busy} onClick={() => openAction('status')}>
        {'Set status'}
      </Button>
      <Button size="small" disabled={busy} onClick={() => openAction('unqualify')}>
        {'Unqualify'}
      </Button>
      <Button size="small" disabled={busy} onClick={handleExport}>
        {'Export CSV'}
      </Button>
      {/*
        The selection's file is the rows on screen; this one is the whole
        collection, streamed by the server (AGL-2662).
      */}
      <CrmExportAllButton
        resource="leads"
        orgId={orgId}
        hostId={hostId}
        disabled={busy}
      />
    </CrmBulkBarFrame>
  )
}
LeadsBulkBarBody.displayName = 'LeadsBulkBarBody'

export default LeadsBulkBar
