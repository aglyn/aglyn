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
 * them into a spreadsheet, or let them go from this site's CRM.
 *
 * ## The chrome is the shared frame
 *
 * This bar settled how a bar over a table reads — it appears only for a
 * selection and says how many, its actions sit in one wrapping row with
 * Clear at the end, and whatever the last action could not do is listed by
 * name in an alert under it — and the companies, deals and tasks bars were
 * built on that shape as `CrmBulkBarFrame` and `useCrmBulkApply` (AGL-2621).
 * The contacts bar stands on the same two (AGL-2635): what is its own is the
 * actions, the dialog's field, the audience door, and how each act is sent.
 *
 * ## Each act goes where its field is written (AGL-2804)
 *
 * A contact's tags, owner and company live in the holder's facet, which is
 * the server's to write — the rules cannot tell one field of a facet from
 * another — so each of those acts is ONE request to `crm/contact-update` for
 * the rows it reaches (`contacts-bulk-writes.ts` decides which), sent in
 * pieces the route accepts. A stage move is `crm/contact-stage`, row by row:
 * a move is what an automation listens for, and only the route that
 * performed it can announce it. Letting the rows go is the one act written
 * client-direct, because a holder dropping its own facet is the one facet
 * change the rules leave the browser.
 *
 * ## A refused row is named
 *
 * Whatever the server or the store refused comes back by address into the
 * alert under the bar — not into a count, and not into the console. A
 * merchant who tagged four hundred people and got three hundred and
 * ninety-eight needs the two addresses.
 *
 * ## Add to list goes through the audience's own door
 *
 * The membership routes, with the check-then-attest sequence the Emails
 * console runs — see `add-to-list-dialog.tsx`. Nothing here writes a
 * membership document.
 */

