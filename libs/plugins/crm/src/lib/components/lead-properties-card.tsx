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
import type {
  AglynOrgBilling,
  ConsentGroup,
  CrmLeadFields,
  CrmLeadProfilePatch,
} from '@aglyn/aglyn'
import { mdiAccountCancelOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
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
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useEffect, useId, useMemo, useState } from 'react'
import { useContactFieldDefinitions } from '../hooks/use-contact-field-definitions'
import { useLeadSourcePicklist } from '../hooks/use-lead-source-picklist'
import { useLeadStatusPicklist } from '../hooks/use-lead-status-picklist'
import { useLeadPicklists } from '../hooks/use-lead-picklists'
import {
  crmCustomDraftChanges,
  type CrmCustomDraft,
  crmCustomDraftMissingRequired,
  crmCustomDraftValue,
  crmCustomDraftWrites,
} from '../model/crm-custom-draft'
import { CrmCustomFieldControl } from './crm-custom-field-control'
import { crmRoutes } from '../model/crm-routes'
import {
  LeadProfileFields,
  type LeadProfileDraft,
  leadProfileDraftBody,
  leadProfileDraftFrom,
} from './lead-profile-fields'
import { CrmCallButton, CrmPhoneLink } from './crm-call-actions'
import { CrmEmailStateChip } from './crm-email-state-chip'
import { CrmAccountLockChip, CrmEmailGatewayChip } from './crm-email-check'
import { CrmRecordChip, CrmRecordHeader } from './crm-record-header'
import { CrmSendEmailButton } from './crm-send-email-button'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import { LeadOwnerSelect } from './lead-owner-select'
import { LeadStatusChip } from './lead-status-chip'
import { leadStatusChoices, leadStatusMenuItems } from './lead-status-options'
import {
  crmClientListFields,
  CRM_CLIENT_SEARCH_FIELDS,
  CRM_CLIENT_SORT_FIELDS,
} from '../model/crm-list-query'
import { useCrmSharingFollowUp } from '../hooks/use-crm-sharing'

/** The Leads list's fields a profile save rewrites; the verdict key is the server's. */
const LEAD_CLIENT_LIST_FIELDS = [
  ...CRM_CLIENT_SEARCH_FIELDS,
  // The Lead, Company and Title headers' sort keys (AGL-3680).
  ...CRM_CLIENT_SORT_FIELDS,
  'leadSourceKey',
  // The lead source's group, read off the org's list (AGL-3577).
  'leadSourceDirection',
  // Industry and Rating (AGL-3513).
  'industryKey',
  'ratingKey',
] as const

const NOTES_MAX = Aglyn.CRM_LEAD_NOTES_MAX

/** The patch as the document takes it: a cleared field is deleted, not blanked. */
function profileWrite(patch: CrmLeadProfilePatch): Record<string, unknown> {
  const write: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    write[key] = value === null ? deleteField() : value
  }
  return write
}

/**
 * Why Convert is refused while an erasure waits on the person — the same
 * sentence shape the overflow's items carry, so the two read as one state.
 */
export const CONVERT_PENDING_ERASURE_REASON = 'An erasure is pending for this person'

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

/**
 * The help on a lead's header card — one card, so the page's loading and
 * not-found branches carry the same link as the loaded one.
 */
export const LEAD_PAGE_HELP = Aglyn.pluginDocsHelp('crmLeads', { anchor: '#a-leads-page' })

