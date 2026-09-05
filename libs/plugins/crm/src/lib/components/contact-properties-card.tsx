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
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  type ConsentGroup,
  type ContactLifecycleStage,
  normalizeAddress,
  normalizePhone,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useHostActivityLogger,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { Button, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { type ContactRecord, parseContactTags } from '../model/contact-record'
import {
  addressDraftFrom,
  ContactAddressFields,
  type AddressDraft,
} from './contact-address-fields'
import type { OrgMembers } from './use-org-members'

export interface ContactPropertiesCardProps {
  hostId: string
  /** The row, flattened through the viewing group's facet. */
  record: ContactRecord
  /** The controller whose facet the edits are written into. */
  consentGroup: ConsentGroup
  /** `['orgs', orgId]` — where the contact document lives. */
  scope: readonly [string, string]
  /**
   * The listener's verdict on the row the drafts were seeded from, for the
   * guard that refuses a save over an unconfirmed read.
   */
  seed: { status: 'loading' | 'success' | 'error'; fromCache: boolean }
  /** The team, for the owner picker and the owner's name. */
  members: OrgMembers
}

/**
 * THE RECORD ITSELF: every field a team keeps on a person, in one card with
 * one Save (AGL-2596).
 *
 * ## One save, one write, one guard
 *
 * A field-at-a-time save would be nine writes and nine chances for the
 * stale-seed guard to refuse one of them — so the card holds a draft of the
 * whole profile and writes it once. The guard WRAPS the write: a row seeded
 * from the cache or from a failed read is refused with the message the
 * guard chooses, and what was typed stays in the fields, because a refusal
 * that also emptied the form would read as a save that worked.
 *
 * ## Everything lands in THIS holder's facet
 *
 * Dotted paths, on an `updateDoc`, one per field. A nested `facets` object
 * here would REPLACE the map and take every other holder's notes, tags and
 * order history with it. A cleared field is `deleteField()` rather than an
 * empty string, so "no phone number" has one shape on the document however
 * it got there. The two exceptions are the search echoes — the phone and
 * the company name are ALSO written to the top of the document, where a
 * query can hit them; see `HostContact.phone`.
 *
 * ## The name is an override
 *
 * The canonical name is shared by every site holding the person, so this
 * card never edits it. What it writes is this holder's own name for them,
 * and the helper says what a blank falls back to, so nobody clears the
 * field expecting the record to go nameless.
 *
 * ## Company is a name, for now
 *
 * Free text until the companies section supplies a picker that sets
 * `companyId` as well; the name is what the row displays either way.
 */
export function ContactPropertiesCard(props: ContactPropertiesCardProps) {
  const { hostId, record, consentGroup, scope, seed, members } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const logActivity = useHostActivityLogger(hostId)

  const [nameOverride, setNameOverride] = useState(record.nameOverride)
  const [phone, setPhone] = useState(record.phone)
  const [jobTitle, setJobTitle] = useState(record.jobTitle)
  const [companyName, setCompanyName] = useState(record.companyName)
  const [ownerUid, setOwnerUid] = useState(record.ownerUid)
  const [lifecycleStage, setLifecycleStage] = useState<ContactLifecycleStage | ''>(
    record.lifecycleStage,
  )
  const [tags, setTags] = useState(record.tags.join(', '))
  const [notes, setNotes] = useState(record.notes)
  const [address, setAddress] = useState<AddressDraft>(
    addressDraftFrom(record.address),
  )
  const [phoneError, setPhoneError] = useState('')
  const [saving, setSaving] = useState(false)

  /*
   * Re-seeded when the RECORD changes, not when it re-renders. The listener
   * delivers a fresh row on every snapshot, including the one this card's
   * own save produces; re-seeding on each would overwrite what somebody is
   * in the middle of typing with what the server last confirmed.
   */
  const recordId = record.$id
  useEffect(() => {
    setNameOverride(record.nameOverride)
    setPhone(record.phone)
    setJobTitle(record.jobTitle)
    setCompanyName(record.companyName)
    setOwnerUid(record.ownerUid)
    setLifecycleStage(record.lifecycleStage)
    setTags(record.tags.join(', '))
    setNotes(record.notes)
    setAddress(addressDraftFrom(record.address))
    setPhoneError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId])

  const handleSave = useCallback(async () => {
    const trimmedPhone = phone.trim()
    const normalizedPhone = trimmedPhone ? normalizePhone(trimmedPhone) : ''
    if (trimmedPhone && !normalizedPhone) {
      setPhoneError('Enter it with its country code, like +1 512 555 0107.')
      return
    }
    setPhoneError('')
    const path = (field: string) =>
      Aglyn.contactFacetPath(consentGroup.groupId, field)
    /** A blank is a clearing, and a clearing is the field's absence. */
    const text = (value: string, max: number) => {
      const trimmed = value.trim().slice(0, max)
      return trimmed ? trimmed : deleteField()
    }
    const storedAddress = normalizeAddress(address)
    const storedCompany = companyName.trim().slice(0, 120)
    setSaving(true)
    try {
      const verdict = await writeGuardedBySeed(
        {
          subject: 'contact',
          unreadable: seed.status === 'error',
          fromCache: seed.fromCache,
        },
        async () => {
          await updateDoc(
            doc(firestore, scope[0], scope[1], 'contacts', record.$id),
            {
              [path('name')]: text(nameOverride, 120),
              [path('phone')]: normalizedPhone || deleteField(),
              [path('jobTitle')]: text(jobTitle, 120),
              [path('companyName')]: storedCompany || deleteField(),
              [path('address')]: storedAddress ?? deleteField(),
              [path('ownerUid')]: ownerUid || deleteField(),
              [path('lifecycleStage')]: lifecycleStage || deleteField(),
              [path('tags')]: parseContactTags(tags),
              [path('notes')]: notes.slice(0, 2000),
              // The search echoes — see `HostContact.phone`.
              phone: normalizedPhone || deleteField(),
              companyName: storedCompany || deleteField(),
              updatedAt: new Date(),
            },
          )
        },
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
      enqueueSnackbar('Contact saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }, [
    address,
    companyName,
    consentGroup.groupId,
    enqueueSnackbar,
    firestore,
    jobTitle,
    lifecycleStage,
    logActivity,
    nameOverride,
    notes,
    ownerUid,
    phone,
    record.$id,
    record.email,
    record.name,
    scope,
    seed.fromCache,
    seed.status,
    tags,
  ])

  /*
   * An owner the roster no longer lists — somebody who left the team — is
   * still offered as the current value, named by their uid, so the select is
   * never handed a value it has no option for and the reader can see who it
   * was before reassigning.
   */
  const ownerKnown = members.options.some((option) => option.uid === ownerUid)

  return (
    <CardDisplay
      header={'Properties'}
      help={Aglyn.pluginDocsHelp('contactRecord', { anchor: '#the-record-page' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            variant="contained"
            color="primary"
            size="small"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ),
      }}
    >
      <Grid container spacing={2}>
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
          <TextField
            size="small"
            label="Name"
            value={nameOverride}
            onChange={(event) => setNameOverride(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            helperText={
              record.canonicalName
                ? `Your own name for this person. Blank shows the name they gave: ${record.canonicalName}.`
                : 'Your own name for this person.'
            }
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={Boolean(phoneError)}
            helperText={phoneError || 'With the country code, like +1 512 555 0107'}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Job title"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            label="Company"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
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
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            size="small"
            label="Owner"
            value={ownerUid}
            onChange={(event) => setOwnerUid(event.target.value)}
            helperText={
              members.ready && !members.options.length
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
                {owner.label}
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
            onChange={(event) => setTags(event.target.value)}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Address'}</Typography>
            <ContactAddressFields value={address} onChange={setAddress} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TextField
            size="small"
            label="About"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            helperText="Notes for your team. Nobody outside this site's group can read them."
            multiline
            minRows={3}
            fullWidth
          />
        </Grid>
      </Grid>
    </CardDisplay>
  )
}
ContactPropertiesCard.displayName = 'ContactPropertiesCard'

export default ContactPropertiesCard
