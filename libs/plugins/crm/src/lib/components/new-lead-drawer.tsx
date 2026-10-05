'use client'

import {
  CRM_LEAD_TEXT_MAX,
  type CrmCustomValue,
  type CrmLeadStatus,
  crmLeadStatusLabelFor,
  crmLeadStatusOptions,
  containerMembershipValue,
  crmLeadComposedName,
  type CrmLeadProfilePatch,
  crmPicklistDefaultLabel,
  normalizeContactEmail,
  normalizeCrmLeadProfile,
  type AglynPostalAddress,
} from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import {
  Alert,
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ContainerPicker from '@aglyn/tenant-feature-instance/components/container-picker'
import { useEffect, useState } from 'react'
import { useContactFieldDefinitions } from '../hooks/use-contact-field-definitions'
import { useCrmCampaigns } from '../hooks/use-crm-campaigns'
import { useCrmScope } from '../hooks/use-crm-scope'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import {
  EMPTY_LEAD_PROFILE_DRAFT,
  leadDraftComposedName,
  LeadProfileFields,
  type LeadProfileDraft,
  leadProfileDraftBody,
} from './lead-profile-fields'
import { CrmSitePicker } from './crm-site-picker'
import { CrmCustomFieldControl } from './crm-custom-field-control'
import {
  type CrmCustomDraft,
  crmCustomDraftDocument,
  crmCustomDraftMissingRequired,
} from '../model/crm-custom-draft'
import { LeadOwnerSelect } from './lead-owner-select'
import { useLeadSourcePicklist } from '../hooks/use-lead-source-picklist'
import { useLeadPicklists } from '../hooks/use-lead-picklists'
import { useLeadStatusPicklist } from '../hooks/use-lead-status-picklist'

/** The meanings a lead is entered in by hand: New or Working (AGL-3231). */
const NEW_LEAD_STATUSES: readonly CrmLeadStatus[] = ['new', 'working']

/** What the drawer hands back — already normalized where the route would. */
export interface NewLeadValues {
  email: string
  name: string
  company: string
  jobTitle: string
  phone: string
  website: string
  leadSource: string
  /** One of the org's New or Working values, by its label (AGL-3512). */
  status: string
  ownerUid: string
  tags: string[]
  /** The site's campaigns to file the lead under (AGL-3254), by id. */
  campaignIds: string[]
  address: AglynPostalAddress | null
  notes: string
  /**
   * The org's custom lead fields (AGL-3272), keyed by each definition's
   * `key`. Absent when the org has defined none, or none was filled — the
   * route stores a `custom` map only when there is one.
   */
  custom?: Record<string, CrmCustomValue>
  /**
   * Salesforce's standard lead fields (AGL-3513) — salutation, the name's
   * parts, mobile, fax, do not call, industry, rating, size and revenue —
   * normalized as the route stores them, only the ones that were filled.
   */
  standard: Pick<
    CrmLeadProfilePatch,
    | 'salutation'
    | 'firstName'
    | 'lastName'
    | 'mobilePhone'
    | 'fax'
    | 'doNotCall'
    | 'industry'
    | 'rating'
    | 'annualRevenueCents'
    | 'currency'
    | 'numberOfEmployees'
  >
}

export interface NewLeadDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * The site the lead is filed under — a lead is private to one site by
   * path. `null` at the organization level, where the drawer asks which
   * site with a picker and holds its submit until one is named.
   */
  hostId: string | null
  org?: Record<string, unknown> | null
  /** The request is in flight — the form holds still and the button says so. */
  busy?: boolean
  /** What the route answered when it refused, shown above the form. */
  error?: string | null
  /** The team, for the owner picker. */
  roster: OrgMemberOptions
  /**
   * The org the custom lead fields belong to (AGL-3272), as the list
   * already resolved it. `null` while it is in flight — the drawer then
   * shows the standard fields and no custom ones, which is what an org
   * with none defined shows anyway.
   */
  orgId?: string | null
  onSubmit: (values: NewLeadValues) => void
}

const NOTES_MAX = 4000

/**
 * ADDING ONE LEAD BY HAND, IN A DRAWER (AGL-3231).
 *
 * Salesforce's New Lead, on the Leads list: a person the team has heard of
 * and not yet qualified, entered with what is known — the address, the
 * name, the company as text, a title, a phone, a website, an address, tags
 * and where they came from. It makes a lead and nothing else: no contact,
 * no company record. Those are the conversion's to create once the lead is
 * real, which is what keeps one person from sitting in two lists.
 *
 * A drawer and not a form above the list, for the reason every list in this
 * console gives. The two fields a person can mistype in a way the record
 * cannot hold — the email and the phone, and the website beside them — are
 * checked before the request leaves, with the same normalizer the route
 * runs, so the refusal lands under the field. Everything else is the
 * route's to decide: whether the site already holds the address (it
 * updates that lead), whether the plan carries the suite, whether the site
 * is at the platform ceiling.
 */
