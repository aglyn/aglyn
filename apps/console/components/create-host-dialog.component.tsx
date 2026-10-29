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
  hostCreatedEventParams,
  readHostStarterChoice,
} from '@aglyn/aglyn/app-utils/site-styles'
import {
  sitePreviewStartsOn,
  type SitePreviewStart,
} from '@aglyn/aglyn/app-utils/site-preview'
import {
  readSiteCreateRequest,
  SITE_CREATE_PARAM,
  SITE_CREATE_VALUE,
  type SiteCreateStarterReturn,
} from '@aglyn/aglyn/app-utils/site-create-return'
import type { SiteStarterMode } from '@aglyn/aglyn/app-utils/site-starter'
import {
  readSiteStarterPickRefusal,
  siteStarterPickBlock,
  type SiteStarterPickRefused,
} from '@aglyn/aglyn/app-utils/site-starter-pick'
import {
  CONSOLE_WIDGET_SLOTS,
  type ConsoleCreatedSite,
  type ConsolePendingSite,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import type { SiteStarterSummary } from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
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
import { useReleaseFlag } from '../hooks/use-release-flags'
import { firstTouchField } from '../utils/account-acquisition'
import { currentConsoleLandingHref } from '../utils/console-landing'
import hardNavigate from '../utils/hard-navigate'
import { requestStarterSite } from '../utils/host-first-run'
import ChooseStarterDialog, { CHOOSE_STARTER_COPY } from './choose-starter-dialog.component'
import {
  SITE_LIVE_STARTER_PARAM,
  SITE_START_LIVE_VALUE,
  SITE_START_PARAM,
} from './host-first-run-gate.component'
import PluginWidgetSlot, { useSlotWidgets } from './plugin-widget-slot.component'
import StartInPreviewSwitch from './start-in-preview-switch.component'
import { useSiteAddress } from './site-address-fields.component'
import SiteStylePicker from './site-style-picker.component'

/** The zone "Create site" draws its start through (AGL-3761). */
const START_ZONE = 'hostFirstRun'

/** The zone "Choose your starter" draws the marketplace's starters through (AGL-4049). */
const STARTER_ZONE = CONSOLE_WIDGET_SLOTS.hostStarterPicker

/**
 * How long a start widget may take to say whether it draws anything before
 * the plain dialog is shown instead. The widget asks one route; this only
 * bounds an answer that never comes.
 */
export const SITE_START_VERDICT_TIMEOUT_MS = 10_000

/**
 * The query a sites page opens "Create site" from (AGL-3761):
 * `/{org}/hosts?create=site`. The empty console sends a first site here once
 * its workspace exists, so the start is asked inside that workspace. A
 * starter bought from "Choose your starter" comes back the same way, naming
 * the pick (`app-utils/site-create-return.ts`, AGL-4049).
 */
export { SITE_CREATE_PARAM, SITE_CREATE_VALUE }

/**
 * Opens "Create site" when the page was reached with `?create=site`, and
 * drops the parameters, so a reload or Back does not open it again. With
 * `&starter=` — the way back from buying a starter (AGL-4049) — it opens on
 * that pick. Rendered under a `Suspense`, as anything reading the search
 * parameters is.
 */
export function CreateSiteFromUrl({
  onOpen,
}: {
  onOpen: (starter: SiteCreateStarterReturn | null) => void
}) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const request = readSiteCreateRequest(searchParams)
  const starterId = request.starter?.listingId ?? null
  const purchase = request.starter?.purchase ?? null
  useEffect(() => {
    if (!request.asked) return
    onOpen(starterId ? { listingId: starterId, purchase } : null)
    if (pathname) router.replace(pathname)
  }, [request.asked, starterId, purchase, onOpen, pathname, router])
  return null
}

export interface CreateHostDialogProps {
  open: boolean
  onClose: () => void
  /**
   * The starter to reopen "Choose your starter" on (AGL-4049): the person's
   * own pick, on the way back from paying for it. Never a pick of ours.
   */
  initialStarter?: SiteCreateStarterReturn | null
}

/** What a create attempt came to. */
type CreateOutcome =
  | { site: ConsoleCreatedSite; starterName?: string }
  | { error: string; address?: boolean; pick?: SiteStarterPickRefused }

