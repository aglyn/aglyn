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
  CLIENT_BUILD_LIMITS,
  CLIENT_BUILD_STEPS,
  clientBuildIntakeErrors,
  clientBuildResumeStep,
  clientBuildSiteAddress,
  domainPriceText,
  EMPTY_CLIENT_BUILD_INTAKE,
  type ClientBuildDomain,
  type ClientBuildIntake,
  type ClientBuildIntakeField,
  type ClientBuildRecord,
  type ClientBuildStep,
} from '@aglyn/aglyn/app-utils/client-build'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import { PLAN_LABELS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { ConsoleClientBuildStart } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { mdiOpenInNew, mdiQrcode, mdiSend } from '@aglyn/shared-data-mdi'
import BlockedControl from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { MdiIcon } from '@aglyn/shared-ui-jsx/components/mdi-icon'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  LinearProgress,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildRoute, Route } from '../../constants/route-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useHost } from '../../hooks/use-host'
import { useIsStaff } from '../../hooks/use-is-staff'
import { useOrgScope } from '../../hooks/use-org-scope'
import { requestStarterSiteOutcome } from '../../utils/host-first-run'
import {
  PhotoLinkCode,
  type PhotoLinkRow,
} from '../media/photo-link-dialog.component'
import StaffOrgOwnerHandoff from '../org-owner-handoff.component'
import PluginWidgetSlot, {
  useSlotWidgets,
} from '../plugin-widget-slot.component'
import { useSiteAddress } from '../site-address-fields.component'
import ClientBuildDomainStep from './client-build-domain-step.component'

/** How often the photo step asks how many photos have arrived. */
export const CLIENT_BUILD_PHOTO_POLL_MS = 5_000

/** The zone the guided start is drawn through. */
const START_ZONE = 'hostFirstRun'

const STEP_LABELS: Record<ClientBuildStep, string> = {
  details: 'Business details',
  domain: 'Domain',
  photos: 'Site and photos',
  build: 'Build with AI',
  send: 'Send the preview',
}

/** The intake's fields in the order they are asked, with what each is called. */
const FIELDS: ReadonlyArray<{
  field: ClientBuildIntakeField
  label: string
  placeholder?: string
  type?: string
  inputMode?: 'text' | 'tel' | 'email'
  autoComplete?: string
  multiline?: boolean
  required?: boolean
}> = [
  {
    field: 'businessName',
    label: 'Business name',
    required: true,
    autoComplete: 'organization',
  },
  {
    field: 'whatTheyDo',
    label: 'What they do',
    placeholder: 'A family plumbing business',
    required: true,
  },
  {
    field: 'towns',
    label: 'Towns they serve',
    placeholder: 'Austin, Round Rock and Pflugerville',
  },
  {
    field: 'phone',
    label: 'Phone',
    type: 'tel',
    inputMode: 'tel',
    autoComplete: 'tel',
  },
  {
    field: 'email',
    label: 'Email',
    type: 'email',
    inputMode: 'email',
    autoComplete: 'email',
  },
  {
    field: 'hours',
    label: 'Hours',
    placeholder: 'Mon–Fri 8am–5pm, Sat by appointment',
  },
  {
    field: 'ownerWords',
    label: 'In the owner’s words',
    placeholder: 'What makes the business theirs, as they tell it',
    multiline: true,
  },
]

interface Capabilities {
  domainSearch: boolean
  text: boolean
  email: boolean
}

/** A photo link made on this screen; its address exists only in this tab. */
interface FreshLink {
  linkId: string
  url: string
}

const linkKey = (hostId: string) => `aglyn:client-build:photo-link:${hostId}`

function readFreshLink(hostId: string): FreshLink | null {
  try {
    const raw = window.sessionStorage.getItem(linkKey(hostId))
    const parsed = raw ? (JSON.parse(raw) as Partial<FreshLink>) : null
    return parsed?.linkId && parsed.url
      ? { linkId: parsed.linkId, url: parsed.url }
      : null
  } catch {
    return null
  }
}

function keepFreshLink(hostId: string, link: FreshLink): void {
  try {
    window.sessionStorage.setItem(linkKey(hostId), JSON.stringify(link))
  } catch {
    // The link stays on screen; a reload asks for a new one.
  }
}

