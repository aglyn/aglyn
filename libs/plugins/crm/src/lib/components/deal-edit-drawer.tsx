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
  CRM_COLLECTIONS,
  CRM_RECORDS_BAND_FULL_MESSAGE,
  dealHasLineItems,
  findOrgMember,
  nameSearchKey,
} from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useHostActivityLogger,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Autocomplete,
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  addDoc,
  collection,
  deleteField,
  doc,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCrmRecordsQuota } from '../hooks/use-crm-records-quota'
import {
  type CrmOrgDoc,
  crmScopeListable,
  crmVisibleToClause,
  useCrmScope,
} from '../hooks/use-crm-scope'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import { contactPrimaryGroup } from '../model/contact-record'
import { CrmSitePicker } from './crm-site-picker'
import {
  DEAL_CURRENCIES,
  type DealDoc,
  openStages,
  type PipelineDoc,
} from '../model/deal-board-model'
import {
  type ContactChoice,
  contactChoicesFor,
  DEAL_NOTES_MAX,
  DEAL_TITLE_MAX,
  dealDocumentFromForm,
  dealFormFromDoc,
  dealFormProblem,
  type DealFormValues,
  dealPatchFromForm,
  emptyDealForm,
} from '../model/deal-form-model'

/**
 * How many recent contacts the picker matches against. The window is the
 * ask — it is read when the drawer opens, not when the section does — and
 * a person outside it is still linkable by pasting their address, which
 * the match tests as a prefix of the email.
 */
const CONTACT_WINDOW = 300

/** Companies offered per keystroke; a longer list is a scroll, not a pick. */
const COMPANY_MATCHES = 8

/** A company as the picker offers it. */
interface CompanyChoice {
  id: string
  name: string
}

export interface DealEditDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * The site the drawer is opened under, or `null` at the organization
   * level (AGL-2630), where a NEW deal asks which site captures it and an
   * edit keeps the deal's own.
   */
  hostId: string | null
  org: CrmOrgDoc
  /** The deal being edited; absent for a new one. */
  deal?: DealDoc | null
  /** Links and values a new deal opens with — a contact's page passes itself. */
  defaults?: Partial<DealFormValues>
  pipelines: PipelineDoc[]
  /** Where a new deal lands when nobody picks a pipeline. */
  defaultPipeline: PipelineDoc | null
  /** The listener's verdict on the row being edited, for the stale-seed guard. */
  unreadable?: boolean
  fromCache?: boolean
  /** After a save, with the id of the deal written. */
  onSaved?: (dealId: string, mode: 'create' | 'edit') => void
}

/**
 * The one form a deal is created and edited through (AGL-2598).
 *
 * ## What it writes, and what it does not
 *
 * Client-direct against the rules, like a contact's notes: the title, the
 * amount and its currency, the expected close, the owner, the linked
 * contact and company, and the notes. The stage and the status are shown on
 * a new deal — it has to start somewhere — and never on an existing one,
 * because a stage change is the moment an automation listens for and only
 * the server route can emit that event. A drawer that wrote `stageId`
 * directly would move a deal without anybody hearing it.
 *
 * Nor the amount of a deal that has line items (AGL-2620): it is their
 * sum, the products card on the deal's page owns it, and the field here
 * is read-only with a caption saying so. The pipeline picker on a new
 * deal lists every ACTIVE pipeline (`pipelines`) and opens on the one the
 * caller was looking at.
 *
 * ## The pickers
 *
 * The owner is picked from the org's roster, the company by a server-side
 * prefix on `nameLower` (indexed with the scope), and the contact from a
 * bounded window of the newest contacts matched in memory — see
 * `contactChoicesFor` for why the contact search cannot be a query. Both
 * pickers copy the chosen NAME onto the deal beside the id, so a board of
 * cards can caption itself without a read per card.
 */