/**
 * "Create site" (user request 2026-07-07), opened straight on how the site
 * should start (AGL-3761).
 *
 * Nothing is created while the person decides, and nothing is chosen for
 * them (AGL-4049): a site is created only once they have picked a style. The
 * site's name and address are asked inside the start itself, and the site is
 * created by `POST /api/hosts/create` only when a choice needs it:
 *
 * - the starter site, in the style they chose: created with the starter in
 *   that style's look, in one request, and the person lands on it with "Your
 *   site is live";
 * - a start the `hostFirstRun` zone's widget begins (the guided AI start's
 *   Plan my site): created empty, and the widget starts its job on it.
 *
 * Closing, cancelling, Back and leaving the page create nothing. That used to
 * be the other way round: the dialog created the site from its name and only
 * then opened the start, so every start closed unanswered left an empty site
 * behind.
 *
 * A workspace with no start to offer — no widget on the zone, or one that
 * answers it draws nothing — gets the plain dialog, which asks the name, the
 * address and the style, and creates the site with the starter in that
 * style; Create site waits until a style is chosen. A guided start the person was not offered
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
  return <CreateSiteFlow onClose={props.onClose} initialStarter={props.initialStarter ?? null} />
}
CreateHostDialog.displayName = 'CreateHostDialog'

function CreateSiteFlow({
  onClose,
  initialStarter,
}: {
  onClose: () => void
  initialStarter: SiteCreateStarterReturn | null
}) {
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

  // ── "Choose your starter" (AGL-4049) ──────────────────────────────────────
  // The marketplace's starters in the starter path, behind its release flag
  // (staff see it before it is released, as every flagged surface). Its zone's
  // plugin is asked for only when the flag is visible, so with it off Create
  // site loads, draws and creates exactly as before.
  const starters = useReleaseFlag('release_site_starters')
  const { widgets: pickerWidgets, ready: pickerWidgetsReady } = useSlotWidgets(
    starters.visible ? [STARTER_ZONE] : [],
  )
  // The picker's own answer to whether it draws anything, asked before the
  // start is drawn (a hidden first search while Create site decides), so a
  // workspace with no starters to offer — staff before any are listed
  // included — gets exactly the start it had before. `false` later, from the
  // picker on screen, draws the styles in its place.
  const [pickerVerdict, setPickerVerdict] = useState<boolean | null>(null)
  const pickerOffered = starters.visible && pickerWidgets.length > 0
  const pickerOn = pickerOffered && pickerVerdict === true
  // Opened from the start's starter choice, or straight away on the way back
  // from buying a starter.
  const [choosing, setChoosing] = useState(initialStarter !== null)
  const [starterMode, setStarterMode] = useState<SiteStarterMode>('base')
  const [starterSearch, setStarterSearch] = useState('')
  const [starterKind, setStarterKind] = useState<string | null>(null)
  const [pick, setPick] = useState<SiteStarterSummary | null>(null)
  // The pick being restored on the way back from paying for it, until the
  // picker hands it back (or it is cleared).
  const [restoring, setRestoring] = useState<SiteCreateStarterReturn | null>(initialStarter)
  // What the dialog knows about owning a pick better than the search does:
  // paid for just now (`true`), or still asked for payment (`false`).
  const [ownedOverride, setOwnedOverride] = useState<{ listingId: string; owned: boolean } | null>(
    initialStarter?.purchase === 'success' ? { listingId: initialStarter.listingId, owned: true } : null,
  )
  const [pickNotice, setPickNotice] = useState<string | null>(null)
  // The style chosen when the picker has nothing to offer and the styles are
  // drawn in its place.
  const [chooseStyle, setChooseStyle] = useState<string | null>(null)

  const resolving =
    (!widgetsReady ||
      !permissionsLoaded ||
      !orgReady ||
      (starters.visible && !pickerWidgetsReady) ||
      (pickerOffered && pickerVerdict === null)) &&
    !timedOut
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
    (
      start?: 'starter' | 'import',
      options: { style?: string; starter?: { listingId: string } } = {},
    ): Promise<CreateOutcome> => {
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
              // The style the person chose (AGL-4049): the starter's look,
              // and what the site records it was created with.
              ...(options.style ? { style: options.style } : {}),
              // A starter picked in "Choose your starter" (AGL-4049): the
              // site is born from that listing instead.
              ...(options.starter ? { starter: { listingId: options.starter.listingId } } : {}),
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
            // A refusal of the starter picked, not of the name (AGL-4049).
            const pickRefused = options.starter
              ? readSiteStarterPickRefusal(response.status, payload, options.starter.listingId)
              : null
            if (pickRefused) return { error, pick: pickRefused }
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
          // With what it was started with, as the site records it (AGL-4049),
          // so which styles people choose can be counted.
          trackEvent('host_created', hostCreatedEventParams(readHostStarterChoice(payload.starterChoice)))
          enqueueSnackbar(`Created "${address.name}"`, { variant: 'success', persist: false })
          const site: ConsoleCreatedSite = {
            hostId: String(payload.hostId),
            host: String(payload.subdomain ?? address.subdomain),
            // The workspace may have just been created for a first-time user,
            // so the response's slug outranks the (possibly null) current one.
            orgSlug: String(payload.orgSlug ?? orgSlug ?? ''),
          }
          const starterName =
            typeof payload.starter?.displayName === 'string' ? payload.starter.displayName : null
          return { site, ...(starterName ? { starterName } : {}) }
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
  // The style it asks (AGL-4049): none until a card is clicked.
  const [formStyle, setFormStyle] = useState<string | null>(null)
  const submitForm = useCallback(async () => {
    if (busy || !address.check() || !formStyle) return
    setBusy(true)
    try {
      // Always with the starter (AGL-3859). Without it the server makes the
      // site empty for a guided start this dialog never offered, and a person
      // who leaves before that start is answered is left with a site that has
      // nothing on it. In the style they chose (AGL-4049).
      const outcome = await requestCreate('starter', { style: formStyle })
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
  }, [address, busy, dashboardOf, enqueueSnackbar, formStyle, land, onClose, requestCreate])

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
      create: async (options?: { start?: 'import'; style?: string }) => {
        if (createdRef.current) return createdRef.current
        if (!address.check()) {
          return { error: 'Name your site and choose its address first.', address: true }
        }
        const outcome = await requestCreate(options?.start, { style: options?.style })
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

  // The starter site, in the style the person chose. Before the site exists
  // this creates it WITH the starter, in the one request, and only with a
  // style (AGL-4049): nothing is chosen for anyone, so without one nothing
  // is created. After a start created it and then could not begin, it gives
  // that site the starter, in the style its questions took when they took
  // one, so no site is left empty.
  const startBlank = useCallback(async (options?: { style?: string }): Promise<boolean> => {
    const style = options?.style
    const existing = createdRef.current
    if (existing) {
      const provisioned = await requestStarterSite(userRef.current, existing.hostId, { style })
      onClose()
      const dashboard = dashboardOf(existing)
      land(provisioned ? `${dashboard}?${SITE_START_PARAM}=${SITE_START_LIVE_VALUE}` : dashboard)
      return true
    }
    if (!style) {
      enqueueSnackbar('Choose a style for your site first.', { variant: 'warning', allowDuplicate: true })
      return false
    }
    if (!address.check()) return false
    const outcome = await requestCreate('starter', { style })
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

  // ── Choose your starter: the pick, and the create from it ───────────────
  const openChoose = useCallback(() => {
    setPickNotice(null)
    setChoosing(true)
  }, [])
  const pickOwned =
    pick && ownedOverride?.listingId === pick.listingId ? ownedOverride.owned : undefined
  // The pick the picker shows chosen: the person's own, or the one they come
  // back to after paying for it, which the picker hands back once it has
  // read it. Never one of ours.
  const selected = pick
    ? { listingId: pick.listingId, ...(pickOwned === undefined ? {} : { owned: pickOwned }) }
    : restoring
      ? {
          listingId: restoring.listingId,
          ...(ownedOverride?.listingId === restoring.listingId ? { owned: ownedOverride.owned } : {}),
        }
      : null
  const onPick = useCallback((next: SiteStarterSummary) => {
    setPickNotice(null)
    setRestoring(null)
    setPick(next)
    // A pick the picker restored can be of the other kind of starter: its tab
    // is shown, with it chosen.
    setStarterMode((current) => (next.facets?.mode && next.facets.mode !== current ? next.facets.mode : current))
    // The picker learned the workspace owns it (a payment that found it
    // bought already): that outranks an earlier "still asked for payment".
    if (next.owned === true) {
      setOwnedOverride((current) =>
        current?.listingId === next.listingId && !current.owned ? null : current,
      )
    }
  }, [])
  const pickerReady = useCallback((shown: boolean) => setPickerVerdict(shown), [])
  const changeStarterMode = useCallback((next: SiteStarterMode) => {
    // Another kind of starter is another list: what was picked in this one
    // is not carried across, so nothing is chosen that is not on screen.
    setStarterMode(next)
    setPick(null)
    setRestoring(null)
    setPickNotice(null)
  }, [])

  // The styles drawn in the picker's place create the starter site in the
  // style chosen, as the plain dialog does.
  const usingStyles = pickerVerdict === false
  const pickBlock = usingStyles ? (chooseStyle ? null : 'none') : siteStarterPickBlock(pick, pickOwned)
  const chooseBlocked: string | null = !address.usable
    ? 'Name your site and choose its address to create it.'
    : pickBlock === 'none'
      ? usingStyles
        ? 'Choose a style to create your site.'
        : 'Choose a starter to create your site.'
      : pickBlock === 'purchase'
        ? 'Buy this starter to create your site from it.'
        : null

  const createFromPick = useCallback(async () => {
    if (busy || !address.check()) return
    if (usingStyles) {
      if (!chooseStyle) return
      setBusy(true)
      try {
        await startBlank({ style: chooseStyle })
      } finally {
        setBusy(false)
      }
      return
    }
    if (!pick || siteStarterPickBlock(pick, pickOwned)) return
    setBusy(true)
    try {
      const outcome = await requestCreate('starter', { starter: { listingId: pick.listingId } })
      if ('error' in outcome) {
        if (outcome.pick) {
          const justPaid =
            initialStarter?.purchase === 'success' && initialStarter.listingId === pick.listingId
          if (outcome.pick.keep) {
            // Still asked for payment. Straight after paying, the payment is
            // being confirmed; otherwise it is a price to pay, and Buy shows.
            if (justPaid) {
              setPickNotice('Your payment is still being confirmed. Try Create site again in a moment.')
            } else {
              setOwnedOverride({ listingId: pick.listingId, owned: false })
              setPickNotice(outcome.pick.message)
            }
          } else {
            setPick(null)
            setRestoring(null)
            setPickNotice(outcome.pick.message)
          }
          return
        }
        return void enqueueSnackbar(outcome.error, {
          variant: outcome.address ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      // Its pages are published with the site, as the starter's always are.
      // Not for a site that starts in preview (AGL-4086).
      const inPreview = previewForRef.current('starter')
      if (!inPreview) trackEvent('site_published', { first_publish: true })
      onClose()
      if (!outcome.site.orgSlug) return
      if (inPreview) return land(dashboardOf(outcome.site))
      const live = new URLSearchParams({ [SITE_START_PARAM]: SITE_START_LIVE_VALUE })
      if (outcome.starterName) live.set(SITE_LIVE_STARTER_PARAM, outcome.starterName)
      land(`${dashboardOf(outcome.site)}?${live.toString()}`)
    } finally {
      setBusy(false)
    }
  }, [
    address,
    busy,
    chooseStyle,
    dashboardOf,
    enqueueSnackbar,
    initialStarter,
    land,
    onClose,
    pick,
    pickOwned,
    requestCreate,
    startBlank,
    usingStyles,
  ])

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
      // The starter path through "Choose your starter", where it is offered.
      {...(pickerOn ? { chooseStarter: openChoose } : {})}
    />
  ) : null

  const chooseView =
    currentOrg && orgSlug ? (
      <ChooseStarterDialog
        fields={address.fields}
        previewControl={
          <StartInPreviewSwitch
            checked={previewFor('starter')}
            onChange={setPreviewChoice}
            disabled={busy}
          />
        }
        mode={starterMode}
        onModeChange={changeStarterMode}
        // AI starters are filled by the AI start, offered only where it is.
        offersAi={mode === 'start' && !usingStyles}
        search={starterSearch}
        onSearchChange={setStarterSearch}
        kind={starterKind}
        onKindChange={setStarterKind}
        filters={!usingStyles}
        picker={
          usingStyles ? (
            <SiteStylePicker value={chooseStyle} onChange={setChooseStyle} />
          ) : (
            <PluginWidgetSlot
              slot={CONSOLE_WIDGET_SLOTS.hostStarterPicker}
              orgId={currentOrg.$id}
              orgSlug={orgSlug}
              mode={starterMode}
              search={starterSearch}
              filter={starterKind ? { kind: starterKind } : {}}
              onPick={onPick}
              ready={pickerReady}
              selected={selected}
            />
          )
        }
        notice={pickNotice}
        onDismissNotice={() => setPickNotice(null)}
        blocked={chooseBlocked}
        busy={busy}
        onCreate={() => void createFromPick()}
        onClose={onClose}
        // Back to the start it was opened from; the plain path has none.
        {...(mode === 'start' ? { onBack: () => setChoosing(false) } : {})}
        title={usingStyles ? CHOOSE_STARTER_COPY.styles.title : CHOOSE_STARTER_COPY.starters.title}
        lede={usingStyles ? CHOOSE_STARTER_COPY.styles.lede : CHOOSE_STARTER_COPY.starters.lede}
        staffPreview={starters.ready && starters.staffPreview}
      />
    ) : null

  // The picker's first answer, asked out of sight while Create site decides
  // which start to draw: the start is offered "Choose your starter" only
  // where it has starters to show.
  const pickerProbe =
    pickerOffered && pickerVerdict === null && currentOrg && orgSlug ? (
      <Box sx={{ display: 'none' }} aria-hidden data-create-area="starter-probe">
        <PluginWidgetSlot
          slot={CONSOLE_WIDGET_SLOTS.hostStarterPicker}
          orgId={currentOrg.$id}
          orgSlug={orgSlug}
          mode="base"
          search=""
          filter={{}}
          onPick={onPick}
          ready={pickerReady}
          selected={null}
        />
      </Box>
    ) : null

  // "Choose your starter" takes the start's place while it is open: the
  // site's name and address are asked in one place at a time, and Back draws
  // the start again on its first step, where they were typed.
  if (mode === 'start') return choosing && pickerOffered && pickerVerdict !== null ? chooseView : startZone

  // The start zone stays mounted while resolving: its widget is what gives
  // the verdict, as the picker's first search gives its own.
  if (mode === 'resolving') {
    return (
      <>
        {startZone}
        {pickerProbe}
      </>
    )
  }

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

  // With no start to offer, the starter path is the whole of Create site:
  // "Choose your starter" where its picker draws, the plain dialog where it
  // does not.
  if (pickerOn) return chooseView

  return (
    <Dialog
      open
      onClose={() => (busy ? null : onClose())}
      // Wide enough for the style cards (AGL-4049), scrolling inside.
      maxWidth="md"
      fullWidth
      scroll="paper"
      aria-labelledby="create-site-title"
    >
      <DialogTitle id="create-site-title">{'Create a new site'}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {previewFor('starter')
            ? `Your site starts in preview on its ${TENANT_APEX} subdomain; ` +
              'connect a custom domain any time from Setup.'
            : `Your site goes live on its ${TENANT_APEX} subdomain ` +
              'immediately; connect a custom domain any time from Setup.'}
        </Typography>
        {address.fields}
        <Typography variant="subtitle1" component="h2" sx={{ mt: 1 }}>
          {'Choose a style'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {'Your site starts with a home page, a header and a footer in the style you choose. ' +
            'You can change everything later.'}
        </Typography>
        <SiteStylePicker value={formStyle} onChange={setFormStyle} />
        <StartInPreviewSwitch
          checked={previewFor('starter')}
          onChange={setPreviewChoice}
          disabled={busy}
        />
      </DialogContent>
      <DialogActions>
        {formStyle ? null : (
          <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
            {'Choose a style to create your site.'}
          </Typography>
        )}
        <Button disabled={busy} onClick={onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!address.usable || !formStyle || busy}
          onClick={() => void submitForm()}
        >
          {busy ? 'Creating…' : 'Create site'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CreateHostDialog