export interface LeadPropertiesCardProps {
  /**
   * The site this lead is acted on as — the mounted one, or at the
   * organization level the lead's own first capturing site (AGL-3278).
   * `null` for a lead no site has captured: the booking door, the call and
   * the email close, because each of them is one site's to offer.
   */
  hostId: string | null
  /**
   * The group the consent basis is read against (AGL-3278): the site's own
   * declared group, resolved by the page. Not `soloConsentGroup(hostId)`,
   * which is what this card used to spell and which cannot see a refusal
   * recorded against a sibling brand — three sites presenting as one sender
   * are one sender to the person unsubscribing from them.
   */
  consentGroup: ConsentGroup
  /**
   * The org the site belongs to, as the page already resolved it — the
   * custom lead fields are ORG-wide (AGL-3272), and a second lookup here
   * would be one more read per record page for an answer already in hand.
   */
  orgId: string | null
  leadId: string
  lead: Record<string, unknown> & CrmLeadFields
  leadStatus: FirestoreDocStatus
  /** The listener has not confirmed this document with the server yet. */
  fromCache: boolean
  basePath: string
  roster: OrgMemberOptions
  onConvert: () => void
  /** Opens the Unqualify dialog — with the Unqualified value picked, when the status select named one. */
  onUnqualify: (statusLabel?: string) => void
  /**
   * Items the page adds to the overflow beside Unqualify — the privacy
   * erasure (AGL-2623) lives on the page, because it needs the workspace
   * role and the API, and this card owns the header it must appear in.
   */
  extraMenuItems?: RowActionsMenuItem[]
  /** What the page shows above the facts — the erasure-pending state. */
  banner?: React.ReactNode
  /**
   * Chips the page adds after the owner — the campaigns the lead is filed
   * under (AGL-3274), named from the containers the page reads once for
   * this header and the Campaigns card below it.
   */
  extraChips?: React.ReactNode
  /**
   * An erasure request is waiting on this person (AGL-2623). Convert stays
   * on the page but is refused with the reason, the way the overflow's items
   * are: a conversion filed now would reach the capture door only to be
   * refused there, and the lead itself goes when the request runs.
   */
  erasurePending?: boolean
  /**
   * The org the shell passed: the booking door reads whether the lead's site
   * runs Bookings and whether the plan is entitled to it (AGL-2660), and a
   * logged call reads the activity scope it belongs in (AGL-2661).
   */
  org?: Partial<AglynOrgBilling> | null
}

/**
 * What the team knows and decides about a lead: status, owner, notes, and
 * the identity and consent the capture recorded (AGL-2608).
 *
 * Two cards. The record's header carries the identity, the status and owner,
 * the consent the capture recorded and the record's actions. **Details**
 * under it carries the profile, the org's own lead fields under **More
 * fields**, and the notes — one card with one Save in its header, the way
 * Salesforce keeps a record's standard and custom fields in one Details
 * section.
 *
 * Status and owner are single-field client writes — the rules let a site
 * admin, editor or author update `hosts/{hostId}/leads`, and a one-field
 * `update` cannot roll anything else back. The details are drafts seeded
 * from the document, so their save goes through `writeGuardedBySeed`: a
 * draft edited over a cached read would otherwise overwrite a newer note or
 * profile with an older one.
 *
 * Converted leads are read-only here, but for the notes. Their status is the
 * conversion, and the header's actions become links to what the conversion
 * made.
 */
