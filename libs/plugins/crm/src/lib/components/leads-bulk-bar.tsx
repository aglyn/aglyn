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
 * A lead lives at `orgs/{orgId}/leads/{leadId}` (AGL-3275), and at the organization
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
  CRM_LEAD_OPEN_STATUSES,
  type CrmLeadFields,
  type CrmLeadStatus,
  crmLeadStatus,
  crmLeadStatusLabel,
  crmLeadStatusLabelFor,
  crmLeadStatusOptions,
  isCrmLeadOpen,
  readContainerIds,
} from '@aglyn/aglyn'
import ContainerPicker from '@aglyn/tenant-feature-instance/components/container-picker'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Button, MenuItem, TextField } from '@mui/material'
import { arrayUnion, deleteField, doc, serverTimestamp } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCampaignFilingLog } from '../hooks/use-campaign-filing-log'
import { useCrmBulkApply } from '../hooks/use-crm-bulk-apply'
import { useLeadStatusPicklist } from '../hooks/use-lead-status-picklist'
import { useCrmCampaigns } from '../hooks/use-crm-campaigns'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import { crmClientListFields } from '../model/crm-list-query'
import {
  type CrmBulkPlan,
  type CrmBulkSkip,
  type CrmBulkWrite,
  crmBulkWriters,
  runCrmBulkWrites,
} from '../model/crm-bulk-writes'
import {
  type CrmBulkNoun,
  CrmBulkBarFrame,
  CrmBulkValueDialog,
  countNoun,
} from './crm-bulk-bar-frame'
import { CrmExportButton } from './crm-transfer-buttons'
import { CRM_LEADS_RESOURCE } from '../transfer/fields'
import { CrmBulkShareButton } from './record-sharing-card'
import { LeadOwnerSelect } from './lead-owner-select'
import { UNQUALIFY_REASON_MAX } from './lead-unqualify-dialog'
import { useCrmSharingFollowUp } from '../hooks/use-crm-sharing'
import { leadPrimaryGroup } from '../model/contact-holder'

/**
 * One row of the Leads list as the bar needs it: the document's fields,
 * the grid's key, and which document under which site a write names.
 */
export type LeadBulkRow = Record<string, unknown> &
  CrmLeadFields & { $id: string; leadId: string }

