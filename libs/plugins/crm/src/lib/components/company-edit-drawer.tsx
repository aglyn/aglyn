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
  type AglynOrgBilling,
  type AglynPostalAddress,
  CRM_COLLECTIONS,
  type CrmCompany,
  createResourceUid,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, HelpTip, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useHostActivityLogger,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import {
  type CompanyDraft,
  companyDraftFields,
  companyDraftFrom,
  EMPTY_COMPANY_DRAFT,
} from '../model/companies'

export interface CompanyEditDrawerProps {
  open: boolean
  onClose: () => void
  hostId: string
  org?: Partial<AglynOrgBilling> | null
  /**
   * The company being EDITED, or nothing to create one.
   *
   * The two modes differ in what the fields start as and in which write
   * runs: an edit opens on the stored values and updates the document, a
   * create opens empty and stamps the scope, provenance and timestamps a new
   * record must carry.
   */
  company?: (Partial<CrmCompany> & { $id: string }) | null
  /**
   * Whether the stored values the edit opened on can be trusted.
   *
   * Every optional field is written on every save — a blank one is a
   * DELETE — so a form seeded from a cached read would write the cache's
   * blanks over the server's values. The card that holds the listen reports
   * its own `fromCache` and `status`; the drawer refuses to save on a seed
   * the server never confirmed, and says so.
   */
  seed?: { fromCache: boolean; unreadable: boolean }
  /**
   * The team, for the owner picker.
   *
   * Handed in rather than fetched here, because the surface opening this
   * drawer already holds the roster to name owners in its rows, and one
   * fetch per surface is the bargain.
   */
  members: OrgMemberOptions
  /** Called with the record's id after a successful write. */
  onSaved: (companyId: string) => void
}

