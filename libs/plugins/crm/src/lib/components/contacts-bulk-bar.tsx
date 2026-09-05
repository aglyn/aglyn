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
 * The bar over the contacts table, for whatever rows are ticked (AGL-2603).
 *
 * The table's selection is opt-in and this is what it is for: a chosen set
 * of people, and one act over all of them. Tag or untag them, hand them to
 * an owner, move them along the funnel, put them on an email audience, take
 * them into a spreadsheet, or let them go from this site's CRM. Each act is
 * the profile drawer's own write for one person, repeated — the patches come
 * from `contacts-bulk-writes.ts`, so the bar cannot spell a facet path
 * differently from the drawer.
 *
 * ## It appears when something is selected, and says how many
 *
 * Nothing renders with an empty selection: a bar of disabled buttons above
 * a list is a question the reader has to dismiss. With a selection it says
 * "n selected", so every button's object is on screen beside it.
 *
 * ## A refused row is named
 *
 * The writes go in batches with a per-row fallback, and whatever the store
 * refused comes back by address into an alert under the bar — not into a
 * count, and not into the console. A merchant who tagged four hundred people
 * and got three hundred and ninety-eight needs the two addresses.
 *
 * ## Add to list goes through the audience's own door
 *
 * The membership routes, with the check-then-attest sequence the Emails
 * console runs — see `add-to-list-dialog.tsx`. Nothing here writes a
 * membership document.
 */

import {
  type AglynOrgBilling,
  COMPANY_CONTACTS_COUNT_FIELD,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  type ConsentGroup,
  type ContactLifecycleStage,
  CRM_COLLECTIONS,
} from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  deleteDoc,
  doc,
  increment,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useOrgMemberOptions } from '@aglyn/tenant-feature-instance'
import {
  companyCountDeltas,
  normalizeBulkTag,
  planAddTag,
  planDetach,
  planRemoveTag,
  planSetCompany,
  planSetFacetField,
  runContactBulkWrites,
  type ContactBulkOutcome,
  type ContactBulkPlan,
  type ContactBulkRow,
  type ContactBulkWrite,
  type ContactBulkSkip,
} from '../model/contacts-bulk-writes'
import { contactsCsv, downloadTextFile } from '../model/contacts-csv'
import AddToListDialog from './add-to-list-dialog'
import {
  CompanyPicker,
  type CompanyOption,
  useCompanyOptions,
  useCreateCompany,
} from './company-picker'