export interface LeadsBulkBarProps {
  rows: readonly LeadBulkRow[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
  /** The section's roster — already read for the Owner column. */
  roster: OrgMemberOptions
  /** The organization these leads belong to; null while it is unresolved. */
  orgId?: string | null
  /**
   * The site the list is read under, or `null` at the organization level
   * where the complete export spans every site (AGL-2662).
   */
  hostId?: string | null
  /**
   * The org the shell passed, for the scope a filing entry carries
   * (AGL-3274): Add to campaign writes one on each lead's Activity, and
   * the entry is visible to whoever sees a record made on this site.
   */
  org?: Record<string, unknown> | null
}

const NOUN: CrmBulkNoun = { singular: 'lead', plural: 'leads' }

type PendingAction = 'owner' | 'status' | 'unqualify' | 'campaign'

const ACTION_TITLES: Record<PendingAction, string> = {
  owner: 'Set the owner',
  status: 'Set the status',
  unqualify: 'Unqualify',
  campaign: 'Add to campaign',
}

/** The statuses the bar can set — the open ones; closing goes through Unqualify. */
const SETTABLE_STATUSES: readonly CrmLeadStatus[] = CRM_LEAD_OPEN_STATUSES

/** The label a report lists a lead under — its name, else its address. */
const labelOf = (lead: LeadBulkRow): string =>
  String(lead['name'] || lead['email'] || lead.leadId)

export function LeadsBulkBar(props: LeadsBulkBarProps) {
  if (!props.selected.length) return null
  return <LeadsBulkBarBody {...props} />
}
LeadsBulkBar.displayName = 'LeadsBulkBar'

function LeadsBulkBarBody(props: LeadsBulkBarProps) {
  const { rows, selected, onSelectedChange, roster } = props
  const orgId = props.orgId ?? null
  const hostId = props.hostId ?? null
  const followUpSharing = useCrmSharingFollowUp(hostId, orgId)
  // The org's lead status values (AGL-3512): Set status picks a value by its
  // label, and every write stamps the meaning and the label together.
  const statuses = useLeadStatusPicklist(orgId)
  const statusChoices = useMemo(
    () => crmLeadStatusOptions(statuses.picklist, SETTABLE_STATUSES),
    [statuses.picklist],
  )
  const firestore = useFirestore()
  const { busy, report, apply, dismissReport } = useCrmBulkApply({ recordKind: 'lead' })

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected)
    return rows.filter((row) => chosen.has(row.$id))
  }, [rows, selected])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [value, setValue] = useState('')
  /*
   * The campaigns to add the selection to (AGL-3254), and the containers
   * the picker offers — read only while that dialog is open. Under a site,
   * the campaigns placed on it; at the organization level, where a
   * selection spans sites, every campaign in the org.
   */
  const [campaignIds, setCampaignIds] = useState<string[]>([])
  const campaigns = useCrmCampaigns(
    { hostId, orgId },
    { enabled: pending === 'campaign' },
  )
  const logFiling = useCampaignFilingLog({ orgId, hostId, org: props.org })

  // The reference a write names is the row's own site and document.
  const writers = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.$id, row]))
    return crmBulkWriters(firestore, (id) => {
      const row = byId.get(id)
      // One org collection (AGL-3275): the row no longer names a site, and
      // the bulk write addresses the same document at either level.
      // `orgs//leads` is a path Firestore accepts the shape of and nothing
      // owns, so an absent org refuses the write rather than composing one.
      if (!orgId) throw new Error('[crm] a lead write needs an organization')
      return doc(firestore, 'orgs', orgId, 'leads', row?.leadId ?? id)
    })
  }, [firestore, rows])

  const openAction = (action: PendingAction) => {
    setValue('')
    setCampaignIds([])
    setPending(action)
  }

  const runPlan = useCallback(
    (plan: CrmBulkPlan, done: (count: number) => string) =>
      apply({
        attempted: plan.writes.length,
        skipped: plan.skipped,
        job: async () => {
          const outcome = await runCrmBulkWrites(writers, plan.writes, (write) => write.label)
          // A client-direct write owes the sharing rules a re-evaluation (AGL-3336).
          followUpSharing(
            'leads',
            plan.writes.filter((write) => write.kind === 'update').map((write) => rows.find((row) => row.$id === write.id)?.leadId ?? write.id),
          )
          return outcome
        },
        done,
      }),
    [apply, writers, rows, followUpSharing],
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
    if (action === 'campaign') {
      // Added to what each lead carries — `arrayUnion`, the way a sequence's
      // enroll and the import add one — never in place of it.
      for (const lead of selectedRows) {
        // The union as it will stand, for the list field it moves (AGL-3321).
        const union = [...new Set([...readContainerIds(lead, 'campaign'), ...campaignIds])]
        writes.push({
          id: lead.$id,
          label: labelOf(lead),
          kind: 'update',
          data: {
            campaignIds: arrayUnion(...campaignIds),
            ...crmClientListFields('leads', lead, { campaignIds: union }, ['scopedCampaignIds']),
            updatedAt: serverTimestamp(),
          },
        })
      }
      const outcome = await runPlan(
        { writes, skipped },
        (count) =>
          `Added ${countNoun(count, NOUN)} to ${campaignIds.length === 1 ? 'the campaign' : `${campaignIds.length} campaigns`}`,
      )
      // What landed is written on each lead's Activity (AGL-3274): one
      // "Filed under" per campaign the lead was not already in, and none
      // for a lead the store refused — the row's own document is the
      // membership, and the entry only records the act.
      const refused = new Set(outcome.refused.map((entry) => entry.label))
      const named = campaignIds.map((campaignId) => ({
        id: campaignId,
        name: campaigns.options.find((option) => option.value === campaignId)?.label ?? '',
      }))
      for (const lead of selectedRows) {
        if (refused.has(labelOf(lead))) continue
        const already = readContainerIds(lead, 'campaign')
        const filed = named.filter((campaign) => !already.includes(campaign.id))
        // At the organization level each entry carries its own lead's first
        // capturing site, the one the lead's page files as.
        if (filed.length) {
          await logFiling(
            { leadId: lead.leadId },
            { filed },
            hostId ? null : leadPrimaryGroup(lead, props.org ?? null).hostId || null,
          )
        }
      }
      return
    }
    if (action === 'status') {
      const choice = statusChoices.find((entry) => entry.label === value)
      if (!choice) return
      const status = choice.status
      for (const lead of selectedRows) {
        const current = crmLeadStatus(lead)
        if (lead.convertedContactId) {
          skipped.push({ label: labelOf(lead), reason: 'was converted' })
        } else if (current === status && crmLeadStatusLabel(lead, statuses.picklist) === choice.label) {
          skipped.push({
            label: labelOf(lead),
            reason: `already ${choice.label}`,
          })
        } else {
          writes.push({
            id: lead.$id,
            label: labelOf(lead),
            kind: 'update',
            data: {
              status,
              statusLabel: choice.label,
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
            statusLabel: crmLeadStatusLabelFor(statuses.picklist, 'unqualified'),
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
  }, [pending, value, campaignIds, campaigns.options, selectedRows, runPlan, logFiling, hostId, props.org, statusChoices, statuses.picklist])

  const canApply =
    pending === 'owner' ||
    (pending === 'campaign'
      ? campaignIds.length > 0
      : pending === 'status'
        ? Boolean(value)
        : Boolean(value.trim()))

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
          applyLabel={pending === 'unqualify' ? 'Unqualify' : pending === 'campaign' ? 'Add' : undefined}
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
              {statusChoices.map((choice) => (
                <MenuItem key={choice.label} value={choice.label}>
                  {choice.label}
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
          ) : pending === 'campaign' ? (
            <ContainerPicker
              kind="campaign"
              options={campaigns.options}
              value={campaignIds}
              onChange={setCampaignIds}
              helperText="Added to the campaigns each selected lead is already in. It does not decide who a campaign mails."
              empty={campaigns.ready && !campaigns.options.length}
              emptyText={
                hostId
                  ? 'This site has no campaigns yet. Create one from Marketing to file leads under it.'
                  : 'There are no campaigns yet. Create one from Marketing to file leads under it.'
              }
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
      <Button size="small" disabled={busy} onClick={() => openAction('campaign')}>
        {'Add to campaign'}
      </Button>
      <CrmBulkShareButton
        object="leads"
        ids={selectedRows.map((row) => row.leadId ?? row.$id)}
        hostId={hostId}
        orgId={orgId}
        disabled={busy}
      />
      {/* The selection through the export dialog: every field, chosen (AGL-3528). */}
      <CrmExportButton
        resource={CRM_LEADS_RESOURCE}
        hostId={hostId}
        selection={selectedRows.map((row) => row.$id)}
        disabled={busy}
      />
    </CrmBulkBarFrame>
  )
}
LeadsBulkBarBody.displayName = 'LeadsBulkBarBody'

export default LeadsBulkBar