/**
 * BUILD FOR A CLIENT, ON ONE PHONE SCREEN (AGL-3958).
 *
 * Reached from "Create workspace" with "Build for a client" on (AGL-3952),
 * which comps the workspace and lands here. At a booth or a doorstep there is
 * no laptop, so the whole build is one column of steps that works at phone
 * width:
 *
 *  1. the business details, asked once: the guided start reads them rather
 *     than asking the owner again;
 *  2. the domain: search (when a provider is registered), the free address,
 *     or one they already have — recorded on the hand-off's intent, never
 *     bought here;
 *  3. the site, created comped, and the photo link's QR, so the owner scans
 *     it while staff type and their photos are in the library BEFORE the
 *     guided start, which then places them ahead of any stock photo;
 *  4. the guided AI start, opened on its review with these answers, which
 *     stays with its job on this screen;
 *  5. once the site is published, the preview texted and emailed to the
 *     owner, and the hand-off, which opens on the build's intent.
 *
 * Everything is saved as it goes (`/api/admin/client-build`), so a phone that
 * reloads, or a second phone, resumes at the first unfinished step. Staff
 * only: the route refuses anyone else, and the screen says so.
 */
export function ClientBuildScreen() {
  const isStaff = useIsStaff()
  const { currentOrg } = useOrgScope()
  const orgId = currentOrg?.$id ?? null
  const orgSlug = currentOrg?.slug ?? null
  if (isStaff === null || (isStaff && !orgId)) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress aria-label="Loading the build…" />
      </Box>
    )
  }
  if (!isStaff || !orgId || !orgSlug) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="info">
          {'Building a site for a client is for the platform team.'}
        </Alert>
      </Container>
    )
  }
  return <ClientBuildFlow orgId={orgId} orgSlug={orgSlug} />
}
ClientBuildScreen.displayName = 'ClientBuildScreen'