const ADDRESS_FIELDS: ReadonlyArray<{
  key: keyof AglynPostalAddress
  label: string
}> = [
  { key: 'line1', label: 'Address line 1' },
  { key: 'line2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State or region' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country (two-letter code)' },
]

/**
 * ONE COMPANY, created or edited (AGL-2597).
 *
 * A drawer rather than a form above the list, and the same drawer for both
 * jobs: a company is eight fields and an address, which is too much to wedge
 * over a table and exactly the same set whether the record exists yet. The
 * list opens it empty; the company's page opens it on the record.
 *
 * Nothing is written per keystroke. The draft is held here and turned into a
 * document by `companyDraftFields` on Save, which is where a domain typed as
 * `acme` or a phone number with no country code is refused — as a message
 * beside the button, with the typed values left where they are.
 */
export function CompanyEditDrawer(props: CompanyEditDrawerProps) {
  const { open, onClose, hostId, org, company, seed, members, onSaved } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { scope, createTokens } = useCrmScope({ hostId, org })
  const logActivity = useHostActivityLogger(hostId)

  const [draft, setDraft] = useState<CompanyDraft>(EMPTY_COMPANY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /*
   * Seeded when the drawer OPENS, and not on every render of the card
   * behind it: the company listen is live, so re-seeding on each snapshot
   * would take a field away from whoever is typing in it — including on the
   * snapshot their own save produces. The create case seeds the owner to the
   * person filing the record, which is the answer nine times in ten and one
   * click to change.
   */
  const companyId = company?.$id
  useEffect(() => {
    if (!open) return
    setDraft(
      company
        ? companyDraftFrom(company)
        : { ...EMPTY_COMPANY_DRAFT, ownerUid: user?.uid ?? '' },
    )
    setError('')
    // The stored fields are read once per opening; `company` is a new object
    // on every snapshot and must not re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId])

  const patch = useCallback(
    (field: keyof Omit<CompanyDraft, 'address'>, value: string) =>
      setDraft((current) => ({ ...current, [field]: value })),
    [],
  )
  const patchAddress = useCallback(
    (field: keyof AglynPostalAddress, value: string) =>
      setDraft((current) => ({
        ...current,
        address: { ...current.address, [field]: value },
      })),
    [],
  )

  const handleSave = useCallback(async () => {
    if (busy || !scope) return
    const result = companyDraftFields(draft)
    if (result.ok === false) return setError(result.error)
    setError('')
    setBusy(true)
    try {
      if (company) {
        const ref = doc(
          firestore,
          scope[0],
          scope[1],
          CRM_COLLECTIONS.companies,
          company.$id,
        )
        // The guard WRAPS the write — an early return is a shape you can
        // keep while losing the protection.
        const verdict = await writeGuardedBySeed(
          {
            subject: 'company',
            unreadable: seed?.unreadable ?? false,
            fromCache: seed?.fromCache ?? false,
          },
          async () => {
            await updateDoc(ref, {
              ...result.set,
              // A blank optional field is a DELETE on an edit, or the old
              // domain would stay stored and keep matching people by email.
              ...Object.fromEntries(
                result.cleared.map((field) => [field, deleteField()]),
              ),
              updatedAt: serverTimestamp(),
            })
          },
        )
        if (!verdict.ok) return setError(verdict.message)
        enqueueSnackbar('Company saved', { variant: 'success', persist: false })
        onSaved(company.$id)
      } else {
        const id = createResourceUid()
        await setDoc(
          doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies, id),
          {
            ...result.set,
            /*
             * The scope every CRM creator stamps: the whole org when the org
             * shares by default, and otherwise the sites that present as one
             * sender. Without it the record is seen by NOBODY — an absent
             * `visibleTo` matches no reader's predicate — and the rules
             * refuse a scoped member creating outside their own tokens.
             */
            visibleTo: [...createTokens],
            // Provenance: the site whose console filed it, never rewritten.
            hostId,
            createdByUid: user?.uid ?? '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        )
        // Setup → Activity shows CRM work (AGL-2622): the company is org
        // data, but the act happened in this site's console and belongs in
        // its feed. Creation only — an edit is a save the card reports.
        logActivity('Added company', { type: 'company', id, name: draft.name.trim() })
        enqueueSnackbar(`Company "${draft.name.trim()}" created`, {
          variant: 'success',
          persist: false,
        })
        onSaved(id)
      }
      onClose()
    } catch (caught) {
      console.error(caught)
      setError('The company could not be saved.')
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    scope,
    draft,
    company,
    firestore,
    seed,
    createTokens,
    hostId,
    user,
    logActivity,
    enqueueSnackbar,
    onSaved,
    onClose,
  ])

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>{'close drawer'}</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {company ? 'Edit company' : 'New company'}
          </Typography>
          <HelpTip
            {...pluginDocsHelp('companies', { anchor: '#create-a-company' })}
          />
        </>
      }
    >
      <Container gutterY>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'The organization behind one or more of your contacts. The ' +
              'domain is what suggests this company for a person from their ' +
              'email address, so enter the bare hostname.'}
          </Typography>
          <TextField
            size="small"
            label="Name"
            required
            value={draft.name}
            onChange={(event) => patch('name', event.target.value)}
            autoFocus
          />
          <TextField
            size="small"
            label="Domain"
            placeholder="example.com"
            value={draft.domain}
            onChange={(event) => patch('domain', event.target.value)}
          />
          <TextField
            size="small"
            label="Website"
            placeholder="https://www.example.com"
            value={draft.website}
            onChange={(event) => patch('website', event.target.value)}
          />
          <TextField
            size="small"
            label="Phone"
            placeholder="+1 512 555 0123"
            value={draft.phone}
            onChange={(event) => patch('phone', event.target.value)}
          />
          <TextField
            size="small"
            label="Industry"
            value={draft.industry}
            onChange={(event) => patch('industry', event.target.value)}
          />
          {/*
            The owner is chosen from the team, never typed: the value is a
            uid, and a picker that is still loading says so rather than
            offering an empty list that reads as "nobody can own this".
           */}
          <TextField
            select
            size="small"
            label="Owner"
            value={draft.ownerUid}
            disabled={!members.ready}
            helperText={
              !members.ready
                ? 'Loading your team…'
                : (members.error ?? 'The team member responsible for this account.')
            }
            onChange={(event) => patch('ownerUid', event.target.value)}
          >
            <MenuItem value="">{'Nobody yet'}</MenuItem>
            {draft.ownerUid &&
            !members.options.some((option) => option.uid === draft.ownerUid) ? (
              <MenuItem value={draft.ownerUid}>
                {members.labelFor(draft.ownerUid)}
              </MenuItem>
            ) : null}
            {members.options.map((option) => (
              <MenuItem key={option.uid} value={option.uid}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="subtitle2">{'Address'}</Typography>
          {ADDRESS_FIELDS.map((field) => (
            <TextField
              key={field.key}
              size="small"
              label={field.label}
              value={draft.address[field.key] ?? ''}
              onChange={(event) => patchAddress(field.key, event.target.value)}
            />
          ))}
          <TextField
            size="small"
            label="Notes"
            value={draft.notes}
            onChange={(event) => patch('notes', event.target.value)}
            multiline
            minRows={3}
          />
          {error ? <Alert severity="warning">{error}</Alert> : null}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              color="primary"
              disabled={busy || !scope || !draft.name.trim()}
              onClick={() => void handleSave()}
            >
              {busy
                ? 'Saving…'
                : company
                  ? 'Save company'
                  : 'Create company'}
            </Button>
            <Button onClick={onClose} disabled={busy}>
              {'Cancel'}
            </Button>
          </Stack>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
CompanyEditDrawer.displayName = 'CompanyEditDrawer'

export default CompanyEditDrawer
