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

import * as Aglyn from '@aglyn/aglyn'
import type { CrmLeadFields, CrmLeadStatus } from '@aglyn/aglyn'
import { mdiAccountCancelOutline } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  type FirestoreDocStatus,
  useFirestore,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useEffect, useId, useState } from 'react'
import { crmRoutes } from '../model/crm-routes'
import { CrmRecordChip, CrmRecordHeader } from './crm-record-header'
import { LeadOwnerSelect, type OrgMemberOptions } from './lead-owner-select'
import { LeadStatusChip } from './lead-status-chip'

const NOTES_MAX = 4000

/** A label over a value — the record page's one row shape. */
function Fact(props: { label: string; children: React.ReactNode }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        {props.label}
      </Typography>
      <Typography variant="body2" component="div">
        {props.children}
      </Typography>
    </Stack>
  )
}

export interface LeadPropertiesCardProps {
  hostId: string
  leadId: string
  lead: Record<string, unknown> & CrmLeadFields
  leadStatus: FirestoreDocStatus
  /** The listener has not confirmed this document with the server yet. */
  fromCache: boolean
  basePath: string
  roster: OrgMemberOptions
  onConvert: () => void
  onUnqualify: () => void
  /**
   * Items the page adds to the overflow beside Unqualify — the privacy
   * erasure (AGL-2623) lives on the page, because it needs the workspace
   * role and the API, and this card owns the header it must appear in.
   */
  extraMenuItems?: RowActionsMenuItem[]
  /** What the page shows above the facts — the erasure-pending state. */
  banner?: React.ReactNode
}

/**
 * What the team knows and decides about a lead: status, owner, notes, and
 * the identity and consent the capture recorded (AGL-2608).
 *
 * Status and owner are single-field client writes — the rules let a site
 * admin, editor or author update `hosts/{hostId}/leads`, and a one-field
 * `update` cannot roll anything else back. Notes are a text field seeded
 * from the document, so that save goes through `writeGuardedBySeed`: a draft
 * edited over a cached read would otherwise overwrite a newer note with an
 * older one plus a sentence.
 *
 * Converted leads are read-only here. Their status is the conversion, and
 * the actions become links to what the conversion made.
 */