function ClientBuildFlow({
  orgId,
  orgSlug,
}: {
  orgId: string
  orgSlug: string
}) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const { enqueueSnackbar } = useSnackbar()
  const { org, ready: orgReady } = useCurrentOrg()
  const orgName = orgReady
    ? ((org as { name?: string } | null | undefined)?.name ?? null)
    : null

  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities>({
    domainSearch: false,
    text: false,
    email: false,
  })
  const [record, setRecord] = useState<ClientBuildRecord | null>(null)
  const [step, setStep] = useState<ClientBuildStep>('details')
  const [intake, setIntake] = useState<ClientBuildIntake>(
    EMPTY_CLIENT_BUILD_INTAKE,
  )
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await authorizedFetch(
        userRef.current,
        '/api/admin/client-build',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, ...body }),
        },
      )
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      return { ok: response.ok, payload }
    },
    [orgId],
  )

  // The stored build, read once per signed-in staff member and workspace.
  const callRef = useRef(call)
  callRef.current = call
  useEffect(() => {
    if (!uid) return
    let active = true
    void (async () => {
      try {
        const { ok, payload } = await callRef.current({ action: 'get' })
        if (!active) return
        if (!ok) {
          setLoadError(
            String(payload['error'] ?? 'The build could not be loaded.'),
          )
          return
        }
        const stored = (payload['record'] as ClientBuildRecord | null) ?? null
        setRecord(stored)
        if (stored) setIntake(stored.intake)
        setStep(clientBuildResumeStep(stored))
        setCapabilities({
          domainSearch: false,
          text: false,
          email: false,
          ...(payload['capabilities'] as object),
        })
      } catch {
        if (active) setLoadError('The build could not be loaded.')
      } finally {
        if (active) setLoaded(true)
      }
    })()
    return () => {
      active = false
    }
  }, [uid, orgId])

  const save = useCallback(
    async (
      patch: Record<string, unknown>,
    ): Promise<ClientBuildRecord | null> => {
      setBusy(true)
      try {
        const { ok, payload } = await call({ action: 'save', ...patch })
        if (!ok) {
          enqueueSnackbar(
            String(payload['error'] ?? 'The build could not be saved'),
            {
              variant: 'warning',
              persist: false,
            },
          )
          return null
        }
        const saved = payload['record'] as ClientBuildRecord
        setRecord(saved)
        return saved
      } catch {
        enqueueSnackbar('The build could not be saved', {
          variant: 'warning',
          persist: false,
        })
        return null
      } finally {
        setBusy(false)
      }
    },
    [call, enqueueSnackbar],
  )

  const errors = clientBuildIntakeErrors(intake)
  const submitDetails = async () => {
    setShowErrors(true)
    if (Object.keys(errors).length) return
    if (await save({ intake })) setStep('domain')
  }

  const submitDomain = async (domain: ClientBuildDomain) => {
    if (await save({ domain })) setStep('photos')
  }

  if (!loaded) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress aria-label="Loading the build…" />
      </Box>
    )
  }

  const activeIndex = CLIENT_BUILD_STEPS.indexOf(step)

  return (
    <Container
      maxWidth="sm"
      disableGutters
      sx={{ px: 2, py: { xs: 2, sm: 4 } }}
    >
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h5" component="h1">
            {'Build for a client'}
          </Typography>
          <Chip label="Staff" size="small" color="primary" variant="outlined" />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {orgName
            ? `${orgName}: the details, a domain, their photos, the site, then the preview to their phone.`
            : 'The details, a domain, their photos, the site, then the preview to their phone.'}
        </Typography>
      </Stack>
      {loadError ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      ) : null}
      <Stepper activeStep={activeIndex} orientation="vertical">
        {CLIENT_BUILD_STEPS.map((key, index) => (
          <Step key={key} completed={index < activeIndex}>
            <StepLabel
              optional={
                index < activeIndex ? (
                  <StepSummary step={key} record={record} />
                ) : undefined
              }
              onClick={
                index < activeIndex && key !== 'build'
                  ? () => setStep(key)
                  : undefined
              }
              sx={
                index < activeIndex && key !== 'build'
                  ? { cursor: 'pointer' }
                  : undefined
              }
            >
              {STEP_LABELS[key]}
            </StepLabel>
            {/* Only the step being answered is mounted: a step's content reads and
                writes as it mounts (the photo link is made, the site's address
                checked), which a collapsed step must not do. */}
            <StepContent slotProps={{ transition: { unmountOnExit: true } }}>
              {key === 'details' && key === step ? (
                <Box
                  component="form"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitDetails()
                  }}
                >
                  <Stack spacing={2} sx={{ pt: 1 }}>
                    {FIELDS.map((entry) => {
                      const error = showErrors ? errors[entry.field] : undefined
                      return (
                        <TextField
                          key={entry.field}
                          fullWidth
                          required={entry.required}
                          label={entry.label}
                          placeholder={entry.placeholder}
                          type={entry.type}
                          value={intake[entry.field]}
                          multiline={entry.multiline}
                          minRows={entry.multiline ? 4 : undefined}
                          error={Boolean(error)}
                          helperText={
                            error ??
                            (entry.multiline
                              ? `${intake[entry.field].length.toLocaleString('en-US')} / ${CLIENT_BUILD_LIMITS[entry.field].toLocaleString('en-US')}`
                              : undefined)
                          }
                          onChange={(event) =>
                            setIntake((current) => ({
                              ...current,
                              [entry.field]: event.target.value.slice(
                                0,
                                CLIENT_BUILD_LIMITS[entry.field],
                              ),
                            }))
                          }
                          slotProps={{
                            htmlInput: {
                              ...(entry.inputMode
                                ? { inputMode: entry.inputMode }
                                : {}),
                              ...(entry.autoComplete
                                ? { autoComplete: entry.autoComplete }
                                : {}),
                            },
                          }}
                        />
                      )
                    })}
                    <Typography variant="caption" color="text.secondary">
                      {
                        'The preview goes to the phone by text and to the email. The site shows them as how to get in touch.'
                      }
                    </Typography>
                    <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                      <Button type="submit" variant="contained" disabled={busy}>
                        {busy ? 'Saving…' : 'Continue'}
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              ) : null}
              {key === 'domain' && key === step ? (
                <Box sx={{ pt: 1 }}>
                  <ClientBuildDomainStep
                    orgId={orgId}
                    searchable={capabilities.domainSearch}
                    value={record?.domain ?? null}
                    suggestedQuery={intake.businessName}
                    busy={busy}
                    onBack={() => setStep('details')}
                    onContinue={(domain) => void submitDomain(domain)}
                  />
                </Box>
              ) : null}
              {key === 'photos' && key === step ? (
                <PhotosStep
                  orgId={orgId}
                  record={record}
                  businessName={intake.businessName}
                  busy={busy}
                  onCreated={async (site) =>
                    Boolean(await save({ hostId: site.hostId }))
                  }
                  onBack={() => setStep('domain')}
                  onContinue={() => setStep('build')}
                />
              ) : null}
              {key === 'build' && key === step && record?.hostId ? (
                <BuildStep
                  orgId={orgId}
                  orgSlug={orgSlug}
                  hostId={record.hostId}
                  host={record.host}
                  intake={record.intake}
                  onStarted={async (jobId) => {
                    await save({ jobId })
                  }}
                  onStarter={async () =>
                    Boolean(await save({ starter: true }))
                  }
                  onDone={() => setStep('send')}
                  onBack={() => setStep('photos')}
                />
              ) : null}
              {key === 'send' && key === step && record?.hostId ? (
                <SendStep
                  orgId={orgId}
                  orgName={orgName}
                  record={record}
                  capabilities={capabilities}
                  call={call}
                  onSent={(sentAt) =>
                    setRecord((current) =>
                      current ? { ...current, previewSentAt: sentAt } : current,
                    )
                  }
                />
              ) : null}
            </StepContent>
          </Step>
        ))}
      </Stepper>
    </Container>
  )
}

