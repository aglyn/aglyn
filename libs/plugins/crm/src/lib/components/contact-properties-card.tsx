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
import {
  type AglynOrgBilling,
  composeContactName,
  CONTACT_BIRTHDATE_REFUSAL,
  CONTACT_EXTRA_PHONE_FIELDS,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_NAME_PART_MAX,
  CONTACT_PHONE_FIELD_LABELS,
  type ConsentGroup,
  type ContactLifecycleStage,
  CRM_SALUTATION_PICKLIST,
  crmTelHref,
  normalizeContactBirthdate,
  normalizePhone,
} from '@aglyn/aglyn'
import { mdiPhoneOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useContactFieldDefinitions } from '../hooks/use-contact-field-definitions'
import { useContactUpdate } from '../hooks/use-contact-update'
import { useCrmActivityLogger } from '../hooks/use-crm-activity-logger'
import { useCrmPicklist } from '../hooks/use-crm-picklist'
import { useLeadSourcePicklist } from '../hooks/use-lead-source-picklist'
import { type ContactRecord, parseContactTags } from '../model/contact-record'
import type { ContactUpdateFields } from '../model/contact-update'
import { setContactStage } from '../model/crm-api'
import {
  type CrmCustomDraft,
  crmCustomDraftChanges,
  crmCustomDraftMissingRequired,
  crmCustomDraftValue,
} from '../model/crm-custom-draft'
import {
  CompanyPicker,
  useCompanyOptions,
  useCreateCompany,
} from './company-picker'
import {
  addressDraftFrom,
  ContactAddressFields,
  type AddressDraft,
} from './contact-address-fields'
import { ContactReportsToField } from './contact-reports-to-field'
import { CrmCustomFieldControl } from './crm-custom-field-control'
import { CrmPicklistSelect } from './picklist-select'
import { crmSuiteLockedReason } from './crm-suite-lock'
import { LeadSourceSelect } from './lead-source-select'
import type { OrgMembers } from './use-org-members'

export interface ContactPropertiesCardProps {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  /** The org document the shell passed, for the company picker's scope. */
  org?: Partial<AglynOrgBilling> | null
  /** The row, flattened through the viewing group's facet. */
  record: ContactRecord
  /**
   * The org the record belongs to, as the page resolved it — for the org's
   * lead source values (AGL-3298) and its custom contact fields (AGL-2601).
   * Null while it settles, when the select offers the starter list, no
   * custom field is drawn yet, and the save still sends only what changed.
   */
  orgId?: string | null
  /** The controller whose facet the edits are saved into. */
  consentGroup: ConsentGroup
  /**
   * The listener's verdict on the row the drafts were seeded from, for the
   * guard that refuses a save over an unconfirmed read.
   */
  seed: { status: 'loading' | 'success' | 'error'; fromCache: boolean }
  /** The team, for the owner picker and the owner's name. */
  members: OrgMembers
  /**
   * The org's plan lacks the CRM (AGL-2788), which the shell mounts no CRM
   * page for (AGL-2851). The owner, the lifecycle stage and the company
   * show, locked, and are left out of a save; `crm/contact-update` refuses
   * such a plan the rest of the profile, the tags and the notes too. The
   * custom fields are the CRM's as well, and are not drawn.
   */
  suiteLocked?: boolean
}