export function LeadPropertiesCard(props: LeadPropertiesCardProps) {
  const {
    hostId,
    consentGroup,
    orgId,
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
    extraChips,
    erasurePending = false,
    org,
  } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const routes = crmRoutes(basePath)
  // A client-direct write owes the org's sharing rules a re-evaluation (AGL-3336).
  const followUpSharing = useCrmSharingFollowUp(hostId, orgId)
  /*
   * Built at USE, not at render (AGL-3275). A lead is an org row, so the org
   * has to be known to address one — and `orgId` is null while the lookup
   * settles. Composing a ref from that null throws during render, which the
   * page shows as a 500 rather than as a card still loading.
   */
  const refFor = () => (orgId ? doc(firestore, 'orgs', orgId, 'leads', leadId) : null)
  const status = Aglyn.crmLeadStatus(lead)
  const converted = Boolean(lead.convertedContactId)
  const open = Aglyn.isCrmLeadOpen(lead) && !converted
  // The last verdict on the address (AGL-3245), as the platform stamped it.
  const emailState = Aglyn.readEmailState(lead)
  /** What a capture that took a number left on the document (AGL-2661). */
  const leadPhone = String(lead['phone'] ?? '').trim()
  const leadMobile = String(lead.mobilePhone ?? '').trim()
  // The person asked not to be phoned (AGL-3513): a hint on every dial control.
  const doNotCall = lead.doNotCall === true

  const [notes, setNotes] = useState(String(lead.notes ?? ''))
  // The label's id, so the status combobox is named "Status" rather than
  // after the status it shows — see `LeadOwnerSelect`.
  const statusLabelId = useId()
  const [notesDirty, setNotesDirty] = useState(false)
  /*
   * THE LEAD'S OWN PROFILE (AGL-3231, AGL-3513) — the name's parts,
   * company, title, the phones, website, address, tags, lead source,
   * industry, rating, size and revenue — edited in the Details card with
   * the notes and the custom fields, under one Save, the way the contact's
   * Properties card saves. Seeded from the document and guarded on save: a
   * draft edited over a cached read must not overwrite a newer profile
   * with an older one.
   */
  const [profile, setProfile] = useState<LeadProfileDraft>(() => leadProfileDraftFrom(lead))
  const [profileDirty, setProfileDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({})
  // The stored profile as one value, so a change to any of its fields reseeds.
  const profileSeed = JSON.stringify(Aglyn.CRM_LEAD_PROFILE_KEYS.map((key) => lead[key] ?? null))
  useEffect(() => {
    if (!profileDirty) setProfile(leadProfileDraftFrom(lead))
    // The draft follows the document until it is edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileDirty, profileSeed])
  /*
   * THE ORG'S OWN LEAD FIELDS (AGL-3272), edited under the same Save as
   * the profile: one button over one card, so a person filling a lead in
   * does not have to find two.
   *
   * The draft holds only the keys the reader touched, and Save writes the
   * difference as dotted paths — a `custom` map written whole would take
   * out every key this card did not show, which is what a retired field's
   * values and an integration's writes sit under.
   */
  const fields = useContactFieldDefinitions(orgId, 'lead')
  // The org's lead source values (AGL-3298), for the select below.
  const leadSources = useLeadSourcePicklist(orgId)
  // The org's lead status values (AGL-3512): the chip's words and the select's choices.
  const leadStatuses = useLeadStatusPicklist(orgId)
  // The org's Salutation, Industry and Rating lists (AGL-3513).
  const leadPicklists = useLeadPicklists(orgId)
  const statusChoices = useMemo(
    () => leadStatusChoices(leadStatuses.picklist, lead),
    [leadStatuses.picklist, lead],
  )
  const storedCustom = useMemo(() => lead.custom ?? {}, [lead.custom])
  const [custom, setCustom] = useState<CrmCustomDraft>({})

  const editProfile = <K extends keyof LeadProfileDraft>(key: K, value: LeadProfileDraft[K]) => {
    setProfile((current) => ({ ...current, [key]: value }))
    setProfileDirty(true)
  }
  // A newer note from the server replaces an UNEDITED draft; an edited one is
  // the reader's, and the guard on save decides whether it may land.
  useEffect(() => {
    if (!notesDirty) setNotes(String(lead.notes ?? ''))
  }, [lead.notes, notesDirty])

  /** One update of the lead, and whether it landed. */
  const write = async (fields: Record<string, unknown>, done: string): Promise<boolean> => {
    try {
      const ref = refFor()
      if (!ref) {
        enqueueSnackbar('Still loading this workspace — try again in a moment.', {
          variant: 'warning',
          persist: false,
        })
        return false
      }
      await updateDoc(ref, { ...fields, updatedAt: serverTimestamp() })
      followUpSharing('leads', [leadId])
      enqueueSnackbar(done, { variant: 'success', persist: false })
      return true
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : 'The lead could not be updated.',
        { variant: 'error' },
      )
      return false
    }
  }

  /*
   * What Save is offered for: a profile field edited, a custom value that
   * differs from the stored map, or the notes. Touched-and-put-back does
   * not count for a custom value — the draft keeps the key either way, and
   * a Save that wrote nothing would still bump `updatedAt`.
   */
  const customChanged = crmCustomDraftChanges(storedCustom, custom).length > 0
  const dirty = profileDirty || customChanged || notesDirty

  /** Every draft back to what the document holds. */
  const discard = () => {
    setProfile(leadProfileDraftFrom(lead))
    setProfileDirty(false)
    setProfileErrors({})
    setCustom({})
    setNotes(String(lead.notes ?? ''))
    setNotesDirty(false)
  }

  /*
   * The Details card's one Save: the profile and the custom values while
   * the lead is open, and the notes, in one update. A converted lead's
   * profile is the contact's now, so only its notes are written.
   */
  const saveDetails = async () => {
    const update: Record<string, unknown> = {}
    if (!converted && (profileDirty || customChanged)) {
      const { body, revenueError } = leadProfileDraftBody(profile)
      const { patch, errors } = Aglyn.normalizeCrmLeadProfile(body)
      const shown: Record<string, string> = { ...errors }
      if (revenueError) shown['annualRevenueCents'] = revenueError
      setProfileErrors(shown)
      if (Object.keys(shown).length) return
      /*
       * A required field the reader CLEARED is refused; one the lead has
       * always lacked is not this save's to demand, or a field added after
       * the lead was captured would block every later edit to its company.
       */
      const missing = crmCustomDraftMissingRequired(
        fields.active,
        storedCustom,
        custom,
        'edit',
      )
      if (missing.length) {
        enqueueSnackbar(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`, {
          variant: 'warning',
        })
        return
      }
      const profileFields = profileWrite(patch)
      // While a first or last name is set, the name is theirs (AGL-3513).
      const composed = Aglyn.crmLeadComposedName(lead, patch)
      if (composed && composed !== lead['name']) profileFields['name'] = composed
      Object.assign(
        update,
        profileFields,
        crmCustomDraftWrites(storedCustom, custom),
        // The company, title, tags and lead source are what the Leads list
        // searches and filters by (AGL-3321).
        crmClientListFields(
          'leads',
          lead,
          profileFields,
          LEAD_CLIENT_LIST_FIELDS,
          // A direction only from the org's list as the server answered it.
          leadSources.ready ? { leadSources: leadSources.picklist } : {},
        ),
      )
    }
    if (notesDirty) update['notes'] = notes.trim().slice(0, NOTES_MAX)
    if (!Object.keys(update).length) return
    setSaving(true)
    let landed = false
    const verdict = await writeGuardedBySeed(
      { subject: 'lead', fromCache, unreadable: leadStatus === 'error' },
      async () => {
        landed = await write(update, 'Lead saved')
      },
    )
    setSaving(false)
    if (!verdict.ok) {
      enqueueSnackbar(verdict.message ?? 'The lead could not be saved.', {
        variant: 'warning',
      })
      return
    }
    if (!landed) return
    setProfileDirty(false)
    setNotesDirty(false)
    // The draft is spent: what it held is stored, and the controls read
    // the document again.
    setCustom({})
  }

  const consent = Aglyn.readMarketingBasis(lead, consentGroup)
  const consentLine =
    consent.basis === 'granted'
      ? `Opted in to marketing${
          consent.basisAtMs ? ` on ${new Date(consent.basisAtMs).toLocaleDateString()}` : ''
        }`
      : consent.basis === 'declined'
        ? 'Declined marketing'
        : 'No marketing consent recorded — this lead cannot be emailed marketing'

  return (
    <>
      <CrmRecordHeader
        kind="Lead"
        title={String(lead['name'] || lead['email'] || leadId)}
        // The name is the heading; the address is the one line under it,
        // unless the address IS the name, in which case there is no second fact.
        subtitle={lead['name'] ? String(lead['email'] ?? '') : undefined}
        help={LEAD_PAGE_HELP}
        backHref={routes.section('leads')}
        backLabel="Back to leads"
        // The booking door (AGL-2660), while the lead is still the record
        // being worked: once converted, the contact is where a meeting is
        // booked from, and the links below lead there.
        booking={converted ? undefined : { hostId, org, kind: 'lead', recordId: leadId }}
        actions={
          <>
            {/*
              Once converted, the lead's actions are the records the
              conversion made.
            */}
            {converted ? (
              <>
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
              </>
            ) : erasurePending ? (
              <Tooltip title={CONVERT_PENDING_ERASURE_REASON}>
                {/* A disabled button receives no pointer events, so the
                    tooltip anchors on the span around it. */}
                <span>
                  <Button size="small" variant="contained" disabled>
                    {'Convert'}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button size="small" variant="contained" onClick={onConvert}>
                {'Convert'}
              </Button>
            )}
            {/* Dial the number the capture carried, and log the call (AGL-2661). */}
            <CrmCallButton
              hostId={hostId}
              org={org}
              link={{ leadId }}
              phone={leadPhone || leadMobile}
              doNotCall={doNotCall}
            />
            <CrmSendEmailButton
              hostId={hostId}
              leadId={leadId}
              email={String(lead['email'] ?? '')}
              name={String(lead['name'] ?? '')}
              emailState={emailState}
            />
          </>
        }
        menuItems={[
          ...(open
            ? [
                {
                  key: 'unqualify',
                  label: 'Unqualify',
                  icon: <MdiIcon path={mdiAccountCancelOutline.path} size={0.8} />,
                  destructive: true,
                  onClick: () => onUnqualify(),
                } satisfies RowActionsMenuItem,
              ]
            : []),
          ...extraMenuItems,
        ]}
        chips={
          <>
            <LeadStatusChip lead={lead} statuses={leadStatuses.picklist} />
            {/* The verdict on the address (AGL-3245), beside the status: a
                bounce does not move New or Working, but it is the first
                thing a person deciding whether to write must see. */}
            <CrmEmailStateChip state={emailState} />
            {/* The mail gateway in front of the address, and what it did
                with this site's mail this week (AGL-3328). */}
            <CrmEmailGatewayChip
              hostId={hostId}
              email={String(lead['email'] ?? '')}
              emailState={emailState}
            />
            <CrmAccountLockChip
              hostId={hostId}
              email={String(lead['email'] ?? '')}
            />
            <CrmRecordChip
              label="Owner"
              value={lead.ownerUid ? roster.labelFor(lead.ownerUid) : undefined}
            />
            {extraChips}
          </>
        }
      >
        <Stack spacing={3}>
          {banner}
          {/*
            Only when the capture carried one (AGL-2661): the sign-up door
            writes no phone, and a booking only when its service asks for
            one (AGL-3493), so a row for every lead would often be a
            permanent blank. A form that captures one fills this.
          */}
          {leadPhone ? (
            <Fact label="Phone">
              <CrmPhoneLink phone={leadPhone} doNotCall={doNotCall} />
            </Fact>
          ) : null}
          {leadMobile ? (
            <Fact label="Mobile phone">
              <CrmPhoneLink phone={leadMobile} doNotCall={doNotCall} />
            </Fact>
          ) : null}
          <Fact label="Marketing consent">{consentLine}</Fact>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {converted ? (
              <Fact label="Status">
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <LeadStatusChip lead={lead} statuses={leadStatuses.picklist} />
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
                  value={Aglyn.crmLeadStatusLabel(lead, leadStatuses.picklist)}
                  onChange={(event) => {
                    const choice = statusChoices.find((entry) => entry.label === event.target.value)
                    if (!choice) return
                    if (choice.status === 'unqualified') {
                      onUnqualify(choice.label)
                      return
                    }
                    // The meaning and the org's label for it, together
                    // (AGL-3512). Reopening drops the reason with the closed
                    // state: a lead being worked again is not "unqualified
                    // because …".
                    void write(
                      {
                        status: choice.status,
                        statusLabel: choice.label,
                        ...(status === 'unqualified' ? { unqualifiedReason: deleteField() } : {}),
                      },
                      'Status updated',
                    )
                  }}
                >
                  {leadStatusMenuItems(statusChoices)}
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
        </Stack>
      </CrmRecordHeader>
      {/*
        The profile (AGL-3231), the org's own lead fields (AGL-3272) and the
        notes: what Salesforce keeps on a lead and hands to the contact and
        the account on convert. Read-only once converted — the contact is the
        record then, and the header's links lead there — but for the notes.
      */}
      <CardDisplay
        header={'Details'}
        help={Aglyn.pluginDocsHelp('crmLeads', { anchor: '#lead-details' })}
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1}>
              {dirty ? (
                <Button size="small" disabled={saving} onClick={discard}>
                  {'Discard changes'}
                </Button>
              ) : null}
              <Button
                size="small"
                variant="contained"
                onClick={() => void saveDetails()}
                disabled={!dirty || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Stack>
          ),
        }}
      >
        <Stack spacing={2}>
          <LeadProfileFields
            draft={profile}
            onChange={editProfile}
            errors={profileErrors}
            disabled={converted}
            leadSources={leadSources.picklist}
            lists={leadPicklists.lists}
            stored={lead}
          />
          {/*
            The org's own lead fields (AGL-3272), after the built-in ones
            because they describe the same record and save with it. Absent,
            not an empty box, while the org defines none.
          */}
          {fields.active.length ? (
            <>
              <Typography variant="subtitle2">{'More fields'}</Typography>
              {fields.active.map((definition) => (
                <CrmCustomFieldControl
                  key={definition.$id}
                  definition={definition}
                  value={crmCustomDraftValue(storedCustom, custom, definition.key)}
                  onChange={(value) =>
                    setCustom((current) => ({ ...current, [definition.key]: value }))
                  }
                  disabled={converted || saving}
                />
              ))}
            </>
          ) : null}
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
        </Stack>
      </CardDisplay>
    </>
  )
}
LeadPropertiesCard.displayName = 'LeadPropertiesCard'

export default LeadPropertiesCard
