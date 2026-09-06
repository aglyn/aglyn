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
 * The bar over the companies table, for whatever rows are ticked
 * (AGL-2621).
 *
 * Tag or untag them, hand them to an owner, take them into a spreadsheet,
 * or delete them. The patches come from `companies-bulk-writes.ts` and go
 * through the shared runner; the delete is the record page's own
 * detach-then-delete, per company, one after another — a company past the
 * detach bound is left standing and NAMED, the way the page says it, so a
 * second delete continues where this one stopped.
 *
 * ## The delete is logged, per company
 *
 * Each company that goes is one line in the site's activity feed, as it
 * would be from its own page. A bulk delete of forty companies is forty
 * acts and forty lines; a single "deleted 40 companies" line would name
 * none of them, and the feed exists to answer "where did Acme go".
 */

import { CRM_COLLECTIONS } from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useFirestore, useHostActivityLogger } from '@aglyn/tenant-feature-instance'
import { Button, MenuItem, TextField } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useCrmBulkApply } from '../hooks/use-crm-bulk-apply'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import {
  type CompanyBulkRow,
  planCompanyAddTag,
  planCompanyRemoveTag,
  planCompanySetOwner,
} from '../model/companies-bulk-writes'
import {
  type CompanyCsvOptions,
  type CompanyCsvRow,
  companiesCsv,
} from '../model/companies-csv'
import { COMPANY_DETACH_LIMIT } from '../model/companies'
import { deleteCompanyDetaching } from '../model/company-delete'
import { normalizeBulkTag } from '../model/contacts-bulk-writes'
import { downloadTextFile } from '../model/contacts-csv'
import {
  type CrmBulkPlan,
  crmBulkWriters,
  runCrmBulkCalls,
  runCrmBulkWrites,
} from '../model/crm-bulk-writes'
import {
  type CrmBulkNoun,
  CrmBulkBarFrame,
  CrmBulkValueDialog,
  countNoun,
} from './crm-bulk-bar-frame'