/** A finished step's answer, in one line under its label. */
function StepSummary({
  step,
  record,
}: {
  step: ClientBuildStep
  record: ClientBuildRecord | null
}) {
  const text =
    step === 'details'
      ? record?.intake.businessName
      : step === 'domain'
        ? record?.domain?.choice === 'free'
          ? 'The free address for now'
          : record?.domain?.name
        : step === 'photos'
          ? record?.host
            ? `Site ${record.host}`
            : undefined
          : step === 'build'
            ? record?.jobId
              ? 'Started'
              : 'The starter site'
            : undefined
  return text ? (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ wordBreak: 'break-word' }}
    >
      {text}
    </Typography>
  ) : null
}

// ── Site and photos ─────────────────────────────────────────────────────────

function PhotosStep(props: {
  orgId: string
  record: ClientBuildRecord | null
  businessName: string
  busy: boolean
  onCreated: (site: { hostId: string; host: string }) => Promise<boolean>
  onBack: () => void
  onContinue: () => void
}) {
  const { orgId, record, businessName, busy, onCreated, onBack, onContinue } =
    props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const { enqueueSnackbar } = useSnackbar()
  const address = useSiteAddress({ initialName: businessName })
  const [creating, setCreating] = useState(false)
  const hostId = record?.hostId ?? null

  const create = async () => {
    if (creating || !address.check()) return
    setCreating(true)
    try {
      // Created empty, for the guided start (AGL-3761): no `start`, so the
      // server writes no starter, and the photos land before any page.
      const response = await authorizedFetch(
        userRef.current,
        '/api/hosts/create',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: address.name,
            subdomain: address.subdomain,
            orgId,
          }),
        },
      )
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null
      if (!response.ok || !payload?.['hostId']) {
        const error = String(
          payload?.['error'] ?? 'The site could not be created',
        )
        if (response.status === 409) {
          address.refuse(
            error,
            Array.isArray(payload?.['suggestions'])
              ? (payload['suggestions'] as string[])
              : [],
          )
        } else enqueueSnackbar(error, { variant: 'warning', persist: false })
        return
      }
      await onCreated({
        hostId: String(payload['hostId']),
        host: String(payload['subdomain'] ?? address.subdomain),
      })
    } catch {
      enqueueSnackbar('The site could not be created', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setCreating(false)
    }
  }

  if (!hostId) {
    return (
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {
            'The site is made now, on the comped plan, so the owner’s photos can go into it before the AI builds it.'
          }
        </Typography>
        {address.stackedFields}
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: 'space-between' }}
        >
          <Button onClick={onBack} disabled={creating || busy}>
            {'Back'}
          </Button>
          <Button
            variant="contained"
            disabled={creating || busy || !address.usable}
            onClick={() => void create()}
          >
            {creating || busy ? 'Creating…' : 'Create the site'}
          </Button>
        </Stack>
      </Stack>
    )
  }
  return (
    <PhotoLinkPanel hostId={hostId} onBack={onBack} onContinue={onContinue} />
  )
}