/**
 * THE RECORD ITSELF: every field a team keeps on a person, in one card with
 * one Save in its header (AGL-2596).
 *
 * ## Custom fields sit with the built-in ones
 *
 * The org's own contact fields (AGL-2601) are drawn under **More fields**,
 * after the built-in properties, the way Salesforce keeps custom fields in
 * the record's Details beside the standard ones — and they save with them.
 * An org with no active field draws no subsection at all.
 *
 * A custom value is THIS holder's (`facets.{group}.custom.{key}`), so the
 * draft holds only the keys the reader touched and the save sends only the
 * keys that changed: the route writes each at its own dotted path, and a
 * `custom` map sent whole would take every key this card did not touch out
 * with it. A cleared control sends `null`, the explicit "cleared" the model
 * keeps the key present with, and a required field left empty is refused
 * before anything is sent.
 *
 * ## One save, one request, one guard
 *
 * A field-at-a-time save would be nine requests and nine chances for the
 * stale-seed guard to refuse one of them — so the card holds a draft of the
 * whole profile and sends it once. The guard WRAPS the send: a row seeded
 * from the cache or from a failed read is refused with the message the guard
 * chooses, and what was typed stays in the fields, because a refusal that
 * also emptied the form would read as a save that worked.
 *
 * ## The server writes the facet (AGL-2804)
 *
 * Every field here lives in THIS holder's facet, and the Firestore rules
 * cannot tell one field of a facet from another, so the card writes nothing
 * itself. The draft goes to `crm/contact-update`, which writes each field by
 * dotted path into the holder's facet — never a nested object, which would
 * take every other holder's records with it — clears a blank field rather
 * than storing it empty, keeps the phone's and the company's search echoes
 * at the top of the document, and refuses every field to a plan without
 * the CRM. A refusal is shown in the route's own words.
 *
 * ## The stage goes to its own route
 *
 * The lifecycle stage is the one field an automation listens for:
 * `contactStageChanged` (AGL-2605) is emitted by `crm/contact-stage` after it
 * performs the write, and by nothing else. So when the stage the reader
 * picked differs from the one the record holds, it is sent to that route
 * once the rest of the profile has landed — the stage picked, or `null` for
 * "Not placed yet", which clears it and announces nothing. A refusal from
 * that route is reported on its own, with its sentence, after the fields that
 * did save.
 *
 * ## The name is an override
 *
 * The canonical name is shared by every site holding the person, so this
 * card never edits it. What it saves is this holder's own name for them,
 * and the helper says what a blank falls back to, so nobody clears the
 * field expecting the record to go nameless.
 *
 * ## Salesforce's sections (AGL-3515)
 *
 * The fields are grouped the way Salesforce's contact Details groups them —
 * Contact information, Phones, Addresses, Additional information — and every
 * one is still one draft and one Save. While the holder keeps a first or
 * last name the Name field shows their composition and is read-only; the
 * save sends the parts, and the route composes the name from them. The
 * salutation and the reports-to are sent only when they change, for the
 * lead source's reason: the route judges a sent one. Do not call is a hint
 * on every phone's call link, never a block.
 *
 * ## Company is a record, with its name kept beside it
 *
 * The Company field is the picker (AGL-2613): the link is `companyId` in
 * this holder's facet, mirrored into the top-level `companyIds` for the
 * company page's query, and the company's contacts count moves with it —
 * all planned by the route from the stored document, so this card never
 * reasons about another holder's link. The name is sent too, from the picked
 * company, because the list column and the global search read the name and
 * not the id; a record that carries a name with no link — an import, a save
 * from before the picker — keeps it as the label, and the picker offers it
 * as the company to link or create.
 */
/** The phone fields the card edits, in the order the Phones section lists them. */
const PHONE_FIELDS = ['phone', ...CONTACT_EXTRA_PHONE_FIELDS] as const
type PhoneField = (typeof PHONE_FIELDS)[number]
type PhoneDrafts = Record<PhoneField, string>

const phoneDraftsFrom = (record: ContactRecord): PhoneDrafts =>
  Object.fromEntries(
    PHONE_FIELDS.map((field) => [field, String(record[field] ?? '')]),
  ) as PhoneDrafts

/** The phones as the route stores them, or the fields that cannot be read as numbers. */
function readPhones(
  drafts: PhoneDrafts,
): { ok: true; phones: PhoneDrafts } | { ok: false; errors: Partial<PhoneDrafts> } {
  const phones = {} as PhoneDrafts
  const errors: Partial<PhoneDrafts> = {}
  for (const field of PHONE_FIELDS) {
    const typed = drafts[field].trim()
    const normalized = typed ? normalizePhone(typed) : ''
    if (normalized === null) errors[field] = PHONE_HELP_ERROR
    else phones[field] = normalized
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, phones }
}