export interface ContactsBulkBarProps {
  hostId: string
  /** The org document the shell passed, for the company picker's scope. */
  org?: Partial<AglynOrgBilling> | null
  /** `['orgs', orgId]`, or `null` while the org is unresolved. */
  scope: readonly [string, string] | null
  /** The holder these rows are being read AS — whose facet the writes land in. */
  consentGroup: ConsentGroup
  /** The table's rows, already projected through the holder's facet. */
  rows: readonly (ContactBulkRow & {
    name?: string
    notes?: string
    sources?: Record<string, unknown>
    interactions?: Array<{ atMs: number }>
  })[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
}

/** The one small dialog the value-taking actions share. */
type PendingAction = 'add-tag' | 'remove-tag' | 'owner' | 'stage' | 'company'

const ACTION_TITLES: Record<PendingAction, string> = {
  'add-tag': 'Add a tag',
  'remove-tag': 'Remove a tag',
  owner: 'Set the owner',
  stage: 'Set the lifecycle stage',
  company: 'Set the company',
}

/** How a finished action reads, given how many rows it reached. */
const doneSentence = (action: PendingAction | 'detach', done: number): string => {
  const people = done === 1 ? '1 contact' : `${done.toLocaleString()} contacts`
  switch (action) {
    case 'add-tag':
      return `Tagged ${people}`
    case 'remove-tag':
      return `Removed the tag from ${people}`
    case 'owner':
      return `Owner set on ${people}`
    case 'stage':
      return `Stage set on ${people}`
    case 'company':
      return `Company set on ${people}`
    case 'detach':
      return `${people} removed from this site`
  }
}

/**
 * The bar, or nothing.
 *
 * The empty state is a separate component boundary on purpose: with no
 * selection the body below is never mounted, so none of its hooks run — no
 * roster hook armed, no dialog state held — on the visit to the list that
 * every reader makes and most never tick a row on.
 */
export function ContactsBulkBar(props: ContactsBulkBarProps) {
  if (!props.selected.length) return null
  return <ContactsBulkBarBody {...props} />
}
ContactsBulkBar.displayName = 'ContactsBulkBar'

function ContactsBulkBarBody(props: ContactsBulkBarProps) {
  const { hostId, org, scope, consentGroup, rows, selected, onSelectedChange } =
    props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected)
    return rows.filter((row) => chosen.has(row.$id))
  }, [rows, selected])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [value, setValue] = useState('')
  const [company, setCompany] = useState<CompanyOption | null>(null)
  const [busy, setBusy] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  /** What the last action could not do, by address, until dismissed. */
  const [report, setReport] = useState<
    Array<{ email: string; reason: string }> | null
  >(null)

  /*
   * The roster, read only while the owner dialog is open. A bulk bar sits on
   * every visit to the list; the team is a request for a control nobody has
   * opened until they open it. The company list follows the same rule for
   * its own dialog (AGL-2613).
   */
  const team = useOrgMemberOptions(scope?.[1], { enabled: pending === 'owner' })
  const companies = useCompanyOptions({
    hostId,
    org,
    enabled: pending === 'company',
  })
  const createCompany = useCreateCompany({ hostId, org })

  const openAction = (action: PendingAction) => {
    setValue('')
    setCompany(null)
    setPending(action)
  }

  /**
   * The Firestore writers the runner drives — a batch, and a single write.
   *
   * A write that moves a company's contacts count carries the delta, and
   * the count lands in the SAME commit as the contact: summed per company
   * across a batch, so four hundred people set to Acme are one `increment`
   * on Acme, and applied on its own for the one row a per-row retry writes.
   */
  const writers = useMemo(() => {
    const refFor = (id: string) =>
      doc(firestore, scope?.[0] ?? 'orgs', scope?.[1] ?? '', 'contacts', id)
    const companyRef = (id: string) =>
      doc(
        firestore,
        scope?.[0] ?? 'orgs',
        scope?.[1] ?? '',
        CRM_COLLECTIONS.companies,
        id,
      )
    const stageCounts = (
      batch: ReturnType<typeof writeBatch>,
      writes: readonly ContactBulkWrite[],
    ) => {
      for (const [companyId, delta] of companyCountDeltas(writes)) {
        batch.update(companyRef(companyId), {
          [COMPANY_CONTACTS_COUNT_FIELD]: increment(delta),
        })
      }
    }
    return {
      commitBatch: async (writes: readonly ContactBulkWrite[]) => {
        const batch = writeBatch(firestore)
        for (const write of writes) {
          if (write.kind === 'delete') batch.delete(refFor(write.id))
          else batch.update(refFor(write.id), write.data)
        }
        stageCounts(batch, writes)
        await batch.commit()
      },
      commitOne: async (write: ContactBulkWrite) => {
        if (write.kind === 'delete') return void (await deleteDoc(refFor(write.id)))
        if (!write.companyCounts?.length) {
          return void (await updateDoc(refFor(write.id), write.data))
        }
        const batch = writeBatch(firestore)
        batch.update(refFor(write.id), write.data)
        stageCounts(batch, [write])
        await batch.commit()
      },
    }
  }, [firestore, scope])

  /** Apply a plan, then say what happened — the refused rows by address. */
  const apply = useCallback(
    async (action: PendingAction | 'detach', plan: ContactBulkPlan) => {
      setBusy(true)
      let outcome: ContactBulkOutcome = { done: 0, refused: [] }
      try {
        outcome = await runContactBulkWrites(writers, plan.writes)
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
        setBusy(false)
        return outcome
      }
      const left: ContactBulkSkip[] = [
        ...plan.skipped,
        ...outcome.refused.map((row) => ({ email: row.email, reason: row.error })),
      ]
      setReport(left.length ? left : null)
      enqueueSnackbar(
        outcome.done
          ? doneSentence(action, outcome.done)
          : plan.writes.length
            ? 'Nothing was changed'
            : 'Nothing to change',
        {
          variant: outcome.done && !left.length ? 'success' : 'warning',
          persist: false,
        },
      )
      setBusy(false)
      return outcome
    },
    [writers, enqueueSnackbar],
  )

  const handleApply = useCallback(async () => {
    if (!pending || !scope) return
    const nowMs = Date.now()
    const groupId = consentGroup.groupId
    let plan: ContactBulkPlan | null = null
    if (pending === 'add-tag' || pending === 'remove-tag') {
      const tag = normalizeBulkTag(value)
      if (!tag) return
      plan =
        pending === 'add-tag'
          ? planAddTag(selectedRows, groupId, tag, nowMs)
          : planRemoveTag(selectedRows, groupId, tag, nowMs)
    } else if (pending === 'owner') {
      plan = planSetFacetField(selectedRows, groupId, 'ownerUid', value || null, nowMs)
    } else if (pending === 'stage') {
      if (!value) return
      plan = planSetFacetField(
        selectedRows,
        groupId,
        'lifecycleStage',
        value as ContactLifecycleStage,
        nowMs,
      )
    } else if (pending === 'company') {
      plan = planSetCompany(selectedRows, groupId, company, nowMs)
    }
    if (!plan) return
    const action = pending
    setPending(null)
    await apply(action, plan)
  }, [pending, scope, consentGroup.groupId, value, company, selectedRows, apply])

  const handleExport = useCallback(() => {
    downloadTextFile(
      'contacts-selected.csv',
      'text/csv',
      contactsCsv(selectedRows),
    )
  }, [selectedRows])

  const handleDetach = useCallback(async () => {
    if (!scope || !selectedRows.length) return
    const count = selectedRows.length
    const confirmed = await confirm({
      title: count === 1 ? 'Remove this contact?' : `Remove ${count} contacts?`,
      description:
        `${count === 1 ? 'This person is' : `These ${count} people are`} ` +
        "removed from this site's Contacts, along with their notes, tags and " +
        'timeline. Other sites that captured the same people keep their own ' +
        'records. Their form submissions, orders, bookings, and membership ' +
        'records are separate — delete those from their own pages if the ' +
        'request covers them.',
      confirmationText: count === 1 ? 'Remove contact' : 'Remove contacts',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel.
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const outcome = await apply(
      'detach',
      planDetach(selectedRows, consentGroup, Date.now()),
    )
    // The rows that went are gone from the table; the refused ones stay
    // selected, so the reader can see which they are and try again.
    const refused = new Set(outcome.refused.map((row) => row.email))
    onSelectedChange(
      selectedRows
        .filter((row) => refused.has(String(row.email || row.$id)))
        .map((row) => row.$id),
    )
  }, [scope, selectedRows, confirm, apply, consentGroup, onSelectedChange])

  const emails = selectedRows
    .map((row) => String(row.email ?? '').trim())
    .filter(Boolean)

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          alignItems: 'center',
          flexWrap: 'wrap',
          rowGap: 1,
          p: 1,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Typography variant="body2" sx={{ mr: 1 }}>
          {`${selected.length.toLocaleString()} selected`}
        </Typography>
        <Button size="small" disabled={busy || !scope} onClick={() => openAction('add-tag')}>
          {'Add tag'}
        </Button>
        <Button
          size="small"
          disabled={busy || !scope}
          onClick={() => openAction('remove-tag')}
        >
          {'Remove tag'}
        </Button>
        <Button size="small" disabled={busy || !scope} onClick={() => openAction('owner')}>
          {'Set owner'}
        </Button>
        <Button size="small" disabled={busy || !scope} onClick={() => openAction('stage')}>
          {'Set stage'}
        </Button>
        <Button size="small" disabled={busy || !scope} onClick={() => openAction('company')}>
          {'Set company'}
        </Button>
        <Button
          size="small"
          disabled={busy || !scope || !emails.length}
          onClick={() => setListOpen(true)}
        >
          {'Add to list'}
        </Button>
        <Button size="small" disabled={busy} onClick={handleExport}>
          {'Export CSV'}
        </Button>
        <Button
          size="small"
          color="error"
          disabled={busy || !scope}
          onClick={() => void handleDetach()}
        >
          {'Remove from this site'}
        </Button>
        <Button size="small" disabled={busy} onClick={() => onSelectedChange([])}>
          {'Clear'}
        </Button>
      </Stack>
      {report ? (
        <Alert severity="warning" onClose={() => setReport(null)}>
          <Typography variant="body2">
            {report.length === 1
              ? 'One contact was not changed:'
              : `${report.length} contacts were not changed:`}
          </Typography>
          {report.map((row) => (
            <Typography key={`${row.email}:${row.reason}`} variant="caption" component="div">
              {`${row.email} — ${row.reason}`}
            </Typography>
          ))}
        </Alert>
      ) : null}

      <Dialog
        open={pending !== null}
        onClose={busy ? undefined : () => setPending(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{pending ? ACTION_TITLES[pending] : ''}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {`Applies to ${selected.length.toLocaleString()} selected ${
                selected.length === 1 ? 'contact' : 'contacts'
              }.`}
            </Typography>
            {pending === 'add-tag' || pending === 'remove-tag' ? (
              <TextField
                autoFocus
                size="small"
                label="Tag"
                placeholder="vip"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                helperText={
                  pending === 'add-tag'
                    ? 'Lowercased, like the tags on a profile'
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
                error={Boolean(team.error)}
                helperText={team.error ?? (team.ready ? undefined : 'Loading the team…')}
              >
                <MenuItem value="">{'Nobody — clear the owner'}</MenuItem>
                {team.options.map((member) => (
                  <MenuItem key={member.uid} value={member.uid}>
                    {member.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : pending === 'stage' ? (
              <TextField
                select
                size="small"
                label="Lifecycle stage"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                {CONTACT_LIFECYCLE_STAGES.map((stage) => (
                  <MenuItem key={stage} value={stage}>
                    {CONTACT_LIFECYCLE_STAGE_LABELS[stage]}
                  </MenuItem>
                ))}
              </TextField>
            ) : pending === 'company' ? (
              <CompanyPicker
                options={companies.options}
                ready={companies.ready}
                truncated={companies.truncated}
                value={company?.id ?? null}
                onChange={(_id, picked) => setCompany(picked)}
                onCreate={createCompany}
                helperText="Leave it empty to unlink the selected contacts from their companies."
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={
              busy ||
              (pending === 'stage' && !value) ||
              ((pending === 'add-tag' || pending === 'remove-tag') &&
                !normalizeBulkTag(value))
            }
            onClick={() => void handleApply()}
          >
            {'Apply'}
          </Button>
        </DialogActions>
      </Dialog>

      {listOpen ? (
        <AddToListDialog
          open
          onClose={() => setListOpen(false)}
          hostId={hostId}
          scope={scope}
          emails={emails}
        />
      ) : null}
    </Stack>
  )
}
ContactsBulkBarBody.displayName = 'ContactsBulkBarBody'

export default ContactsBulkBar