/** The photo link's QR, made once per site in this tab, and how many photos it has brought in. */
function PhotoLinkPanel({
  hostId,
  onBack,
  onContinue,
}: {
  hostId: string
  onBack: () => void
  onContinue: () => void
}) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [link, setLink] = useState<FreshLink | null>(() =>
    readFreshLink(hostId),
  )
  const [received, setReceived] = useState(0)
  const [state, setState] = useState<'idle' | 'making' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await authorizedFetch(
        userRef.current,
        '/api/media/photo-links',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, ...body }),
        },
      )
      return {
        ok: response.ok,
        payload: (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >,
      }
    },
    [hostId],
  )

  const make = useCallback(async () => {
    setState('making')
    setError(null)
    try {
      const { ok, payload } = await call({ action: 'create' })
      if (!ok || typeof payload['url'] !== 'string') {
        setState('error')
        setError(
          String(payload['error'] ?? 'The photo link could not be made.'),
        )
        return
      }
      const fresh = { linkId: String(payload['linkId']), url: payload['url'] }
      keepFreshLink(hostId, fresh)
      setLink(fresh)
      setState('idle')
    } catch {
      setState('error')
      setError('The photo link could not be made.')
    }
  }, [call, hostId])

  // One link per site, made the first time the step is shown in this tab.
  const makeRef = useRef(make)
  makeRef.current = make
  const asked = useRef(false)
  useEffect(() => {
    if (!uid || link || asked.current) return
    asked.current = true
    void makeRef.current()
  }, [uid, link])

  // How many photos the site's open links have brought in, while the owner sends them.
  const callRef = useRef(call)
  callRef.current = call
  useEffect(() => {
    if (!uid) return
    let active = true
    const read = async () => {
      try {
        const { ok, payload } = await callRef.current({ action: 'list' })
        if (!active || !ok) return
        const links = (payload['links'] as PhotoLinkRow[] | undefined) ?? []
        setReceived(
          links.reduce((sum, row) => sum + (Number(row.uploads) || 0), 0),
        )
      } catch {
        // The count is a courtesy; the next read tries again.
      }
    }
    void read()
    const timer = setInterval(() => void read(), CLIENT_BUILD_PHOTO_POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [uid, hostId])

  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {'The owner scans this with their phone camera and picks their photos. No sign-in. The AI puts their ' +
          'photos on the site before any stock photo.'}
      </Typography>
      {link ? (
        <PhotoLinkCode
          url={link.url}
          caption="Works for 7 days. Photos land in the site’s media library."
        />
      ) : state === 'error' ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void make()}>
              {'Try again'}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress aria-label="Making the photo link…" />
        </Box>
      )}
      <Alert severity={received > 0 ? 'success' : 'info'} aria-live="polite">
        {received > 0
          ? `${received} ${received === 1 ? 'photo' : 'photos'} received.`
          : 'Waiting for photos. This updates on its own.'}
      </Alert>
      {link ? (
        <Button
          size="small"
          startIcon={<MdiIcon path={mdiQrcode.path} fontSize="small" />}
          onClick={() => void make()}
          disabled={state === 'making'}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'New code'}
        </Button>
      ) : null}
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'space-between' }}
      >
        <Button onClick={onBack}>{'Back'}</Button>
        <Button variant="contained" onClick={onContinue}>
          {received > 0 ? 'Continue' : 'Continue without photos'}
        </Button>
      </Stack>
    </Stack>
  )
}

// ── The guided start ────────────────────────────────────────────────────────

