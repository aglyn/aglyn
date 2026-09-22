'use client'

import {
  CRM_LEAD_STATUS_LABELS,
  CRM_LEAD_TEXT_MAX,
  type CrmLeadStatus,
  campaignMembershipValue,
  normalizeCrmLeadTags,
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
import CampaignPicker from '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component'
import { useHostCampaigns } from '@aglyn/tenant-feature-instance'
import { useEffect, useState } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import {
  ContactAddressFields,
  EMPTY_ADDRESS,
  type AddressDraft,
} from './contact-address-fields'
import { CrmSitePicker } from './crm-site-picker'
import { LeadOwnerSelect } from './lead-owner-select'

/** What the drawer hands back — already normalized where the route would. */
export interface NewLeadValues {
  email: string
  name: string
  company: string
  jobTitle: string
  phone: string
  website: string
  leadSource: string
  status: Extract<CrmLeadStatus, 'new' | 'working'>
  ownerUid: string
  tags: string[]
  /** The site's campaigns to file the lead under (AGL-3254), by id. */
  campaignIds: string[]
  address: AglynPostalAddress | null
  notes: string
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
  const { open, onClose, hostId, org, busy, error, roster, onSubmit } = props
  // The site the route files the lead under: the mounted site, or at the
  // organization level the picked one. `null` until it is known.
  const { createHostId } = useCrmScope({ hostId, org: org as never })

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [leadSource, setLeadSource] = useState('')
  const [status, setStatus] = useState<NewLeadValues['status']>('new')
  const [ownerUid, setOwnerUid] = useState('')
  const [tags, setTags] = useState('')
  const [campaignIds, setCampaignIds] = useState<string[]>([])
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS)
  const [notes, setNotes] = useState('')
  const [emailError, setEmailError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [websiteError, setWebsiteError] = useState('')
  /*
   * The site's campaigns, for the picker (AGL-3254): read while the drawer
   * is open, under the site the lead will be filed under — at the
   * organization level, the picked one — and re-read when that changes,
   * since a campaign belongs to one site.
   */
  const campaigns = useHostCampaigns(createHostId ?? undefined, {
    enabled: open && Boolean(createHostId),
  })

  // A fresh form on every opening: a person typed and then abandoned must
  // not reappear half-filled the next time somebody reaches for New lead.
  useEffect(() => {
    if (!open) return
    setEmail('')
    setName('')
    setCompany('')
    setJobTitle('')
    setPhone('')
    setWebsite('')
    setLeadSource('')
    setStatus('new')
    setOwnerUid('')
    setTags('')
    setCampaignIds([])
    setAddress(EMPTY_ADDRESS)
    setNotes('')
    setEmailError('')
    setPhoneError('')
    setWebsiteError('')
  }, [open])
  // A campaign picked under one site is not one of another site's.
  useEffect(() => setCampaignIds([]), [createHostId])

  const handleSubmit = () => {
    const normalizedEmail = normalizeContactEmail(email)
    const { patch, errors } = normalizeCrmLeadProfile({
      company,
      jobTitle,
      phone,
      website,
      leadSource,
      address,
      tags: normalizeCrmLeadTags(tags),
    })
    setEmailError(normalizedEmail ? '' : 'Enter a valid email address.')
    setPhoneError(errors.phone ?? '')
    setWebsiteError(errors.website ?? '')
    if (!normalizedEmail || errors.phone || errors.website) return
    onSubmit({
      email: normalizedEmail,
      name: name.trim().replace(/\s+/g, ' ').slice(0, CRM_LEAD_TEXT_MAX),
      company: patch.company ?? '',
      jobTitle: patch.jobTitle ?? '',
      phone: patch.phone ?? '',
      website: patch.website ?? '',
      leadSource: patch.leadSource ?? '',
      status,
      ownerUid,
      tags: patch.tags ?? [],
      campaignIds: campaignMembershipValue(campaignIds),
      address: patch.address ?? null,
      notes: notes.trim().slice(0, NOTES_MAX),
    })
  }

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
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: CRM_LEAD_TEXT_MAX } }}
            fullWidth
          />
          <TextField
            size="small"
            label="Company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            helperText="As text — converting the lead is what makes it a company record."
            slotProps={{ htmlInput: { maxLength: CRM_LEAD_TEXT_MAX } }}
            fullWidth
          />
          <TextField
            size="small"
            label="Job title"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            slotProps={{ htmlInput: { maxLength: CRM_LEAD_TEXT_MAX } }}
            fullWidth
          />
          <TextField
            size="small"
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={Boolean(phoneError)}
            helperText={
              phoneError || 'With the country code, like +1 512 555 0107'
            }
            fullWidth
          />
          <TextField
            size="small"
            label="Website"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            error={Boolean(websiteError)}
            helperText={websiteError || 'Like acme.com'}
            fullWidth
          />
          <TextField
            size="small"
            label="Lead source"
            value={leadSource}
            onChange={(event) => setLeadSource(event.target.value)}
            helperText="Where this lead came from — a list, an event, a referral"
            slotProps={{ htmlInput: { maxLength: CRM_LEAD_TEXT_MAX } }}
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as NewLeadValues['status'])
              }
              fullWidth
            >
              <MenuItem value="new">{CRM_LEAD_STATUS_LABELS.new}</MenuItem>
              <MenuItem value="working">
                {CRM_LEAD_STATUS_LABELS.working}
              </MenuItem>
            </TextField>
            <LeadOwnerSelect
              value={ownerUid}
              onChange={setOwnerUid}
              roster={roster}
            />
          </Stack>
          <TextField
            size="small"
            label="Tags"
            placeholder="icp2, a-list"
            helperText="Comma-separated"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            fullWidth
          />
          {/*
            The campaigns to file the lead under (AGL-3254), picked the way a
            form's page picks them. Grouping, not consent: it decides which
            campaign pages list the lead, never whether anything mails them.
           */}
          {createHostId ? (
            <CampaignPicker
              options={campaigns.options}
              value={campaignIds}
              onChange={setCampaignIds}
              helperText="The campaigns this lead is part of. It does not decide who a campaign mails."
              disabled={Boolean(busy)}
              empty={campaigns.ready && !campaigns.options.length}
              emptyText="This site has no campaigns yet. Create one from Marketing to file leads under it."
            />
          ) : null}
          <Typography variant="subtitle2">{'Address'}</Typography>
          <ContactAddressFields value={address} onChange={setAddress} />
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