export interface CompaniesBulkBarProps {
  /**
   * The site whose activity feed the bar's acts are logged in, or `null`
   * at the organization level (AGL-2630), where the selection spans sites
   * and no one feed is written.
   */
  hostId: string | null
  /** `['orgs', orgId]`, or `null` while the org is unresolved. */
  scope: readonly ['orgs', string] | null
  rows: readonly (CompanyBulkRow & CompanyCsvRow)[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
  /** The section's roster — already read for the Owner column. */
  members: OrgMemberOptions
  /** How the export names an owner — the table's own options. */
  csv?: CompanyCsvOptions
}

const NOUN: CrmBulkNoun = { singular: 'company', plural: 'companies' }

type PendingAction = 'add-tag' | 'remove-tag' | 'owner'

const ACTION_TITLES: Record<PendingAction, string> = {
  'add-tag': 'Add a tag',
  'remove-tag': 'Remove a tag',
  owner: 'Set the owner',
}

const doneSentence = (action: PendingAction, done: number): string => {
  const rows = countNoun(done, NOUN)
  switch (action) {
    case 'add-tag':
      return `Tagged ${rows}`
    case 'remove-tag':
      return `Removed the tag from ${rows}`
    case 'owner':
      return `Owner set on ${rows}`
  }
}

/**
 * The bar, or nothing — a separate boundary so the body's hooks never run
 * on the visit to the list that ticks no row.
 */
export function CompaniesBulkBar(props: CompaniesBulkBarProps) {
  if (!props.selected.length) return null
  return <CompaniesBulkBarBody {...props} />
}
CompaniesBulkBar.displayName = 'CompaniesBulkBar'

function CompaniesBulkBarBody(props: CompaniesBulkBarProps) {
  const { hostId, scope, rows, selected, onSelectedChange, members, csv } = props
  const firestore = useFirestore()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId ?? undefined)
  const { busy, report, apply, dismissReport } = useCrmBulkApply({ recordKind: 'company' })

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected)
    return rows.filter((row) => chosen.has(row.$id))
  }, [rows, selected])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [value, setValue] = useState('')

  const writers = useMemo(
    () =>
      crmBulkWriters(firestore, (id) =>
        doc(firestore, scope?.[0] ?? 'orgs', scope?.[1] ?? '', CRM_COLLECTIONS.companies, id),
      ),
    [firestore, scope],
  )

  const openAction = (action: PendingAction) => {
    setValue('')
    setPending(action)
  }

  const runPlan = useCallback(
    (action: PendingAction, plan: CrmBulkPlan) =>
      apply({
        attempted: plan.writes.length,
        skipped: plan.skipped,
        job: () => runCrmBulkWrites(writers, plan.writes, (write) => write.label),
        done: (count) => doneSentence(action, count),
      }),
    [apply, writers],
  )

  const handleApply = useCallback(async () => {
    if (!pending || !scope) return
    const nowMs = Date.now()
    const tag = normalizeBulkTag(value)
    if (pending !== 'owner' && !tag) return
    const plan: CrmBulkPlan =
      pending === 'add-tag'
        ? planCompanyAddTag(selectedRows, tag ?? '', nowMs)
        : pending === 'remove-tag'
          ? planCompanyRemoveTag(selectedRows, tag ?? '', nowMs)
          : planCompanySetOwner(selectedRows, value || null, nowMs)
    const action = pending
    setPending(null)
    await runPlan(action, plan)
  }, [pending, scope, value, selectedRows, runPlan])

  const handleExport = useCallback(() => {
    downloadTextFile('companies-selected.csv', 'text/csv', companiesCsv(selectedRows, csv))
  }, [selectedRows, csv])

  const handleDelete = useCallback(async () => {
    if (!scope || !selectedRows.length) return
    const count = selectedRows.length
    const confirmed = await confirm({
      title: count === 1 ? 'Delete this company?' : `Delete ${count} companies?`,
      description:
        `${count === 1 ? 'It is' : 'They are'} removed from Companies and ` +
        'unlinked from every contact at them. The contacts themselves are ' +
        'kept, and so is anything else filed against the companies.',
      confirmationText: count === 1 ? 'Delete company' : 'Delete companies',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel.
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const outcome = await apply({
      attempted: count,
      skipped: [],
      job: () =>
        runCrmBulkCalls(
          selectedRows,
          (row) => String(row.name || row.$id),
          async (row) => {
            const result = await deleteCompanyDetaching(firestore, scope, row.$id)
            if (!result.deleted) {
              throw new Error(
                `${COMPANY_DETACH_LIMIT.toLocaleString()} contacts were unlinked ` +
                  'and more remain — delete again to continue',
              )
            }
            logActivity('Deleted company', {
              type: 'company',
              id: row.$id,
              name: row.name,
            })
          },
        ),
      done: (done) => `Deleted ${countNoun(done, NOUN)}`,
    })
    // The rows that went are gone from the table; the refused ones stay
    // selected, so the reader can see which they are and try again.
    const refused = new Set(outcome.refused.map((row) => row.label))
    onSelectedChange(
      selectedRows
        .filter((row) => refused.has(String(row.name || row.$id)))
        .map((row) => row.$id),
    )
  }, [scope, selectedRows, confirm, apply, firestore, logActivity, onSelectedChange])

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
          canApply={pending === 'owner' || Boolean(normalizeBulkTag(value))}
          onClose={() => setPending(null)}
          onApply={() => void handleApply()}
        >
          {pending === 'add-tag' || pending === 'remove-tag' ? (
            <TextField
              autoFocus
              size="small"
              label="Tag"
              placeholder="enterprise"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              helperText={
                pending === 'add-tag'
                  ? 'Lowercased, like the tags on a company'
                  : 'Removed wherever it is present'
              }
            />
          ) : pending === 'owner' ? (
            <TextField
              select
              size="small"
              label="Owner"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={!members.ready}
              error={Boolean(members.error)}
              helperText={members.error ?? (members.ready ? undefined : 'Loading the team…')}
            >
              <MenuItem value="">{'Nobody — clear the owner'}</MenuItem>
              {members.options.map((member) => (
                <MenuItem key={member.uid} value={member.uid}>
                  {member.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </CrmBulkValueDialog>
      }
    >
      <Button size="small" disabled={busy || !scope} onClick={() => openAction('add-tag')}>
        {'Add tag'}
      </Button>
      <Button size="small" disabled={busy || !scope} onClick={() => openAction('remove-tag')}>
        {'Remove tag'}
      </Button>
      <Button size="small" disabled={busy || !scope} onClick={() => openAction('owner')}>
        {'Set owner'}
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
CompaniesBulkBarBody.displayName = 'CompaniesBulkBarBody'

export default CompaniesBulkBar