function BuildStep(props: {
  orgId: string
  orgSlug: string
  hostId: string
  host: string | null
  intake: ClientBuildIntake
  onStarted: (jobId: string) => Promise<void>
  /**
   * The starter site exists: records the choice, so a reload resumes at
   * send. Called only once the starter request succeeded; `false` when the
   * record could not be saved.
   */
  onStarter: () => Promise<boolean>
  onDone: () => void
  onBack: () => void
}) {
  const {
    orgId,
    orgSlug,
    hostId,
    host,
    intake,
    onStarted,
    onStarter,
    onDone,
    onBack,
  } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const { widgets, ready } = useSlotWidgets([START_ZONE])
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [starterError, setStarterError] = useState<string | null>(null)
  const offered = ready && widgets.length > 0 && !hidden

  // The starter instead: the published Home page and layout every other new
  // site is born with, so no site is left empty.
  // Recorded only once the starter exists (written now, or already there
  // from an earlier try); a failed request leaves the record as it was and
  // says so here, with a retry.
  const giveStarter = useCallback(async (style?: string) => {
    setOpen(false)
    setStarting(true)
    setStarterError(null)
    const failure = await (async () => {
      // In the style chosen for it, when one was (AGL-4049).
      const outcome = await requestStarterSiteOutcome(userRef.current, hostId, { style })
      if (outcome === 'failed') {
        return 'The starter site could not be added. Try again.'
      }
      if (!(await onStarter())) {
        return 'The starter site was added, but the build could not be saved. Try again.'
      }
      return null
    })().finally(() => setStarting(false))
    if (failure) setStarterError(failure)
    else onDone()
  }, [hostId, onDone, onStarter])

  const clientBuild = useMemo<ConsoleClientBuildStart>(
    () => ({
      intake,
      onStarted: (job) => {
        setStarted(true)
        void onStarted(job.id)
      },
      ready: (shown) => {
        if (!shown) {
          setHidden(true)
          setOpen(false)
        }
      },
    }),
    [intake, onStarted],
  )

  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      {!ready ? (
        <LinearProgress aria-label="Checking the guided start…" />
      ) : offered ? (
        <Typography variant="body2" color="text.secondary">
          {'The guided start opens on its review, filled in from the details. Check it with the owner, ' +
            'then plan the site. It builds and publishes the site in a few minutes.'}
        </Typography>
      ) : (
        <PrerequisiteNotice
          href={buildRoute(Route.ADMIN_ORG_DETAIL, { orgId })}
          actionLabel="Staff page"
        >
          {`The guided AI start is not available on this workspace: it needs ${PLATFORM_BRAND_NAME} AI, which can ` +
            'be added to the comp from the staff organization page. Or give the site the starter for now.'}
        </PrerequisiteNotice>
      )}
      {starterError ? (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => void giveStarter()}
              disabled={starting}
            >
              {'Try again'}
            </Button>
          }
        >
          {starterError}
        </Alert>
      ) : null}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'space-between' }}
      >
        <Button onClick={onBack} disabled={starting}>
          {'Back'}
        </Button>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1}>
          <Button
            onClick={() => void giveStarter()}
            disabled={starting || !ready}
          >
            {starting ? 'Adding the starter…' : 'Use the starter site'}
          </Button>
          <Button
            variant="contained"
            disabled={!offered || starting}
            onClick={() => setOpen(true)}
          >
            {'Open the guided start'}
          </Button>
        </Stack>
      </Stack>
      {open ? (
        <PluginWidgetSlot
          slot={START_ZONE}
          hostId={hostId}
          orgId={orgId}
          orgSlug={orgSlug}
          host={host}
          startBlank={(options?: { style?: string }) => void giveStarter(options?.style)}
          // Closing after the start began: the job builds the site.
          leave={() => {
            setOpen(false)
            if (started) onDone()
          }}
          clientBuild={clientBuild}
        />
      ) : null}
    </Stack>
  )
}

// ── The preview and the hand-off ────────────────────────────────────────────

interface PreviewOutcome {
  emailed: boolean
  text: string
}

