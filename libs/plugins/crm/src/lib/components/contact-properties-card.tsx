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
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  type ConsentGroup,
  type ContactLifecycleStage,
  CRM_COLLECTIONS,
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
import { deleteField, doc, updateDoc, writeBatch } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { contactCompanyLinkWrites } from '../model/companies'
import { type ContactRecord, parseContactTags } from '../model/contact-record'
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
import type { OrgMembers } from './use-org-members'

export interface ContactPropertiesCardProps {
  hostId: string
  /** The org document the shell passed, for the company picker's scope. */
  org?: Partial<AglynOrgBilling> | null
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
 * ## Company is a record, with its name kept beside it
 *
 * The Company field is the picker (AGL-2613): the link is `companyId` in
 * this holder's facet, mirrored into the top-level `companyIds` for the
 * company page's query, and the company's contacts count moves in the same
 * batch — `contactCompanyLinkWrites` decides all three from the row's link
 * state, so this card never reasons about another holder's link. The name
 * is still written, from the picked company, because the list column and
 * the global search read the name and not the id; a record that carries a
 * name with no link — an import, a save from before the picker — keeps it
 * as the label, and the picker offers it as the company to link or create.
 */
export function ContactPropertiesCard(props: ContactPropertiesCardProps) {
  const { hostId, org, record, consentGroup, scope, seed, members } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const logActivity = useHostActivityLogger(hostId)
  const companies = useCompanyOptions({ hostId, org })
  const createCompany = useCreateCompany({ hostId, org })

  const [nameOverride, setNameOverride] = useState(record.nameOverride)
  const [phone, setPhone] = useState(record.phone)
  const [jobTitle, setJobTitle] = useState(record.jobTitle)
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
    setCompanyId(record.companyId || null)
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
    /*
     * The link, when it changed: the facet's id and the mirror on this
     * document, and the count on each company it moved. `null` when the
     * picker was left where the record had it, in which case the save is
     * the one `updateDoc` it always was.
     */
    const link = contactCompanyLinkWrites(
      record.companyLink,
      consentGroup.groupId,
      companyId,
    )
    setSaving(true)
    try {
      const verdict = await writeGuardedBySeed(
        {
          subject: 'contact',
          unreadable: seed.status === 'error',
          fromCache: seed.fromCache,
        },
        async () => {
          const contactRef = doc(firestore, scope[0], scope[1], 'contacts', record.$id)
          const payload = {
            ...(link?.contact ?? {}),
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
          }
          if (!link?.companies.length) {
            await updateDoc(contactRef, payload)
            return
          }
          // The count moves with the link or not at all — one commit.
          const batch = writeBatch(firestore)
          batch.update(contactRef, payload)
          for (const company of link.companies) {
            batch.update(
              doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies, company.id),
              company.update,
            )
          }
          await batch.commit()
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
    companyId,
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
    record.companyLink,
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
          <CompanyPicker
            options={companies.options}
            ready={companies.ready}
            truncated={companies.truncated}
            value={companyId}
            onChange={(id, company) => {
              setCompanyId(id)
              // The label follows the link: the picked name, or nothing
              // once the link is cleared. A company the list cannot name
              // keeps whatever label the record already had.
              setCompanyName(company ? company.name : id ? companyName : '')
            }}
            onCreate={createCompany}
            email={record.email}
            fallbackName={companyName}
            disabled={saving}
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