export function LeadPropertiesCard(props: LeadPropertiesCardProps) {
  const {
    hostId,
    leadId,
    lead,
    leadStatus,
    fromCache,
    basePath,
    roster,
    onConvert,
    onUnqualify,
    extraMenuItems = [],
    banner,
  } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const routes = crmRoutes(basePath)
  const ref = doc(firestore, 'hosts', hostId, 'leads', leadId)
  const status = Aglyn.crmLeadStatus(lead)
  const converted = Boolean(lead.convertedContactId)
  const open = Aglyn.isCrmLeadOpen(lead) && !converted

  const [notes, setNotes] = useState(String(lead.notes ?? ''))
  // The label's id, so the status combobox is named "Status" rather than
  // after the status it shows — see `LeadOwnerSelect`.
  const statusLabelId = useId()
  const [notesDirty, setNotesDirty] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  // A newer note from the server replaces an UNEDITED draft; an edited one is
  // the reader's, and the guard on save decides whether it may land.
  useEffect(() => {
    if (!notesDirty) setNotes(String(lead.notes ?? ''))
  }, [lead.notes, notesDirty])

  const write = async (fields: Record<string, unknown>, done: string) => {
    try {
      await updateDoc(ref, { ...fields, updatedAt: serverTimestamp() })
      enqueueSnackbar(done, { variant: 'success', persist: false })
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : 'The lead could not be updated.',
        { variant: 'error' },
      )
    }
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    const verdict = await writeGuardedBySeed(
      { subject: 'lead', fromCache, unreadable: leadStatus === 'error' },
      () => write({ notes: notes.trim().slice(0, NOTES_MAX) }, 'Notes saved'),
    )
    setSavingNotes(false)
    if (!verdict.ok) {
      enqueueSnackbar(verdict.message ?? 'The notes could not be saved.', {
        variant: 'warning',
      })
      return
    }
    setNotesDirty(false)
  }

  const consent = Aglyn.readMarketingBasis(lead, Aglyn.soloConsentGroup(hostId))
  const consentLine =
    consent.basis === 'granted'
      ? `Opted in to marketing${
          consent.basisAtMs ? ` on ${new Date(consent.basisAtMs).toLocaleDateString()}` : ''
        }`
      : consent.basis === 'declined'
        ? 'Declined marketing'
        : 'No marketing consent recorded — this lead cannot be emailed marketing'

  return (
    <CrmRecordHeader
      kind="Lead"
      title={String(lead['name'] || lead['email'] || leadId)}
      // The name is the heading; the address is the one line under it,
      // unless the address IS the name, in which case there is no second fact.
      subtitle={lead['name'] ? String(lead['email'] ?? '') : undefined}
      help={Aglyn.pluginDocsHelp('crmLeads', { anchor: '#working-a-lead-from-the-row' })}
      backHref={routes.section('leads')}
      backLabel="Back to leads"
      actions={
        !converted ? (
          <Button size="small" variant="contained" onClick={onConvert}>
            {'Convert'}
          </Button>
        ) : null
      }
      menuItems={[
        ...(open
          ? [
              {
                key: 'unqualify',
                label: 'Unqualify',
                icon: <MdiIcon path={mdiAccountCancelOutline.path} size={0.8} />,
                destructive: true,
                onClick: onUnqualify,
              } satisfies RowActionsMenuItem,
            ]
          : []),
        ...extraMenuItems,
      ]}
      chips={
        <>
          <LeadStatusChip lead={lead} />
          <CrmRecordChip
            label="Owner"
            value={lead.ownerUid ? roster.labelFor(lead.ownerUid) : undefined}
          />
        </>
      }
    >
      <Stack spacing={3}>
        {banner}
        <Fact label="Marketing consent">{consentLine}</Fact>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          {converted ? (
            <Fact label="Status">
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <LeadStatusChip lead={lead} />
                <Typography variant="body2" color="text.secondary">
                  {lead.convertedAtMs
                    ? `Converted ${new Date(lead.convertedAtMs).toLocaleString()}`
                    : 'Converted'}
                </Typography>
              </Stack>
            </Fact>
          ) : (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id={statusLabelId}>{'Status'}</InputLabel>
              <Select
                labelId={statusLabelId}
                label="Status"
                value={status === 'unqualified' ? 'unqualified' : status}
                onChange={(event) => {
                  const next = String(event.target.value) as CrmLeadStatus
                  if (next === 'unqualified') {
                    onUnqualify()
                    return
                  }
                  // Reopening drops the reason with the closed state: a lead
                  // being worked again is not "unqualified because …".
                  void write(
                    {
                      status: next,
                      ...(status === 'unqualified' ? { unqualifiedReason: deleteField() } : {}),
                    },
                    'Status updated',
                  )
                }}
              >
                <MenuItem value="new">{Aglyn.CRM_LEAD_STATUS_LABELS.new}</MenuItem>
                <MenuItem value="working">{Aglyn.CRM_LEAD_STATUS_LABELS.working}</MenuItem>
                <MenuItem value="unqualified">
                  {`${Aglyn.CRM_LEAD_STATUS_LABELS.unqualified}…`}
                </MenuItem>
              </Select>
            </FormControl>
          )}
          <LeadOwnerSelect
            value={lead.ownerUid}
            roster={roster}
            fullWidth={false}
            onChange={(uid) =>
              void write({ ownerUid: uid || deleteField() }, uid ? 'Owner assigned' : 'Owner cleared')
            }
          />
        </Stack>
        {status === 'unqualified' && lead.unqualifiedReason ? (
          <Alert severity="info">{`Unqualified: ${lead.unqualifiedReason}`}</Alert>
        ) : null}
        {converted ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button
              component={AppLink as any}
              {...({ componentVariant: 'naked', nativeButton: false } as any)}
              href={routes.contact(String(lead.convertedContactId))}
              size="small"
              variant="outlined"
            >
              {'Open contact'}
            </Button>
            {lead.companyId ? (
              <Button
                component={AppLink as any}
                {...({ componentVariant: 'naked', nativeButton: false } as any)}
                href={routes.company(lead.companyId)}
                size="small"
                variant="outlined"
              >
                {'Open company'}
              </Button>
            ) : null}
            {lead.dealId ? (
              <Button
                component={AppLink as any}
                {...({ componentVariant: 'naked', nativeButton: false } as any)}
                href={routes.deal(lead.dealId)}
                size="small"
                variant="outlined"
              >
                {'Open deal'}
              </Button>
            ) : null}
          </Stack>
        ) : null}
        <Stack spacing={1}>
          <TextField
            size="small"
            label="Notes"
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value)
              setNotesDirty(true)
            }}
            multiline
            minRows={3}
            fullWidth
            slotProps={{ htmlInput: { maxLength: NOTES_MAX } }}
          />
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="contained"
              onClick={() => void saveNotes()}
              disabled={!notesDirty || savingNotes}
            >
              {'Save notes'}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </CrmRecordHeader>
  )
}
LeadPropertiesCard.displayName = 'LeadPropertiesCard'

export default LeadPropertiesCard