const PHONE_HELP = 'With the country code, like +1 512 555 0107'
const PHONE_HELP_ERROR = 'Enter it with its country code, like +1 512 555 0107.'

/** A section heading inside the card — Salesforce's Details groups its fields the same way. */
function SectionHeading(props: { children: string }) {
  return (
    <Grid size={{ xs: 12 }}>
      <Typography variant="subtitle2" color="text.secondary">
        {props.children}
      </Typography>
    </Grid>
  )
}

export function ContactPropertiesCard(props: ContactPropertiesCardProps) {
  const {
    hostId,
    org,
    record,
    orgId = null,
    consentGroup,
    seed,
    members,
    suiteLocked = false,
  } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const contactUpdate = useContactUpdate(hostId)
  // The site a stage move is routed through: the mounted one, or at the
  // organization level the holder's own (AGL-2630).
  const siteHostId = hostId ?? (consentGroup.hostId || null)
  /*
   * The feed the act is logged in, decided by the level it was performed
   * at (AGL-2738) and so given the MOUNTED site rather than `siteHostId`:
   * at the org hub a client-direct append to the holder's own site would
   * face a gate the record write never had to pass.
   */
  const logActivity = useCrmActivityLogger(hostId)
  const companies = useCompanyOptions({ hostId, org })
  const createCompany = useCreateCompany({ hostId, org })

  const [nameOverride, setNameOverride] = useState(record.nameOverride)
  const [salutation, setSalutation] = useState(record.salutation ?? '')
  const salutations = useCrmPicklist(CRM_SALUTATION_PICKLIST, orgId)
  const [firstName, setFirstName] = useState(record.firstName ?? '')
  const [lastName, setLastName] = useState(record.lastName ?? '')
  const [phones, setPhones] = useState<PhoneDrafts>(() => phoneDraftsFrom(record))
  const [doNotCall, setDoNotCall] = useState(record.doNotCall === true)
  const [jobTitle, setJobTitle] = useState(record.jobTitle)
  const [department, setDepartment] = useState(record.department ?? '')
  const [birthdate, setBirthdate] = useState(record.birthdate ?? '')
  const [assistantName, setAssistantName] = useState(record.assistantName ?? '')
  const [reportsTo, setReportsTo] = useState(record.reportsToContactId ?? '')
  // Salesforce's Lead Source (AGL-3298), carried from the lead on conversion.
  const [leadSource, setLeadSource] = useState(record.leadSource)
  const leadSources = useLeadSourcePicklist(orgId)
  const [companyName, setCompanyName] = useState(record.companyName)
  const [companyId, setCompanyId] = useState<string | null>(
    record.companyId || null,
  )
  const [ownerUid, setOwnerUid] = useState(record.ownerUid)
  const [lifecycleStage, setLifecycleStage] = useState<ContactLifecycleStage | ''>(
    record.lifecycleStage,
  )
  const [tags, setTags] = useState(record.tags.join(', '))
  const [notes, setNotes] = useState(record.notes)
  const [address, setAddress] = useState<AddressDraft>(
    addressDraftFrom(record.address),
  )
  const [otherAddress, setOtherAddress] = useState<AddressDraft>(
    addressDraftFrom(record.otherAddress),
  )
  const [phoneErrors, setPhoneErrors] = useState<Partial<PhoneDrafts>>({})
  const [birthdateError, setBirthdateError] = useState('')
  const [saving, setSaving] = useState(false)
  /** The custom values the reader touched; every other key reads from the record. */
  const [custom, setCustom] = useState<CrmCustomDraft>({})
  /** Something was edited since the card was seeded or last saved. */
  const [edited, setEdited] = useState(false)
  const fields = useContactFieldDefinitions(suiteLocked ? null : orgId)
  // The custom fields are the CRM's; a plan without it draws and sends none.
  const customFields = suiteLocked ? [] : fields.active
  const storedCustom = useMemo(() => record.custom ?? {}, [record.custom])
  const customChanges = useMemo(
    () => crmCustomDraftChanges(storedCustom, custom),
    [storedCustom, custom],
  )
  const clearingRequired =
    crmCustomDraftMissingRequired(customFields, storedCustom, custom, 'edit').length > 0
  /*
   * The name the first and last names make (AGL-3515). While there is one,
   * it IS the name — the Name field shows it, read-only, and the save sends
   * the parts rather than a name the route would have to reconcile.
   */
  const composedName = composeContactName(firstName, lastName)

  /** One field's edit: the value, and the card now has something to save. */
  const change = useCallback(<T,>(set: (value: T) => void, value: T) => {
    set(value)
    setEdited(true)
  }, [])

  /** Every draft back to what the record holds — the seed, and Discard. */
  const reseed = () => {
    setNameOverride(record.nameOverride)
    setSalutation(record.salutation ?? '')
    setFirstName(record.firstName ?? '')
    setLastName(record.lastName ?? '')
    setPhones(phoneDraftsFrom(record))
    setDoNotCall(record.doNotCall === true)
    setJobTitle(record.jobTitle)
    setDepartment(record.department ?? '')
    setBirthdate(record.birthdate ?? '')
    setAssistantName(record.assistantName ?? '')
    setReportsTo(record.reportsToContactId ?? '')
    setLeadSource(record.leadSource)
    setCompanyName(record.companyName)
    setCompanyId(record.companyId || null)
    setOwnerUid(record.ownerUid)
    setLifecycleStage(record.lifecycleStage)
    setTags(record.tags.join(', '))
    setNotes(record.notes)
    setAddress(addressDraftFrom(record.address))
    setOtherAddress(addressDraftFrom(record.otherAddress))
    setPhoneErrors({})
    setBirthdateError('')
    setCustom({})
    setEdited(false)
  }

  /*
   * Re-seeded when the RECORD changes, not when it re-renders. The listener
   * delivers a fresh row on every snapshot, including the one this card's
   * own save produces; re-seeding on each would overwrite what somebody is
   * in the middle of typing with what the server last confirmed.
   */
  const recordId = record.$id
  useEffect(() => {
    reseed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId])

  const handleSave = useCallback(async () => {
    if (clearingRequired) return
    const readPhonesResult = readPhones(phones)
    const storedBirthdate = normalizeContactBirthdate(birthdate)
    setPhoneErrors('errors' in readPhonesResult ? readPhonesResult.errors : {})
    setBirthdateError(storedBirthdate === null ? CONTACT_BIRTHDATE_REFUSAL : '')
    if ('errors' in readPhonesResult || storedBirthdate === null) return
    // A stage that differs from the record's is the stage route's to write —
    // see the note above.
    const stageChanged = !suiteLocked && lifecycleStage !== record.lifecycleStage
    const set: ContactUpdateFields = {
      // The name is the parts' while there are parts — see the note above.
      ...(composedName ? {} : { name: nameOverride.trim().slice(0, 120) }),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      ...readPhonesResult.phones,
      // Sent only when it moves: the route stores the flag as a fact about
      // the person, and an untouched card should not re-assert it.
      ...(doNotCall !== (record.doNotCall === true) ? { doNotCall } : {}),
      jobTitle: jobTitle.trim().slice(0, 120),
      department: department.trim().slice(0, 120),
      birthdate: storedBirthdate,
      assistantName: assistantName.trim().slice(0, 120),
      // Sent only when changed: the route judges a sent value against the
      // org's list, and an untouched one needs no judging. The reports-to
      // likewise, because the route checks a sent one for a loop.
      ...(leadSource !== record.leadSource ? { leadSource } : {}),
      ...(salutation !== (record.salutation ?? '') ? { salutation } : {}),
      ...(reportsTo !== (record.reportsToContactId ?? '')
        ? { reportsToContactId: reportsTo || null }
        : {}),
      address,
      otherAddress,
      tags: parseContactTags(tags),
      notes: notes.slice(0, 2000),
      // The owner and the company, sent only on a plan that carries the CRM.
      ...(suiteLocked
        ? {}
        : { ownerUid, companyId, companyName: companyName.trim().slice(0, 120) }),
      // Only the custom keys that changed — see the note above.
      ...(!suiteLocked && customChanges.length
        ? { custom: Object.fromEntries(customChanges) }
        : {}),
    }
    setSaving(true)
    try {
      const verdict = await writeGuardedBySeed(
        {
          subject: 'contact',
          unreadable: seed.status === 'error',
          fromCache: seed.fromCache,
        },
        () => contactUpdate.updateOne(record.$id, set),
      )
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
      logActivity('Updated contact', {
        type: 'contact',
        id: record.$id,
        name: record.name || record.email,
      })
      // The custom values are stored; the controls read the record again.
      setCustom({})
      if (stageChanged && siteHostId) {
        try {
          await setContactStage(user, siteHostId, record.$id, lifecycleStage || null)
        } catch (error) {
          // The rest of the profile is saved; only the stage was refused, and
          // the route's own sentence says why.
          return void enqueueSnackbar(
            `Saved, but the stage could not be changed: ${
              error instanceof Error ? error.message : 'the request failed'
            }`,
            { variant: 'warning', persist: false },
          )
        }
      }
      setEdited(false)
      enqueueSnackbar('Contact saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar(
        error instanceof Error && error.message ? error.message : 'An error has occurred',
        { variant: 'error', allowDuplicate: true },
      )
    } finally {
      setSaving(false)
    }
  }, [
    address,
    assistantName,
    birthdate,
    clearingRequired,
    companyId,
    companyName,
    composedName,
    contactUpdate,
    customChanges,
    department,
    doNotCall,
    enqueueSnackbar,
    firstName,
    siteHostId,
    jobTitle,
    lastName,
    leadSource,
    lifecycleStage,
    logActivity,
    nameOverride,
    notes,
    otherAddress,
    ownerUid,
    phones,
    record.$id,
    record.doNotCall,
    record.email,
    record.leadSource,
    record.lifecycleStage,
    record.name,
    record.reportsToContactId,
    record.salutation,
    reportsTo,
    salutation,
    seed.fromCache,
    seed.status,
    suiteLocked,
    tags,
    user,
  ])

  /*
   * An owner the roster no longer lists — somebody who left the team — is
   * still offered as the current value, named by their uid, so the select is
   * never handed a value it has no option for and the reader can see who it
   * was before reassigning.
   */
  const ownerKnown = members.options.some((option) => option.uid === ownerUid)

  /** One phone field, with click-to-call off what is IN the box (AGL-2661). */
  const phoneField = (field: PhoneField) => {
    const value = phones[field]
    const telHref = crmTelHref(value)
    const callLabel = doNotCall
      ? `Call ${value.trim()} — marked do not call`
      : `Call ${value.trim()}`
    return (
      <Grid key={field} size={{ xs: 12, sm: 6 }}>
        <TextField
          size="small"
          label={CONTACT_PHONE_FIELD_LABELS[field]}
          value={value}
          onChange={(event) => change(setPhones, { ...phones, [field]: event.target.value })}
          error={Boolean(phoneErrors[field])}
          helperText={phoneErrors[field] || (field === 'phone' ? PHONE_HELP : undefined)}
          fullWidth
          slotProps={{
            input: {
              /*
               * The number on screen is the one a reader means to ring, and
               * `crmTelHref` withholds the link from anything half-typed. A
               * do-not-call person keeps the link — the rep decides — with
               * the request said in the tooltip and the icon's color.
               */
              endAdornment:
                telHref && field !== 'fax' ? (
                  <InputAdornment position="end">
                    <Tooltip title={callLabel}>
                      <IconButton
                        component="a"
                        href={telHref}
                        size="small"
                        edge="end"
                        color={doNotCall ? 'warning' : 'default'}
                        aria-label={callLabel}
                      >
                        <MdiIcon path={mdiPhoneOutline.path} size={0.8} />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : null,
            },
          }}
        />
      </Grid>
    )
  }

  return (
    <CardDisplay
      header={'Properties'}
      help={Aglyn.pluginDocsHelp('contactRecord', { anchor: '#contact-properties' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            {edited ? (
              <Button size="small" disabled={saving} onClick={reseed}>
                {'Discard changes'}
              </Button>
            ) : null}
            <Button
              variant="contained"
              color="primary"
              size="small"
              disabled={saving || !edited || clearingRequired}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        ),
      }}
    >
      <Grid container spacing={2}>
        <SectionHeading>{'Contact information'}</SectionHeading>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Email"
            value={record.email}
            slotProps={{ input: { readOnly: true } }}
            helperText="The identity every site shares — it cannot be edited here."
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <CrmPicklistSelect
            picklistId={CRM_SALUTATION_PICKLIST}
            picklist={salutations.picklist}
            value={salutation}
            stored={record.salutation ?? ''}
            onChange={(value) => change(setSalutation, value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="First name"
            value={firstName}
            onChange={(event) => change(setFirstName, event.target.value)}
            slotProps={{ htmlInput: { maxLength: CONTACT_NAME_PART_MAX } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Last name"
            value={lastName}
            onChange={(event) => change(setLastName, event.target.value)}
            slotProps={{ htmlInput: { maxLength: CONTACT_NAME_PART_MAX } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Name"
            value={composedName || nameOverride}
            onChange={(event) => change(setNameOverride, event.target.value)}
            slotProps={{
              htmlInput: { maxLength: 120 },
              input: { readOnly: Boolean(composedName) },
            }}
            helperText={
              composedName
                ? 'Made of the first and last name.'
                : record.canonicalName
                  ? `Your own name for this person. Blank shows the name they gave: ${record.canonicalName}.`
                  : 'Your own name for this person.'
            }
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Job title"
            value={jobTitle}
            onChange={(event) => change(setJobTitle, event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Department"
            value={department}
            onChange={(event) => change(setDepartment, event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <CompanyPicker
            options={companies.options}
            ready={companies.ready}
            truncated={companies.truncated}
            value={companyId}
            onChange={(id, company) => {
              change(setCompanyId, id)
              // The label follows the link: the picked name, or nothing
              // once the link is cleared. A company the list cannot name
              // keeps whatever label the record already had.
              setCompanyName(company ? company.name : id ? companyName : '')
            }}
            onCreate={createCompany}
            email={record.email}
            fallbackName={companyName}
            disabled={saving || suiteLocked}
            helperText={suiteLocked ? crmSuiteLockedReason() : undefined}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <LeadSourceSelect
            picklist={leadSources.picklist}
            value={leadSource}
            stored={record.leadSource}
            onChange={(value) => change(setLeadSource, value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            size="small"
            label="Lifecycle stage"
            value={lifecycleStage}
            onChange={(event) =>
              change(setLifecycleStage, event.target.value as ContactLifecycleStage | '')
            }
            disabled={suiteLocked}
            helperText={suiteLocked ? crmSuiteLockedReason() : undefined}
            fullWidth
          >
            <MenuItem value="">{'Not placed yet'}</MenuItem>
            {CONTACT_LIFECYCLE_STAGES.map((stage) => (
              <MenuItem key={stage} value={stage}>
                {CONTACT_LIFECYCLE_STAGE_LABELS[stage]}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            size="small"
            label="Owner"
            value={ownerUid}
            onChange={(event) => change(setOwnerUid, event.target.value)}
            disabled={suiteLocked}
            helperText={
              suiteLocked
                ? crmSuiteLockedReason()
                : members.ready && !members.options.length
                  ? 'The team roster could not be read, so nobody can be picked yet.'
                  : 'The team member responsible for this relationship'
            }
            fullWidth
          >
            <MenuItem value="">{'Unassigned'}</MenuItem>
            {ownerUid && !ownerKnown ? (
              <MenuItem value={ownerUid}>{members.memberName(ownerUid)}</MenuItem>
            ) : null}
            {members.options.map((owner) => (
              <MenuItem key={owner.uid} value={owner.uid}>
                {Aglyn.crmMemberPickerLabel(owner)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Tags"
            placeholder="vip, beta"
            helperText="Comma-separated"
            value={tags}
            onChange={(event) => change(setTags, event.target.value)}
            fullWidth
          />
        </Grid>

        <SectionHeading>{'Phones'}</SectionHeading>
        {PHONE_FIELDS.filter((field) => field !== 'assistantPhone').map(phoneField)}
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={doNotCall}
                onChange={(event) => change(setDoNotCall, event.target.checked)}
              />
            }
            label="Do not call"
          />
          <FormHelperText>
            {'They asked not to be phoned. Every number still dials; the Call button says so.'}
          </FormHelperText>
        </Grid>

        <SectionHeading>{'Addresses'}</SectionHeading>
        <Grid size={{ xs: 12 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Mailing address'}</Typography>
            <ContactAddressFields
              value={address}
              onChange={(value) => change(setAddress, value)}
            />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Other address'}</Typography>
            <ContactAddressFields
              value={otherAddress}
              onChange={(value) => change(setOtherAddress, value)}
            />
          </Stack>
        </Grid>

        <SectionHeading>{'Additional information'}</SectionHeading>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            type="date"
            label="Birthdate"
            value={birthdate}
            onChange={(event) => change(setBirthdate, event.target.value)}
            error={Boolean(birthdateError)}
            helperText={birthdateError || undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <ContactReportsToField
            hostId={hostId}
            org={org}
            contactId={record.$id}
            groupId={consentGroup.groupId}
            value={reportsTo}
            onChange={(value) => change(setReportsTo, value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Assistant"
            value={assistantName}
            onChange={(event) => change(setAssistantName, event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
        </Grid>
        {phoneField('assistantPhone')}
        <Grid size={{ xs: 12 }}>
          <TextField
            size="small"
            label="About"
            value={notes}
            onChange={(event) => change(setNotes, event.target.value)}
            helperText="Notes for your team. Nobody outside this site's group can read them."
            multiline
            minRows={3}
            fullWidth
          />
        </Grid>
        {/*
          The org's own fields (AGL-2601), after the built-in ones and saved
          with them. Absent, not an empty box, while the org defines none.
        */}
        {customFields.length ? (
          <>
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2">{'More fields'}</Typography>
            </Grid>
            {customFields.map((definition) => (
              <Grid key={definition.$id} size={{ xs: 12, sm: 6 }}>
                <CrmCustomFieldControl
                  definition={definition}
                  value={crmCustomDraftValue(storedCustom, custom, definition.key)}
                  onChange={(value) =>
                    change(setCustom, { ...custom, [definition.key]: value })
                  }
                  disabled={saving}
                />
              </Grid>
            ))}
            {clearingRequired ? (
              <Grid size={{ xs: 12 }}>
                <Typography variant="caption" color="error">
                  {'A required field cannot be left empty.'}
                </Typography>
              </Grid>
            ) : null}
          </>
        ) : null}
      </Grid>
    </CardDisplay>
  )
}
ContactPropertiesCard.displayName = 'ContactPropertiesCard'

export default ContactPropertiesCard
