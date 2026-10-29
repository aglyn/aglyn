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

import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import {
  sitePreviewStartsOn,
  type SitePreviewStart,
} from '@aglyn/aglyn/app-utils/site-preview'
import type {
  ConsoleCreatedSite,
  ConsolePendingSite,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgPermissions from '../hooks/use-org-permissions'
import { useOrgScope } from '../hooks/use-org-scope'
import { firstTouchField } from '../utils/account-acquisition'
import { currentConsoleLandingHref } from '../utils/console-landing'
import hardNavigate from '../utils/hard-navigate'
import { requestStarterSite } from '../utils/host-first-run'
import {
  SITE_START_LIVE_VALUE,
  SITE_START_PARAM,
} from './host-first-run-gate.component'
import PluginWidgetSlot, { useSlotWidgets } from './plugin-widget-slot.component'
import StartInPreviewSwitch from './start-in-preview-switch.component'
import { useSiteAddress } from './site-address-fields.component'

/** The zone "Create site" draws its start through (AGL-3761). */
const START_ZONE = 'hostFirstRun'

/**
 * How long a start widget may take to say whether it draws anything before
 * the plain dialog is shown instead. The widget asks one route; this only
 * bounds an answer that never comes.
 */
export const SITE_START_VERDICT_TIMEOUT_MS = 10_000

/**
 * The query a sites page opens "Create site" from (AGL-3761):
 * `/{org}/hosts?create=site`. The empty console sends a first site here once
 * its workspace exists, so the start is asked inside that workspace.
 */
export const SITE_CREATE_PARAM = 'create'
export const SITE_CREATE_VALUE = 'site'

/**
 * Opens "Create site" when the page was reached with `?create=site`, and
 * drops the parameter, so a reload or Back does not open it again. Rendered
 * under a `Suspense`, as anything reading the search parameters is.
 */
export function CreateSiteFromUrl({ onOpen }: { onOpen: () => void }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const asked = searchParams?.get(SITE_CREATE_PARAM) === SITE_CREATE_VALUE
  useEffect(() => {
    if (!asked) return
    onOpen()
    if (pathname) router.replace(pathname)
  }, [asked, onOpen, pathname, router])
  return null
}

export interface CreateHostDialogProps {
  open: boolean
  onClose: () => void
}

/** What a create attempt came to. */
type CreateOutcome =
  | { site: ConsoleCreatedSite }
  | { error: string; address?: boolean }

/**
 * "Create site" (user request 2026-07-07), opened straight on how the site
 * should start (AGL-3761).
 *
 * Nothing is created while the person decides. The site's name and address
 * are asked inside the start itself, and the site is created by
 * `POST /api/hosts/create` only when a choice needs it:
 *
 * - the starter site, or Skip: created with the starter, in one request, and
 *   the person lands on it with "Your site is live";
 * - a start the `hostFirstRun` zone's widget begins (the guided AI start's
 *   Plan my site): created empty, and the widget starts its job on it.
 *
 * Closing, cancelling, Back and leaving the page create nothing. That used to
 * be the other way round: the dialog created the site from its name and only
 * then opened the start, so every start closed unanswered left an empty site
 * behind.
 *
 * A workspace with no start to offer — no widget on the zone, or one that
 * answers it draws nothing — gets the plain name-and-address dialog, which
 * creates the site with the starter. A guided start the person was not offered
 * here is still offered on the site, which has its starter until it is
 * answered (AGL-3859).
 *
 * A guided start is checked by the jobs route before the site is created
 * (AGL-3859), so one that would be refused, or that asks for the Free
 * go-ahead, is answered with nothing created.
 *
 * What the create would refuse for reasons the console already knows — a role
 * without `hosts.create`, a plan with no site left — is said before anything
 * is asked. The server still decides; it refuses with the same reasons.
 */
export function CreateHostDialog(props: CreateHostDialogProps) {
  // Mounted only while open: the start zone loads its plugin when it mounts,
  // and a closed dialog on every sites page has no reason to.
  if (!props.open) return null
  return <CreateSiteFlow onClose={props.onClose} />
}
CreateHostDialog.displayName = 'CreateHostDialog'

function CreateSiteFlow({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { can, loaded: permissionsLoaded } = useOrgPermissions()
  const { enqueueSnackbar } = useSnackbar()
  const { widgets, ready: widgetsReady } = useSlotWidgets([START_ZONE])
  const [verdict, setVerdict] = useState<boolean | null>(null)
  const [created, setCreated] = useState<ConsoleCreatedSite | null>(null)
  const [busy, setBusy] = useState(false)
  // One create at a time: a second click while one is in flight answers the
  // same request rather than racing it for the same address.
  const inFlight = useRef<Promise<CreateOutcome> | null>(null)
  // A create this dialog began. The site it makes is counted in the
  // workspace's sites as soon as it exists, often before the response, and on
  // a one-site plan that count must not turn the dialog into the limit notice
  // and unmount the start that is about to begin its job on it (AGL-4017).
  const [madeHere, setMadeHere] = useState(false)
  const address = useSiteAddress({ autoFocus: true })
  const orgSlug = currentOrg?.slug ?? null
  /**
   * "Start in preview" (AGL-4086): the person's choice, or `null` while they
   * have not made one, so the start they take decides — on for a site brought
   * in from somewhere else, off for every other.
   */
  const [previewChoice, setPreviewChoice] = useState<boolean | null>(null)
  const previewFor = useCallback(
    (start: SitePreviewStart) => previewChoice ?? sitePreviewStartsOn(start),
    [previewChoice],
  )
  const previewForRef = useRef(previewFor)
  previewForRef.current = previewFor

  // What the create would refuse anyway, said first.
  const usedSites = useMemo(() => {
    const directory = (org as { hosts?: unknown } | null | undefined)?.hosts
    return directory && typeof directory === 'object'
      ? Object.values(directory as Record<string, unknown>).filter(Boolean).length
      : 0
  }, [org])
  const quota = orgReady && org ? checkQuota(org as never, 'hostLimit', usedSites) : null
  const blocked: 'role' | 'limit' | null =
    permissionsLoaded && !can('hosts.create')
      ? 'role'
      : quota && !quota.allowed && !madeHere
        ? 'limit'
        : null

  // An answer that never comes — the start's widget, or a read the gates
  // hold on — is the plain dialog, not a spinner forever. The server still
  // refuses what it must.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), SITE_START_VERDICT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  const resolving = (!widgetsReady || !permissionsLoaded || !orgReady) && !timedOut
  const offersStart =
    !blocked && widgets.length > 0 && verdict !== false && !(timedOut && verdict === null)
  const mode: 'blocked' | 'resolving' | 'start' | 'form' = blocked
    ? 'blocked'
    : resolving
      ? 'resolving'
      : !offersStart
        ? 'form'
        : verdict === true
          ? 'start'
          : 'resolving'

  // While the flow decides which start to draw, the console's own loading
  // overlay covers it, as every other wait in the console does, rather than
  // a dialog of its own around a spinner.
  const { queueLoading } = useLoading()
  useEffect(() => {
    if (mode !== 'resolving') return
    // Outside a loading provider (a spec) the context's default returns
    // nothing to dequeue.
    const dequeue: (() => void) | undefined = queueLoading()
    return () => dequeue?.()
  }, [mode, queueLoading])

  const land = useCallback(
    (target: string) => {
      // A site made on the auth host lands on the console host: `auth.`
      // refuses console paths with a 404 (AGL-3090, AGL-3742).
      const landing = currentConsoleLandingHref(target)
      if (landing !== target) hardNavigate(landing)
      else void router.push(target)
    },
    [router],
  )

  const dashboardOf = useCallback(
    (site: ConsoleCreatedSite) =>
      buildRoute(Route.HOST_DASHBOARD, { orgSlug: site.orgSlug, host: site.host }),
    [],
  )

  const requestCreate = useCallback(
    (start?: 'starter' | 'import'): Promise<CreateOutcome> => {
      if (inFlight.current) return inFlight.current
      setMadeHere(true)
      const request = (async (): Promise<CreateOutcome> => {
        try {
          const response = await authorizedFetch(userRef.current, '/api/hosts/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: address.name,
              subdomain: address.subdomain,
              // Create into the selected workspace (AGL-236).
              ...(currentOrg ? { orgId: currentOrg.$id } : {}),
              // The starter, chosen before the site exists (AGL-3761), or a
              // site brought in from somewhere else (AGL-4086).
              ...(start ? { start } : {}),
              // Start in preview (AGL-4086), as the switch reads for this start.
              preview: previewForRef.current(start ?? 'ai'),
              // A first site can provision the workspace too, which records
              // where a brand-new account came from (AGL-3706).
              ...firstTouchField(),
            }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || !payload?.hostId) {
            const error = String(payload?.error ?? 'Site creation failed')
            if (response.status === 409) {
              address.refuse(
                error,
                Array.isArray(payload?.suggestions) ? payload.suggestions : [],
              )
              return { error, address: true }
            }
            return { error }
          }
          // The workspace this request had to create on its way to the site
          // (AGL-2587), reported before the site itself so the two land in the
          // order they happened. `orgCreated` is true only when the server
          // actually provisioned one, so a site made in an existing workspace
          // counts nothing.
          if (payload.orgCreated === true) trackEvent('org_created', {})
          // Activation (AGL-1561) — the step between signing up and
          // publishing. After the `payload.hostId` guard, so a rejected
          // subdomain is not counted as a site, and here, where the site is
          // actually created: never when the start merely opened (AGL-3761).
          trackEvent('host_created', {})
          enqueueSnackbar(`Created "${address.name}"`, { variant: 'success', persist: false })
          const site: ConsoleCreatedSite = {
            hostId: String(payload.hostId),
            host: String(payload.subdomain ?? address.subdomain),
            // The workspace may have just been created for a first-time user,
            // so the response's slug outranks the (possibly null) current one.
            orgSlug: String(payload.orgSlug ?? orgSlug ?? ''),
          }
          return { site }
        } catch (error) {
          console.error(error)
          return { error: 'An error has occurred' }
        }
      })()
      inFlight.current = request
      void request.then((outcome) => {
        // Nothing was made, so a workspace at its limit is told so again.
        if ('error' in outcome) setMadeHere(false)
      })
      void request.finally(() => {
        inFlight.current = null
      })
      return request
    },
    [address, currentOrg, enqueueSnackbar, orgSlug],
  )

  // ── The plain dialog ──────────────────────────────────────────────────────
  const submitForm = useCallback(async () => {
    if (busy || !address.check()) return
    setBusy(true)
    try {
      // Always with the starter (AGL-3859). Without it the server makes the
      // site empty for a guided start this dialog never offered, and a person
      // who leaves before that start is answered is left with a site that has
      // nothing on it.
      const outcome = await requestCreate('starter')
      if ('error' in outcome) {
        return void enqueueSnackbar(outcome.error, {
          variant: outcome.address ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      // The site exists: the dialog closes now rather than standing, with
      // Create clickable again, until the dashboard has loaded behind it.
      onClose()
      if (!outcome.site.orgSlug) return
      land(dashboardOf(outcome.site))
    } finally {
      setBusy(false)
    }
  }, [address, busy, dashboardOf, enqueueSnackbar, land, onClose, requestCreate])

  // ── The start, before the site exists ─────────────────────────────────────
  const createdRef = useRef(created)
  createdRef.current = created
  const pendingSite = useMemo<ConsolePendingSite>(
    () => ({
      fields: address.fields,
      check: address.check,
      dirty: address.dirty,
      created,
      ready: (shown: boolean) => setVerdict(shown),
      create: async (options?: { start?: 'import' }) => {
        if (createdRef.current) return createdRef.current
        if (!address.check()) {
          return { error: 'Name your site and choose its address first.', address: true }
        }
        const outcome = await requestCreate(options?.start)
        if ('error' in outcome) return outcome
        setCreated(outcome.site)
        return outcome.site
      },
      previewControl: (start: SitePreviewStart) => (
        <StartInPreviewSwitch
          checked={previewFor(start)}
          onChange={setPreviewChoice}
          disabled={Boolean(created)}
        />
      ),
    }),
    [address, created, requestCreate, previewFor],
  )

  // The starter site, or Skip. Before the site exists this creates it WITH
  // the starter, in the one request; after a start created it and then could
  // not begin, it gives that site the starter, so no site is left empty.
  const startBlank = useCallback(async (): Promise<boolean> => {
    const existing = createdRef.current
    if (existing) {
      const provisioned = await requestStarterSite(userRef.current, existing.hostId)
      onClose()
      const dashboard = dashboardOf(existing)
      land(provisioned ? `${dashboard}?${SITE_START_PARAM}=${SITE_START_LIVE_VALUE}` : dashboard)
      return true
    }
    if (!address.check()) return false
    const outcome = await requestCreate('starter')
    if ('error' in outcome) {
      enqueueSnackbar(outcome.error, {
        variant: outcome.address ? 'warning' : 'error',
        allowDuplicate: true,
      })
      return false
    }
    // The starter Home is published with the site: its first live page, as
    // choosing the starter on a created site always reported. Not for a site
    // that starts in preview (AGL-4086): nobody but its team can see it, so it
    // is reported when it is made public.
    const inPreview = previewForRef.current('starter')
    if (!inPreview) trackEvent('site_published', { first_publish: true })
    onClose()
    if (outcome.site.orgSlug) {
      land(
        inPreview
          ? dashboardOf(outcome.site)
          : `${dashboardOf(outcome.site)}?${SITE_START_PARAM}=${SITE_START_LIVE_VALUE}`,
      )
    }
    return true
  }, [address, dashboardOf, enqueueSnackbar, land, onClose, requestCreate])

  const startZone = offersStart && currentOrg && orgSlug ? (
    <PluginWidgetSlot
      slot={START_ZONE}
      hostId={null}
      orgId={currentOrg.$id}
      orgSlug={orgSlug}
      host={created?.host ?? null}
      startBlank={startBlank}
      // A dismissal before the site exists, or the close after a start
      // began: either way there is nothing for the shell to write.
      leave={onClose}
      pendingSite={pendingSite}
    />
  ) : null

  if (mode === 'start') return startZone

  // The start zone stays mounted while resolving: its widget is what gives
  // the verdict.
  if (mode === 'resolving') return startZone

  if (mode === 'blocked') {
    return (
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>{'Create a new site'}</DialogTitle>
        <DialogContent>
          <Alert severity={blocked === 'limit' ? 'info' : 'warning'}>
            {blocked === 'limit'
              ? `Your plan includes ${quota?.limit === 1 ? 'one site' : `${quota?.limit} sites`}, and ` +
                'this workspace is using all of them. Upgrade or add extra sites from Billing.'
              : 'Your role in this workspace does not allow creating sites. Ask a workspace ' +
                'owner or admin to create it, or to change your role.'}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{'Close'}</Button>
          {blocked === 'limit' && orgSlug ? (
            <Button variant="contained" href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}>
              {'Go to Billing'}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <Dialog open onClose={() => (busy ? null : onClose())} maxWidth="xs" fullWidth>
      <DialogTitle>{'Create a new site'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {previewFor('starter')
            ? `Your site starts in preview on its ${TENANT_APEX} subdomain; ` +
              'connect a custom domain any time from Setup.'
            : `Your site goes live on its ${TENANT_APEX} subdomain ` +
              'immediately; connect a custom domain any time from Setup.'}
        </Typography>
        {/* The dialog is narrow, so its fields stack. */}
        {address.stackedFields}
        <StartInPreviewSwitch
          checked={previewFor('starter')}
          onChange={setPreviewChoice}
          disabled={busy}
        />
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!address.usable || busy}
          onClick={() => void submitForm()}
        >
          {busy ? 'Creating…' : 'Create site'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CreateHostDialog