export function NewLeadDrawer(props: NewLeadDrawerProps) {
  const { open, onClose, hostId, org, busy, error, roster, orgId, onSubmit } = props
  // The site the route files the lead under: the mounted site, or at the
  // organization level the picked one. `null` until it is known.
  const { createHostId } = useCrmScope({ hostId, org: org as never })

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  /*
   * THE PROFILE (AGL-3231, AGL-3513), one draft the fields edit — the
   * lead's page edits the same draft with the same fields.
   */
  const [profile, setProfile] = useState<LeadProfileDraft>(EMPTY_LEAD_PROFILE_DRAFT)
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({})
  const editProfile = <K extends keyof LeadProfileDraft>(key: K, value: LeadProfileDraft[K]) =>
    setProfile((current) => ({ ...current, [key]: value }))
  // The org's Salutation, Industry and Rating lists (AGL-3513).
  const leadPicklists = useLeadPicklists(open ? (orgId ?? null) : null)
  /*
   * THE ORG'S LEAD SOURCES (AGL-3298), and its default for a new record.
   * The default is filled in once the list has answered and only until the
   * person picks something themselves — "None" included — so a list that
   * arrives after the drawer opened does not overwrite a choice.
   */
  const leadSources = useLeadSourcePicklist(orgId ?? null)
  const [leadSourceTouched, setLeadSourceTouched] = useState(false)
  const defaultLeadSource = crmPicklistDefaultLabel(leadSources.picklist) ?? ''
  useEffect(() => {
    if (open && !leadSourceTouched) {
      setProfile((current) => ({ ...current, leadSource: defaultLeadSource }))
    }
  }, [open, leadSourceTouched, defaultLeadSource])
  // The org's New and Working values (AGL-3512); a new lead starts as New's.
  const leadStatuses = useLeadStatusPicklist(orgId ?? null)
  const statusChoices = crmLeadStatusOptions(leadStatuses.picklist, NEW_LEAD_STATUSES)
  const [status, setStatus] = useState('')
  const shownStatus = statusChoices.some((choice) => choice.label === status)
    ? status
    : crmLeadStatusLabelFor(leadStatuses.picklist, 'new')
  const [ownerUid, setOwnerUid] = useState('')
  const [campaignIds, setCampaignIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  /*
   * The org's own lead fields (AGL-3272). A CREATE holds only a draft —
   * there is no stored map to diff against — and `crmCustomDraftDocument`
   * turns it into the `custom` the route stores, or nothing.
   */
  const fields = useContactFieldDefinitions(orgId ?? null, 'lead')
  const [custom, setCustom] = useState<CrmCustomDraft>({})
  const [customError, setCustomError] = useState('')
  const [emailError, setEmailError] = useState('')
  /*
   * The campaigns, for the picker (AGL-3254): read while the drawer is
   * open. Under a site, the ones placed on it; at the organization level,
   * every campaign in the org — the lead is the org's record whichever
   * site it is captured by, so the site picked above does not narrow them.
   */
  const campaigns = useCrmCampaigns({ hostId, orgId }, { enabled: open })

  // A fresh form on every opening: a person typed and then abandoned must
  // not reappear half-filled the next time somebody reaches for New lead.
  useEffect(() => {
    if (!open) return
    setEmail('')
    setName('')
    setProfile(EMPTY_LEAD_PROFILE_DRAFT)
    setProfileErrors({})
    setLeadSourceTouched(false)
    setStatus('')
    setOwnerUid('')
    setCampaignIds([])
    setNotes('')
    setCustom({})
    setCustomError('')
    setEmailError('')
  }, [open])

  const handleSubmit = () => {
    const normalizedEmail = normalizeContactEmail(email)
    const { body, revenueError } = leadProfileDraftBody(profile)
    const { patch, errors } = normalizeCrmLeadProfile(body)
    const shown: Record<string, string> = { ...errors }
    if (revenueError) shown['annualRevenueCents'] = revenueError
    // Every required lead field counts on a create: the record is being
    // made whole, and nothing has been written to come back and fill.
    const missing = crmCustomDraftMissingRequired(fields.active, {}, custom, 'create')
    setEmailError(normalizedEmail ? '' : 'Enter a valid email address.')
    setProfileErrors(shown)
    setCustomError(
      missing.length
        ? `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`
        : '',
    )
    if (!normalizedEmail || Object.keys(shown).length || missing.length) return
    // Only what was filled: a create has nothing to clear.
    const standard: NewLeadValues['standard'] = {}
    for (const key of [
      'salutation',
      'firstName',
      'lastName',
      'mobilePhone',
      'fax',
      'doNotCall',
      'industry',
      'rating',
      'annualRevenueCents',
      'currency',
      'numberOfEmployees',
    ] as const) {
      const value = patch[key]
      if (value !== null && value !== undefined) Object.assign(standard, { [key]: value })
    }
    onSubmit({
      email: normalizedEmail,
      // While a first or last name is typed, the name is theirs (AGL-3513).
      name:
        crmLeadComposedName(null, patch) ??
        name.trim().replace(/\s+/g, ' ').slice(0, CRM_LEAD_TEXT_MAX),
      company: patch.company ?? '',
      jobTitle: patch.jobTitle ?? '',
      phone: patch.phone ?? '',
      website: patch.website ?? '',
      leadSource: patch.leadSource ?? '',
      status: shownStatus,
      ownerUid,
      tags: patch.tags ?? [],
      campaignIds: containerMembershipValue(campaignIds),
      address: patch.address ?? null,
      notes: notes.trim().slice(0, NOTES_MAX),
      custom: crmCustomDraftDocument(custom),
      standard,
    })
  }

  const composedName = leadDraftComposedName(profile)

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      sx={{ '& .MuiDrawer-paper': { width: { xs: '100%', sm: 480 } } }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {'New lead'}
          </Typography>
        </>
      }
      appBarRight={
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {'Cancel'}
        </Button>
      }
    >
      <Container gutterY>
        <Stack spacing={2}>
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {/* First, because the lead is filed under the answer. Renders nothing under a site. */}
          <CrmSitePicker
            hostId={hostId}
            disabled={Boolean(busy)}
            helperText="The site this lead is filed under — a lead is private to one site."
          />
          <TextField
            size="small"
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={Boolean(emailError)}
            helperText={
              emailError ||
              'The one field that is required — a site holds one lead per address.'
            }
            required
            fullWidth
            autoFocus
          />
          <TextField
            size="small"
            label="Name"
            value={composedName || name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{
              htmlInput: { maxLength: CRM_LEAD_TEXT_MAX },
              input: { readOnly: Boolean(composedName) },
            }}
            helperText={
              composedName ? 'Made of the first and last name.' : 'Or the whole name in one field.'
            }
            fullWidth
          />
          <LeadProfileFields
            draft={profile}
            onChange={(key, value) => {
              if (key === 'leadSource') setLeadSourceTouched(true)
              editProfile(key, value)
            }}
            errors={profileErrors}
            disabled={Boolean(busy)}
            leadSources={leadSources.picklist}
            lists={leadPicklists.lists}
            helperTexts={{
              company: 'As text — converting the lead is what makes it a company record.',
              leadSource:
                'Where this lead came from. The choices are kept under CRM › Fields › Leads.',
            }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              size="small"
              label="Status"
              value={statusChoices.some((choice) => choice.label === shownStatus) ? shownStatus : ''}
              onChange={(event) => setStatus(String(event.target.value))}
              fullWidth
            >
              {statusChoices.map((choice) => (
                <MenuItem key={choice.label} value={choice.label}>
                  {choice.label}
                </MenuItem>
              ))}
            </TextField>
            <LeadOwnerSelect
              value={ownerUid}
              onChange={setOwnerUid}
              roster={roster}
            />
          </Stack>
          {/*
            The campaigns to file the lead under (AGL-3254), picked the way a
            form's page picks them. Grouping, not consent: it decides which
            campaign pages list the lead, never whether anything mails them.
           */}
          <ContainerPicker
            kind="campaign"
            options={campaigns.options}
            value={campaignIds}
            onChange={setCampaignIds}
            helperText="The campaigns this lead is part of. It does not decide who a campaign mails."
            disabled={Boolean(busy)}
            empty={campaigns.ready && !campaigns.options.length}
            emptyText={
              hostId
                ? 'This site has no campaigns yet. Create one from Marketing to file leads under it.'
                : 'There are no campaigns yet. Create one from Marketing to file leads under it.'
            }
          />
          {/* The org's own lead fields (AGL-3272), the same controls the
              lead's page edits them with. */}
          {fields.active.length ? (
            <>
              <Typography variant="subtitle2">{'Custom fields'}</Typography>
              {customError ? <Alert severity="warning">{customError}</Alert> : null}
              {fields.active.map((definition) => (
                <CrmCustomFieldControl
                  key={definition.$id}
                  definition={definition}
                  value={custom[definition.key]}
                  onChange={(value) =>
                    setCustom((current) => ({ ...current, [definition.key]: value }))
                  }
                  disabled={Boolean(busy)}
                />
              ))}
            </>
          ) : null}
          <TextField
            size="small"
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: NOTES_MAX } }}
            fullWidth
          />
          <Button
            variant="contained"
            color="primary"
            // Held until the site is known: the route files the lead under it.
            disabled={Boolean(busy) || !createHostId}
            onClick={handleSubmit}
          >
            {busy ? 'Adding…' : 'Add lead'}
          </Button>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}

export default NewLeadDrawer