import {
  type AglynOrgBilling,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  type ConsentGroup,
  type ContactLifecycleStage,
} from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { Button, MenuItem, TextField } from '@mui/material'
import { deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  useFirestore,
  useOrgMemberOptions,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { useContactUpdate } from '../hooks/use-contact-update'
import { useCrmBulkApply } from '../hooks/use-crm-bulk-apply'
import { useCrmScope } from '../hooks/use-crm-scope'
import { CRM_CONTACT_UPDATE_MAX, type ContactUpdateFields } from '../model/contact-update'
import { setContactStage } from '../model/crm-api'
import {
  contactBulkAddressOf,
  normalizeBulkTag,
  planAddTag,
  planDetach,
  planRemoveTag,
  planSetCompany,
  type ContactBulkRow,
  type ContactBulkSelection,
  type ContactBulkSkip,
  type ContactBulkWrite,
} from '../model/contacts-bulk-writes'
import {
  type ContactCsvOptions,
  type ContactCsvRow,
  contactsCsv,
  downloadTextFile,
} from '../model/contacts-csv'
import {
  type CrmBulkOutcome,
  runCrmBulkBatch,
  runCrmBulkCalls,
  runCrmBulkWrites,
} from '../model/crm-bulk-writes'
import AddToListDialog from './add-to-list-dialog'
import {
  CompanyPicker,
  type CompanyOption,
  useCompanyOptions,
  useCreateCompany,
} from './company-picker'
import {
  type CrmBulkNoun,
  CrmBulkBarFrame,
  CrmBulkValueDialog,
  countNoun,
} from './crm-bulk-bar-frame'
import CrmExportAllButton from './crm-export-all-button'
import { CrmSuiteLockedButton } from './crm-suite-lock'

export interface ContactsBulkBarProps {
  /** The site the list is read under, or `null` at the organization level. */
  hostId: string | null
  /** The org document the shell passed, for the company picker's scope. */
  org?: Partial<AglynOrgBilling> | null
  /** `['orgs', orgId]`, or `null` while the org is unresolved. */
  scope: readonly [string, string] | null
  /**
   * The holder these rows are being read AS — whose facet the acts land in.
   * `null` at the organization level (AGL-2630), where each row's own holder
   * (`groupId`) takes the act instead, and "Remove from this site" is not
   * offered because there is no site to remove from.
   */
  consentGroup: ConsentGroup | null
  /** The table's rows, already projected through the holder's facet. */
  rows: readonly (ContactBulkRow & ContactCsvRow)[]
  selected: readonly string[]
  onSelectedChange: (ids: string[]) => void
  /**
   * How the export names an owner and which custom fields it carries — the
   * table's own options, so the selection's file and the table's are one
   * format (AGL-2621).
   */
  csv?: ContactCsvOptions
  /**
   * The org's plan lacks the CRM suite (AGL-2788). The owner, the stage and
   * the company are the suite's and stand locked; tags, the exports, the
   * audience door and removing people from a site are not the suite's.
   */
  suiteLocked?: boolean
}

const NOUN: CrmBulkNoun = { singular: 'contact', plural: 'contacts' }

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
  const people = countNoun(done, NOUN)
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

/** The report's line for a row an act left out on purpose. */
const skippedLine = (row: ContactBulkSkip) => ({ label: row.email, reason: row.reason })

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
  const {
    hostId,
    org,
    scope,
    consentGroup,
    rows,
    selected,
    onSelectedChange,
    csv,
    suiteLocked = false,
  } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { confirm } = useConfirmationContext()
  const { busy, report, apply, dismissReport } = useCrmBulkApply({ recordKind: 'contact' })
  const contactUpdate = useContactUpdate(hostId)

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected)
    return rows.filter((row) => chosen.has(row.$id))
  }, [rows, selected])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [value, setValue] = useState('')
  const [company, setCompany] = useState<CompanyOption | null>(null)
  const [listOpen, setListOpen] = useState(false)

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
  // The site the audiences API is asked from: the mounted one, or at the
  // organization level the one the reader picked (AGL-2630).
  const { createHostId } = useCrmScope({ hostId, org })

  const openAction = (action: PendingAction) => {
    setValue('')
    setCompany(null)
    setPending(action)
  }

  /**
   * The Firestore writers for the one act written client-direct: letting the
   * rows go, a batch at a time and a row at a time for a batch that failed.
   */
  const writers = useMemo(() => {
    const refFor = (id: string) =>
      doc(firestore, scope?.[0] ?? 'orgs', scope?.[1] ?? '', 'contacts', id)
    return {
      commitBatch: async (writes: readonly ContactBulkWrite[]) => {
        const batch = writeBatch(firestore)
        for (const write of writes) {
          if (write.kind === 'delete') batch.delete(refFor(write.id))
          else batch.update(refFor(write.id), write.data)
        }
        await batch.commit()
      },
      commitOne: async (write: ContactBulkWrite) => {
        if (write.kind === 'delete') await deleteDoc(refFor(write.id))
        else await updateDoc(refFor(write.id), write.data)
      },
    }
  }, [firestore, scope])

  /** One act's request for the rows it reaches, in the pieces the route accepts. */
  const saveThroughRoute = useCallback(
    (targets: readonly ContactBulkRow[], set: ContactUpdateFields) =>
      runCrmBulkBatch(
        targets,
        (row) => row.$id,
        contactBulkAddressOf,
        (piece) => contactUpdate.updateMany(piece.map((row) => row.$id), set),
        CRM_CONTACT_UPDATE_MAX,
      ),
    [contactUpdate],
  )

  const handleApply = useCallback(async () => {
    if (!pending || !scope) return
    /*
     * A row no site holds has no facet to write. Under a site every selected
     * row is the viewing group's; at the organization level (AGL-2630) each
     * row was flattened through its own primary holder and is written back
     * through it, so a row nobody holds yet is left out and says so.
     */
    const held: ContactBulkRow[] = []
    const unheld: ContactBulkSkip[] = []
    for (const row of selectedRows) {
      if (consentGroup || row.groupId) held.push(row)
      else {
        unheld.push({
          email: contactBulkAddressOf(row),
          reason: 'no site holds this contact yet',
        })
      }
    }

    const planned = ((): { selection: ContactBulkSelection; job: () => Promise<CrmBulkOutcome> } | null => {
      if (pending === 'add-tag' || pending === 'remove-tag') {
        const tag = normalizeBulkTag(value)
        if (!tag) return null
        const selection =
          pending === 'add-tag' ? planAddTag(held, tag) : planRemoveTag(held, tag)
        const set: ContactUpdateFields =
          pending === 'add-tag' ? { addTag: tag } : { removeTag: tag }
        return { selection, job: () => saveThroughRoute(selection.rows, set) }
      }
      if (pending === 'owner') {
        return {
          selection: { rows: held, skipped: [] },
          job: () => saveThroughRoute(held, { ownerUid: value }),
        }
      }
      if (pending === 'company') {
        const companyId = company?.id ?? null
        const selection = planSetCompany(held, companyId)
        return { selection, job: () => saveThroughRoute(selection.rows, { companyId }) }
      }
      if (!value) return null
      const stage = value as ContactLifecycleStage
      return {
        selection: { rows: held, skipped: [] },
        /*
         * One row at a time through the one writer of a contact's stage, on
         * the site that holds the row: the mounted site, or at the
         * organization level the row's own holder's.
         */
        job: () =>
          runCrmBulkCalls(held, contactBulkAddressOf, async (row) => {
            const site = hostId ?? (row.holderHostId || null)
            if (!site) throw new Error('no site holds this contact yet')
            await setContactStage(user, site, row.$id, stage)
          }),
      }
    })()
    if (!planned) return
    const action = pending
    setPending(null)
    await apply({
      attempted: planned.selection.rows.length,
      skipped: [...unheld, ...planned.selection.skipped].map(skippedLine),
      job: planned.job,
      done: (count) => doneSentence(action, count),
    })
  }, [
    pending,
    scope,
    selectedRows,
    consentGroup,
    value,
    company,
    saveThroughRoute,
    hostId,
    user,
    apply,
  ])

  const handleExport = useCallback(() => {
    downloadTextFile(
      'contacts-selected.csv',
      'text/csv',
      contactsCsv(selectedRows, csv),
    )
  }, [selectedRows, csv])

  const handleDetach = useCallback(async () => {
    if (!scope || !selectedRows.length || !consentGroup) return
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
    const plan = planDetach(selectedRows, consentGroup, Date.now())
    const outcome = await apply({
      attempted: plan.writes.length,
      skipped: plan.skipped.map(skippedLine),
      job: () => runCrmBulkWrites(writers, plan.writes, (write) => write.email),
      done: (done) => doneSentence('detach', done),
    })
    // The rows that went are gone from the table; the refused ones stay
    // selected, so the reader can see which they are and try again.
    const refused = new Set(outcome.refused.map((row) => row.label))
    onSelectedChange(
      selectedRows
        .filter((row) => refused.has(contactBulkAddressOf(row)))
        .map((row) => row.$id),
    )
  }, [scope, selectedRows, confirm, apply, writers, consentGroup, onSelectedChange])

  const emails = selectedRows
    .map((row) => String(row.email ?? '').trim())
    .filter(Boolean)

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
            canApply={
              !(pending === 'stage' && !value) &&
              !(
                (pending === 'add-tag' || pending === 'remove-tag') &&
                !normalizeBulkTag(value)
              )
            }
            onClose={() => setPending(null)}
            onApply={() => void handleApply()}
          >
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
          </CrmBulkValueDialog>
          {listOpen ? (
            <AddToListDialog
              open
              onClose={() => setListOpen(false)}
              hostId={createHostId}
              scope={scope}
              emails={emails}
            />
          ) : null}
        </>
      }
    >
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
      {suiteLocked ? (
        <>
          <CrmSuiteLockedButton>{'Set owner'}</CrmSuiteLockedButton>
          <CrmSuiteLockedButton>{'Set stage'}</CrmSuiteLockedButton>
          <CrmSuiteLockedButton>{'Set company'}</CrmSuiteLockedButton>
        </>
      ) : (
        <>
          <Button size="small" disabled={busy || !scope} onClick={() => openAction('owner')}>
            {'Set owner'}
          </Button>
          <Button size="small" disabled={busy || !scope} onClick={() => openAction('stage')}>
            {'Set stage'}
          </Button>
          <Button
            size="small"
            disabled={busy || !scope}
            onClick={() => openAction('company')}
          >
            {'Set company'}
          </Button>
        </>
      )}
      <Button
        size="small"
        disabled={busy || !scope || !emails.length || !createHostId}
        onClick={() => setListOpen(true)}
      >
        {'Add to list'}
      </Button>
      <Button size="small" disabled={busy} onClick={handleExport}>
        {'Export CSV'}
      </Button>
      {/*
        The selection's file is the rows on screen; this one is the whole
        collection, streamed by the server (AGL-2662).
      */}
      <CrmExportAllButton
        resource="contacts"
        orgId={scope?.[1] ?? null}
        hostId={hostId}
        disabled={busy}
      />
      {/*
        Only under a site. The act is a DETACH from the viewing site's
        CRM, and at the organization level there is no viewing site — an
        org-wide member removes a person from a site by opening the record
        under that site.
      */}
      {consentGroup ? (
        <Button
          size="small"
          color="error"
          disabled={busy || !scope}
          onClick={() => void handleDetach()}
        >
          {'Remove from this site'}
        </Button>
      ) : null}
    </CrmBulkBarFrame>
  )
}
ContactsBulkBarBody.displayName = 'ContactsBulkBarBody'

export default ContactsBulkBar