function SendStep(props: {
  orgId: string
  orgName: string | null
  record: ClientBuildRecord
  capabilities: Capabilities
  call: (
    body: Record<string, unknown>,
  ) => Promise<{ ok: boolean; payload: Record<string, unknown> }>
  onSent: (sentAt: number) => void
}) {
  const { orgId, orgName, record, capabilities, call, onSent } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data: site },
  } = useHost({ hostId: record.hostId as string })
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<PreviewOutcome | null>(null)
  const screens = (site as { screens?: Record<string, unknown> } | undefined)
    ?.screens
  const published = Boolean(screens && Object.keys(screens).length)
  const previewUrl = hostPublicOrigin({
    subdomain:
      (site as { subdomain?: string } | undefined)?.subdomain ?? record.host,
  })
  const siteAddress = clientBuildSiteAddress(record.domain, previewUrl ?? null)
  const { intake, intent } = record
  const channels = [
    intake.phone && capabilities.text ? 'text' : '',
    intake.email && capabilities.email ? 'email' : '',
  ].filter(Boolean)
  const blockedReason = !published
    ? 'The site is still being built.'
    : channels.length === 0
      ? 'Neither texting nor email is set up here for the details given.'
      : null

  const send = async () => {
    setSending(true)
    try {
      const { ok, payload } = await call({ action: 'send-preview' })
      if (!ok) {
        enqueueSnackbar(
          String(payload['error'] ?? 'The preview could not be sent'),
          { variant: 'warning', persist: false },
        )
        return
      }
      const result = {
        emailed: payload['emailed'] === true,
        text: String(payload['text'] ?? 'none'),
      }
      setOutcome(result)
      if (result.emailed || result.text === 'sent') onSent(Date.now())
    } catch {
      enqueueSnackbar('The preview could not be sent', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      {published ? (
        <Alert severity="success">
          {'The site is published.'}
          {previewUrl ? (
            <Box
              component="span"
              sx={{ display: 'block', wordBreak: 'break-all' }}
            >
              <a href={previewUrl} target="_blank" rel="noreferrer">
                {previewUrl.replace(/^https?:\/\//, '')}
              </a>
            </Box>
          ) : null}
        </Alert>
      ) : (
        <Stack spacing={1}>
          <LinearProgress aria-label="Building the site…" />
          <Typography variant="body2" color="text.secondary">
            {'Building the site. This updates on its own when it is published.'}
          </Typography>
        </Stack>
      )}
      {intake.phone && !capabilities.text ? (
        <Typography variant="caption" color="text.secondary">
          {
            'Texting is not set up in this deployment, so the preview goes by email only.'
          }
        </Typography>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <BlockedControl
          blocked={blockedReason !== null}
          reason={blockedReason ?? ''}
        >
          <Button
            variant="contained"
            startIcon={<MdiIcon path={mdiSend.path} fontSize="small" />}
            disabled={sending || blockedReason !== null}
            onClick={() => void send()}
          >
            {sending
              ? 'Sending…'
              : record.previewSentAt
                ? 'Send the preview again'
                : channels.length === 2
                  ? 'Text and email the preview'
                  : channels[0] === 'text'
                    ? 'Text the preview'
                    : 'Email the preview'}
          </Button>
        </BlockedControl>
        {previewUrl && published ? (
          <Button
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            startIcon={<MdiIcon path={mdiOpenInNew.path} fontSize="small" />}
          >
            {'Open the site'}
          </Button>
        ) : null}
      </Stack>
      {blockedReason && published ? (
        <Typography variant="caption" color="text.secondary">
          {blockedReason}
        </Typography>
      ) : null}
      {outcome ? (
        <Alert
          severity={
            outcome.emailed || outcome.text === 'sent' ? 'success' : 'warning'
          }
        >
          {previewOutcomeText(outcome, intake)}
        </Alert>
      ) : null}
      {siteAddress ? (
        <Typography variant="body2">{`It will live at ${siteAddress}.`}</Typography>
      ) : null}

      <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">{'Hand off'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {`Proposes ${PLAN_LABELS[intent.plan]}` +
              (intent.addons.includes('siteCare') ? ' with Site Care' : '') +
              `, billed ${intent.interval === 'year' ? 'yearly' : 'monthly'}` +
              (intent.domain
                ? `, and ${intent.domain.name} (${domainPriceText(intent.domain)}), bought by the owner after they subscribe`
                : '') +
              (intent.existingDomain
                ? `, connecting ${intent.existingDomain}`
                : '') +
              '.'}
          </Typography>
          {/* Opens on this build's intent, from the record already held
              here, with the domain for the site the build made. */}
          <StaffOrgOwnerHandoff
            orgId={orgId}
            orgName={orgName}
            build={record}
            sites={[
              {
                hostId: record.hostId as string,
                name:
                  intake.businessName ||
                  (record.host ?? (record.hostId as string)),
              },
            ]}
          />
        </Stack>
      </Box>
    </Stack>
  )
}

/** What the send came to, per channel, in one sentence. */
export function previewOutcomeText(
  outcome: PreviewOutcome,
  intake: Pick<ClientBuildIntake, 'phone' | 'email'>,
): string {
  const parts: string[] = []
  if (outcome.text === 'sent') parts.push(`Texted to ${intake.phone}`)
  if (outcome.emailed) parts.push(`emailed to ${intake.email}`)
  const sent = parts.length ? `${parts.join(' and ')}.` : 'Nothing was sent.'
  const textProblem =
    outcome.text === 'invalid-number'
      ? ' The phone number could not be texted.'
      : outcome.text === 'suppressed'
        ? ' That number has opted out of texts.'
        : outcome.text === 'rate-limited'
          ? ' Texts are paused for this workspace for a moment.'
          : outcome.text === 'failed'
            ? ' The text could not be sent.'
            : outcome.text === 'unavailable' && intake.phone
              ? ' Texting is not set up here.'
              : ''
  const emailProblem =
    intake.email && !outcome.emailed ? ' The email could not be sent.' : ''
  return `${sent.charAt(0).toUpperCase()}${sent.slice(1)}${textProblem}${emailProblem}`
}

export default ClientBuildScreen
