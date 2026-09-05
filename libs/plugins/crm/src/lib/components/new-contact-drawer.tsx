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

import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  consentGroupDisclosure,
  type AglynPostalAddress,
  type ConsentGroup,
  type ContactLifecycleStage,
  normalizeAddress,
  normalizeContactEmail,
  normalizePhone,
} from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { parseContactTags } from '../model/contact-record'
import {
  ContactAddressFields,
  EMPTY_ADDRESS,
  type AddressDraft,
} from './contact-address-fields'
import type { OrgMemberOption } from './use-org-members'

/** What the drawer hands back — already normalized where the route would. */
export interface NewContactValues {
  email: string
  name: string
  phone: string
  jobTitle: string
  companyName: string
  ownerUid: string
  lifecycleStage: ContactLifecycleStage | ''
  tags: string[]
  address: AglynPostalAddress | null
  marketingConsent: boolean
}

export interface NewContactDrawerProps {
  open: boolean
  onClose: () => void
  /** The request is in flight — the form holds still and the button says so. */
  busy?: boolean
  /** What the route answered when it refused, shown above the form. */
  error?: string | null
  /** The controller the consent checkbox records a basis FOR. */
  consentGroup: ConsentGroup
  /** The team, for the owner picker. */
  owners: OrgMemberOption[]
  /** The roster has answered — an empty list is then "nobody to pick". */
  ownersReady: boolean
  onSubmit: (values: NewContactValues) => void
}

/**
 * ADDING ONE PERSON BY HAND, IN A DRAWER (AGL-2596).
 *
 * A drawer and not a form above the list: a create form sitting on top of a
 * table is the shape every list in this console was built to stop. The
 * button in the list's header opens this, and the list is exactly as it was
 * behind it.
 *
 * ## What is checked here and what is not
 *
 * The two fields a person can mistype in a way the record cannot hold — the
 * email and the phone number — are checked before the request leaves, with
 * the same normalizers the route runs, so the refusal lands under the field
 * rather than as a sentence from the server. Everything else is the route's
 * to decide: whether the address already belongs to somebody (it merges),
 * whether the plan's band has room (it refuses, and its sentence is shown
 * above the form unchanged).
 *
 * ## The consent box is a claim, and says so
 *
 * The forms plugin's rule for the opt-in field is that submitting a form is
 * never itself consent. Typing somebody into the CRM is not either — so the
 * checkbox is worded as the person's act, not the operator's, and the helper
 * carries the group disclosure the form would have shown them.
 */
export function NewContactDrawer(props: NewContactDrawerProps) {
  const {
    open,
    onClose,
    busy,
    error,
    consentGroup,
    owners,
    ownersReady,
    onSubmit,
  } = props

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [ownerUid, setOwnerUid] = useState('')
  const [lifecycleStage, setLifecycleStage] = useState<
    ContactLifecycleStage | ''
  >('')
  const [tags, setTags] = useState('')
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [phoneError, setPhoneError] = useState('')

  /*
   * A fresh form on every opening. The drawer stays mounted behind the list
   * between uses, and a person typed and then abandoned must not reappear
   * half-filled the next time somebody reaches for "New contact".
   */
  useEffect(() => {
    if (!open) return
    setEmail('')
    setName('')
    setPhone('')
    setJobTitle('')
    setCompanyName('')
    setOwnerUid('')
    setLifecycleStage('')
    setTags('')
    setAddress(EMPTY_ADDRESS)
    setMarketingConsent(false)
    setEmailError('')
    setPhoneError('')
  }, [open])

  const handleSubmit = () => {
    const normalizedEmail = normalizeContactEmail(email)
    const trimmedPhone = phone.trim()
    const normalizedPhone = trimmedPhone ? normalizePhone(trimmedPhone) : ''
    setEmailError(normalizedEmail ? '' : 'Enter a valid email address.')
    setPhoneError(
      trimmedPhone && !normalizedPhone
        ? 'Enter it with its country code, like +1 512 555 0107.'
        : '',
    )
    if (!normalizedEmail || (trimmedPhone && !normalizedPhone)) return
    onSubmit({
      email: normalizedEmail,
      name: name.trim().slice(0, 120),
      phone: normalizedPhone ?? '',
      jobTitle: jobTitle.trim().slice(0, 120),
      companyName: companyName.trim().slice(0, 120),
      ownerUid,
      lifecycleStage,
      tags: parseContactTags(tags),
      address: normalizeAddress(address),
      marketingConsent,
    })
  }

  const disclosure = consentGroupDisclosure(consentGroup)

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
            {'New contact'}
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
          <TextField
            size="small"
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={Boolean(emailError)}
            helperText={
              emailError ||
              'The one field that is required — it is what makes two captures one person.'
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
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
          <TextField
            size="small"
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={Boolean(phoneError)}
            helperText={phoneError || 'With the country code, like +1 512 555 0107'}
            fullWidth
          />
          <TextField
            size="small"
            label="Job title"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
          <TextField
            size="small"
            label="Company"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
          <TextField
            select
            size="small"
            label="Lifecycle stage"
            value={lifecycleStage}
            onChange={(event) =>
              setLifecycleStage(event.target.value as ContactLifecycleStage | '')
            }
            fullWidth
          >
            <MenuItem value="">{'Not placed yet'}</MenuItem>
            {CONTACT_LIFECYCLE_STAGES.map((stage) => (
              <MenuItem key={stage} value={stage}>
                {CONTACT_LIFECYCLE_STAGE_LABELS[stage]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Owner"
            value={ownerUid}
            onChange={(event) => setOwnerUid(event.target.value)}
            helperText={
              ownersReady && !owners.length
                ? 'The team roster could not be read, so nobody can be picked yet.'
                : 'The team member responsible for this relationship'
            }
            fullWidth
          >
            <MenuItem value="">{'Unassigned'}</MenuItem>
            {owners.map((owner) => (
              <MenuItem key={owner.uid} value={owner.uid}>
                {owner.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Tags"
            placeholder="vip, beta"
            helperText="Comma-separated"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            fullWidth
          />
          <Typography variant="subtitle2">{'Address'}</Typography>
          <ContactAddressFields value={address} onChange={setAddress} />
          <Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={marketingConsent}
                  onChange={(event) => setMarketingConsent(event.target.checked)}
                />
              }
              label="This person opted in to marketing email"
            />
            <FormHelperText>
              {(disclosure ? `${disclosure} ` : '') +
                'Tick it only if they agreed. Adding a contact is never itself consent.'}
            </FormHelperText>
          </Stack>
          <Button
            variant="contained"
            color="primary"
            disabled={Boolean(busy)}
            onClick={handleSubmit}
          >
            {busy ? 'Adding…' : 'Add contact'}
          </Button>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}

export default NewContactDrawer