export function DealEditDrawer(props: DealEditDrawerProps) {
  const {
    open,
    onClose,
    hostId,
    org,
    deal,
    defaults,
    pipelines,
    defaultPipeline,
    unreadable = false,
    fromCache = false,
    onSaved,
  } = props
  const mode: 'create' | 'edit' = deal ? 'edit' : 'create'
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: user } = useUser()
  const { orgId, consentGroup, visibleTo, createHostId, createTokens } =
    useCrmScope({ hostId, org })
  // The site a new deal is captured by — the mounted one, or the picked one
  // — and the site whose feed the act is logged in: the deal's own on an
  // edit, so a deal made on one site is not logged against another.
  const dealHostId = deal ? (deal.hostId ?? null) : createHostId
  const logActivity = useHostActivityLogger(dealHostId ?? undefined)
  const roster = useOrgMemberDirectory(open ? orgId : null)

  const [values, setValues] = useState<DealFormValues>(() =>
    emptyDealForm(defaultPipeline, defaults),
  )
  const owner = findOrgMember(roster.members, values.ownerUid)
  const [busy, setBusy] = useState(false)

  // Re-seeded on every open: an existing deal's stored values, or a blank
  // form aimed at the default pipeline with whatever the opener preselected.
  useEffect(() => {
    if (!open) return
    setValues(deal ? dealFormFromDoc(deal) : emptyDealForm(defaultPipeline, defaults))
  }, [open, deal, defaultPipeline, defaults])

  const update = useCallback(
    (patch: Partial<DealFormValues>) =>
      setValues((current) => ({ ...current, ...patch })),
    [],
  )

  const pipeline = useMemo(
    () =>
      pipelines.find((entry) => entry.$id === values.pipelineId) ??
      defaultPipeline,
    [pipelines, values.pipelineId, defaultPipeline],
  )
  const stages = useMemo(() => openStages(pipeline), [pipeline])

  /*
   * THE CONTACT WINDOW: the newest contacts this viewer may see, read only
   * while the drawer is open. Scoped and ordered like the contacts list —
   * the same `(visibleTo, updatedAt DESC)` index — and bounded, because the
   * picker's job is to find one person, not to list the audience.
   */
  const { data: contactRows } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      open && orgId && crmScopeListable(visibleTo)
        ? query(
            collection(firestore, 'orgs', orgId, 'contacts'),
            ...crmVisibleToClause(visibleTo),
            orderBy('updatedAt', 'desc'),
            limit(CONTACT_WINDOW),
          )
        : null,
    [firestore, open, orgId, visibleTo],
    { idField: '$id' },
  )
  const [contactQuery, setContactQuery] = useState('')
  // Named through the viewing group under a site; at the organization level
  // through each person's own primary holder.
  const contactChoices = useMemo(
    () =>
      contactChoicesFor(
        contactQuery,
        contactRows ?? [],
        consentGroup?.groupId ??
          ((row) => contactPrimaryGroup(row, org as Record<string, unknown>).groupId),
      ),
    [contactQuery, contactRows, consentGroup, org],
  )
  const contactValue: ContactChoice | null = values.contactId
    ? {
        id: values.contactId,
        name: values.contactName,
        email:
          contactChoices.find((choice) => choice.id === values.contactId)?.email ?? '',
      }
    : null

  /*
   * THE COMPANY SEARCH: a prefix on `nameLower` with the scope, which the
   * companies collection indexes. Debounced so a name typed at speed is one
   * query rather than one per letter.
   */
  const [companyQuery, setCompanyQuery] = useState('')
  const [companyChoices, setCompanyChoices] = useState<CompanyChoice[]>([])
  useEffect(() => {
    if (!open || !orgId || !crmScopeListable(visibleTo)) return
    const key = nameSearchKey(companyQuery)
    let active = true
    const timer = setTimeout(() => {
      void getDocs(
        query(
          collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.companies),
          ...crmVisibleToClause(visibleTo),
          orderBy('nameLower'),
          ...(key ? [startAt(key), endAt(`${key}\uf8ff`)] : []),
          limit(COMPANY_MATCHES),
        ),
      )
        .then((snapshot) => {
          if (!active) return
          setCompanyChoices(
            snapshot.docs.map((entry) => ({
              id: entry.id,
              name: String(entry.get('name') ?? ''),
            })),
          )
        })
        .catch(() => {
          if (active) setCompanyChoices([])
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [firestore, open, orgId, visibleTo, companyQuery])
  const companyValue: CompanyChoice | null = values.companyId
    ? { id: values.companyId, name: values.companyName }
    : null

  const problem = dealFormProblem(values, mode)
  const amountDerived = Boolean(deal && dealHasLineItems(deal))

  /*
   * THE RECORDS BAND (AGL-2611), read only while a CREATE is open: a deal
   * is a record of the band the contacts list is banded by, and on a Free
   * org at its hundred this drawer refuses the way `upsertHostContact`
   * refuses a capture — same number, same sentence. Memoized, because the
   * tuple is an effect dependency and a fresh one per render would re-read
   * the three aggregates on every keystroke.
   */
  const recordsScope = useMemo(
    () => (open && mode === 'create' && orgId ? (['orgs', orgId] as const) : null),
    [open, mode, orgId],
  )
  const records = useCrmRecordsQuota(recordsScope, org)
  const bandFull = mode === 'create' && records.ready && !records.quota.allowed

  const handleSave = useCallback(async () => {
    if (problem || !orgId || !user?.uid) return
    if (bandFull) {
      enqueueSnackbar(CRM_RECORDS_BAND_FULL_MESSAGE, { variant: 'warning', persist: false })
      return
    }
    setBusy(true)
    try {
      const nowMs = Date.now()
      if (deal) {
        const verdict = await writeGuardedBySeed(
          { subject: 'deal', unreadable, fromCache },
          async () => {
            const { set, clear } = dealPatchFromForm(values, nowMs, { amountDerived })
            await updateDoc(
              doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals, deal.$id),
              {
                ...set,
                ...Object.fromEntries(clear.map((key) => [key, deleteField()])),
              },
            )
          },
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
          return
        }
        enqueueSnackbar('Deal saved', { variant: 'success', persist: false })
        onSaved?.(deal.$id, 'edit')
      } else {
        // Held by the button until the capturing site is known; checked
        // again here because a callback can outlive the render that held it.
        if (!createHostId) return
        const created = await addDoc(
          collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals),
          dealDocumentFromForm(values, {
            visibleTo: [...createTokens],
            hostId: createHostId,
            uid: user.uid,
            nowMs,
          }),
        )
        // Setup → Activity shows CRM work (AGL-2622): the deal is org data,
        // but the act happened in this site's console and belongs in its
        // feed. Creation only — an edit is a save the card reports.
        logActivity('Added deal', { type: 'deal', id: created.id, name: values.title })
        enqueueSnackbar('Deal created', { variant: 'success', persist: false })
        onSaved?.(created.id, 'create')
      }
      onClose()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [
    problem,
    bandFull,
    orgId,
    user,
    deal,
    values,
    unreadable,
    fromCache,
    firestore,
    createTokens,
    createHostId,
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
      onClose={busy ? undefined : onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton color="inherit" edge="start" onClick={onClose} sx={{ mr: 2 }}>
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {deal ? 'Edit deal' : 'New deal'}
          </Typography>
        </>
      }
      appBarRight={
        <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
      }
    >
      <Container gutterY>
        <Stack spacing={2} sx={{ width: { xs: '100%', sm: 420 } }}>
          {/*
            First, because the scope of everything below follows from it: at
            the organization level a new deal names the site that captures
            it. Nothing under a site, and nothing on an edit — a deal keeps
            the site it was made on (AGL-2630).
          */}
          {mode === 'create' ? (
            <CrmSitePicker
              hostId={hostId}
              disabled={busy}
              helperText="The site this deal belongs to — it decides which of your sites may see it."
            />
          ) : null}
          <TextField
            label="Title"
            value={values.title}
            onChange={(event) => update({ title: event.target.value })}
            autoFocus
            fullWidth
            slotProps={{ htmlInput: { maxLength: DEAL_TITLE_MAX } }}
          />
          {mode === 'create' ? (
            <Stack direction="row" spacing={1}>
              <TextField
                select
                label="Pipeline"
                value={pipelines.some((entry) => entry.$id === values.pipelineId) ? values.pipelineId : ''}
                onChange={(event) => {
                  const next = pipelines.find(
                    (entry) => entry.$id === event.target.value,
                  )
                  update({
                    pipelineId: event.target.value,
                    stageId: openStages(next)[0]?.id ?? '',
                  })
                }}
                sx={{ flex: 1 }}
              >
                {pipelines.map((entry) => (
                  <MenuItem key={entry.$id} value={entry.$id}>
                    {entry.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Stage"
                value={stages.some((stage) => stage.id === values.stageId) ? values.stageId : ''}
                onChange={(event) => update({ stageId: event.target.value })}
                sx={{ flex: 1 }}
              >
                {stages.map((stage) => (
                  <MenuItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label="Amount"
              value={values.amount}
              onChange={(event) => update({ amount: event.target.value })}
              placeholder="0.00"
              sx={{ flex: 1 }}
              helperText={
                amountDerived
                  ? "The sum of the deal's line items — edit them on the Products card."
                  : undefined
              }
              slotProps={{
                htmlInput: { inputMode: 'decimal', readOnly: amountDerived },
              }}
            />
            <TextField
              select
              label="Currency"
              value={values.currency}
              onChange={(event) => update({ currency: event.target.value })}
              disabled={amountDerived}
              sx={{ width: 120 }}
            >
              {DEAL_CURRENCIES.map((code) => (
                <MenuItem key={code} value={code}>
                  {code.toUpperCase()}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            type="date"
            label="Expected close"
            value={values.expectedClose}
            onChange={(event) => update({ expectedClose: event.target.value })}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            select
            label="Owner"
            // The stored owner resolved to a member — by uid, or by an
            // address the roster has — so the picker highlights the person
            // and a save writes their uid.
            value={owner ? owner.uid : values.ownerUid ? '__keep' : ''}
            onChange={(event) =>
              update({
                ownerUid: event.target.value === '__keep' ? values.ownerUid : event.target.value,
              })
            }
            fullWidth
            helperText={
              !roster.loading && !roster.members.length
                ? 'The roster could not be read; the owner stays as stored.'
                : undefined
            }
          >
            <MenuItem value="">{'Nobody yet'}</MenuItem>
            {values.ownerUid && !owner ? (
              // The stored owner is not on the roster the route returned —
              // a member who left, or a roster that failed to load. Shown by
              // uid so the field is never blank while the deal has an owner.
              <MenuItem value="__keep">{values.ownerUid}</MenuItem>
            ) : null}
            {roster.members.map((member) => (
              <MenuItem key={member.uid} value={member.uid}>
                {member.label}
              </MenuItem>
            ))}
          </TextField>
          <Autocomplete<ContactChoice, false, false, false>
            options={contactChoices}
            value={contactValue}
            inputValue={contactQuery}
            onInputChange={(_event, next, reason) => {
              if (reason !== 'reset') setContactQuery(next)
            }}
            onChange={(_event, picked) =>
              update({
                contactId: picked?.id ?? '',
                contactName: picked ? picked.name || picked.email : '',
              })
            }
            getOptionLabel={(choice) => choice.name || choice.email}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            // Matching is `contactChoicesFor`'s — the list's grammar over the
            // window — and never MUI's own substring filter over labels.
            filterOptions={(options) => options}
            renderOption={(optionProps, choice) => (
              <li {...optionProps} key={choice.id}>
                <Stack sx={{ lineHeight: 1.25 }}>
                  <Typography variant="body2">{choice.name || choice.email}</Typography>
                  {choice.name ? (
                    <Typography variant="caption" color="text.secondary">
                      {choice.email}
                    </Typography>
                  ) : null}
                </Stack>
              </li>
            )}
            noOptionsText="No recent contact matches"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Contact"
                placeholder="Name or email"
                helperText="Searches your most recent contacts by name or email."
              />
            )}
          />
          <Autocomplete<CompanyChoice, false, false, false>
            options={companyChoices}
            value={companyValue}
            inputValue={companyQuery}
            onInputChange={(_event, next, reason) => {
              if (reason !== 'reset') setCompanyQuery(next)
            }}
            onChange={(_event, picked) =>
              update({
                companyId: picked?.id ?? '',
                companyName: picked?.name ?? '',
              })
            }
            getOptionLabel={(choice) => choice.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            filterOptions={(options) => options}
            noOptionsText="No company matches"
            renderInput={(params) => (
              <TextField {...params} label="Company" placeholder="Company name" />
            )}
          />
          <TextField
            label="Notes"
            value={values.notes}
            onChange={(event) => update({ notes: event.target.value })}
            multiline
            minRows={3}
            fullWidth
            slotProps={{ htmlInput: { maxLength: DEAL_NOTES_MAX } }}
          />
          {bandFull ? (
            <Alert severity="warning">{CRM_RECORDS_BAND_FULL_MESSAGE}</Alert>
          ) : null}
          {problem && values.title ? <Alert severity="warning">{problem}</Alert> : null}
          <Button
            variant="contained"
            disabled={
              busy ||
              Boolean(problem) ||
              !orgId ||
              bandFull ||
              // A new deal waits for its capturing site.
              (mode === 'create' && !createHostId)
            }
            onClick={() => void handleSave()}
          >
            {deal ? 'Save deal' : 'Create deal'}
          </Button>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
DealEditDrawer.displayName = 'DealEditDrawer'

export default DealEditDrawer
