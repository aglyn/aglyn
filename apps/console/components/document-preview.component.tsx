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
import ConsentBannerUi from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { AglynNodeRenderer, useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  getGoogleFontsUrl,
  ThemeProvider,
  useThemeModeState,
} from '@aglyn/shared-ui-theme'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  CircularProgress,
  CssBaseline,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc as firestoreDoc,
  getDoc,
  getDocs,
  limit,
  query,
} from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import { useEffect, useMemo, useState } from 'react'
import {
  type PreviewKind,
  type PreviewStateIds,
  previewStateKey,
  readPreviewState,
} from '../constants/preview-state'
import firestoreOneShotRetry from '../utils/firestore-one-shot-retry'

const SUPPRESSED_SCREEN_LINKS = { suppressNavigation: true }

/**
 * How long the first paint may wait on the host-components read (AGL-1261).
 *
 * Generous — the graft is worth waiting for, and swapping a placeholder for
 * the real nav a beat later is the visible flash AGL-1211 set out to avoid.
 * It is a ceiling on a hang, not a latency budget.
 */
export const DEFINITIONS_TIMEOUT_MS = 8000

const KIND_LABEL: Record<PreviewKind, string> = {
  screen: 'screen',
  component: 'component',
  layout: 'layout',
  template: 'template',
}

/**
 * Region simulation for the consent banner (AGL-1498): "view my site
 * as-if-from the EU / the US / an unknown region / a GPC browser" without
 * leaving the console. Zach is in the US and would otherwise never see the
 * EU banner — "it works" needs a better answer than trust.
 *
 * It lives HERE, and only here, on purpose: the preview surface is
 * authenticated console UI, so the override can never reach an anonymous
 * visitor — a crafted link forcing `region=US` onto an EU visitor would
 * strip their banner, which is why published pages honor no such parameter
 * (the one published-page override, `?aglynConsent=ask`, moves TOWARD
 * strictness only). Same trust boundary as the `aglyn-tenant-host`
 * preview-override precedent.
 */
type ConsentSimulation = 'off' | 'eu' | 'us' | 'unknown' | 'gpc'

const CONSENT_SIMULATIONS: Array<{ value: ConsentSimulation; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'eu', label: 'EU visitor' },
  { value: 'us', label: 'US visitor' },
  { value: 'unknown', label: 'Unknown region' },
  { value: 'gpc', label: 'GPC browser' },
]

const SIMULATED_COUNTRY: Record<'eu' | 'us' | 'unknown', string | null> = {
  eu: 'DE',
  us: 'US',
  unknown: null,
}

export interface DocumentPreviewProps {
  ids?: PreviewStateIds | null
}

/**
 * Renders a besigner draft snapshot the way the live site would (AGL-1203).
 *
 * One surface for all four document kinds. Screens were the only kind with a
 * preview route; components, layouts and templates showed a Preview button
 * that did nothing. They render through the SAME renderer, theme, hidden-class
 * rule and site runtimes, so a mega-menu authored in a reusable component
 * opens on hover in its own preview exactly as it does on a screen.
 *
 * Snapshots travel through `localStorage`, so this works on localhost with no
 * deployment — the previous "preview" for a screen row opened a Vercel URL,
 * which 404s for anything not yet deployed.
 */
export function DocumentPreview(props: DocumentPreviewProps) {
  const { ids } = props
  const firestore = useFirestore()
  const [missing, setMissing] = useState(false)
  const [hostTheme, setHostTheme] = useState<Aglyn.AglynHostTheme | undefined>(
    undefined,
  )
  // Per-runtime page-props slices for the mounted site runtimes (AGL-830).
  // Preview has no server enricher, so each runtime rebuilds its own slice
  // client-side (e.g. marketing compiles the host's interactions), letting the
  // SAME runtimes the tenant uses drive hover menus/drawers in preview.
  const [runtimePages, setRuntimePages] = useState<
    Record<string, unknown>[] | null
  >(null)
  // Host reusable-component definitions, keyed by id (AGL-1211). `undefined`
  // means "still loading" — see the graft below for why we wait.
  const [definitions, setDefinitions] = useState<
    Record<string, Aglyn.ReusableComponentTree> | undefined
  >(undefined)
  // Consent-banner region simulation (AGL-1498); see ConsentSimulation.
  const [consentSim, setConsentSim] = useState<ConsentSimulation>('off')
  const [consentHost, setConsentHost] = useState<Aglyn.VisitorConsentHost | null>(
    null,
  )
  const [simDecision, setSimDecision] =
    useState<Aglyn.VisitorConsentStatus | null>(null)

  const hostId = ids?.hostId
  const kind = ids?.kind
  const docId = ids?.docId
  const versionId = ids?.versionId

  // The host's consent config (GA id + mode), read lazily the first time the
  // simulator is switched on — the default 'off' costs nothing.
  useEffect(() => {
    if (consentSim === 'off' || !hostId || !firestore || consentHost) {
      return undefined
    }
    let cancelled = false
    firestoreOneShotRetry(
      () => getDoc(firestoreDoc(firestore, 'hosts', hostId)),
      'consent-host',
    )
      .then((snapshot) => {
        if (cancelled) return
        setConsentHost((snapshot.data() as Aglyn.VisitorConsentHost) ?? {})
      })
      .catch(() => {
        if (!cancelled) setConsentHost({})
      })
    return () => {
      cancelled = true
    }
  }, [consentSim, hostId, firestore, consentHost])

  // The simulated visitor state, from the SAME resolution rules the tenant
  // hook applies — posture from `resolveConsentPosture`, implied recorded in
  // the opt-out posture, GPC as an automatic opt-out — so what the preview
  // shows is the rule, not a re-enactment of it. `simDecision` holds clicks
  // made inside the simulation; nothing is ever persisted.
  const consentPreview = useMemo(() => {
    if (consentSim === 'off' || !consentHost || !hostId) return null
    if (!Aglyn.hostConsentRequired(consentHost)) {
      return { required: false as const }
    }
    const now = Date.now()
    const country = consentSim === 'gpc' ? null : SIMULATED_COUNTRY[consentSim]
    let stored: Aglyn.StoredVisitorConsent | null = null
    let posture: Aglyn.VisitorConsentPosture | null = null
    if (simDecision) {
      stored = {
        v: 1,
        at: now,
        status: simDecision,
        analytics: Aglyn.analyticsGrantedByStatus(simDecision),
        country,
      }
    } else if (consentSim === 'gpc') {
      stored = {
        v: 1,
        at: now,
        status: 'gpc-opt-out',
        analytics: false,
        country,
      }
    } else {
      posture = Aglyn.resolveConsentPosture(consentHost, country)
      if (posture === 'opt-out') {
        stored = { v: 1, at: now, status: 'implied', analytics: true, country }
      }
    }
    return {
      required: true as const,
      stored,
      posture,
      country,
      allowed: Aglyn.isAnalyticsAllowed(consentHost, stored),
    }
  }, [consentSim, consentHost, hostId, simDecision])

  // Reusable-instance definitions (AGL-1211). The snapshot carries
  // `reusableInstance` nodes verbatim — the besigner composes the layout chain
  // but never grafts definitions, and the canvas deliberately doesn't either
  // (the named placeholder is the editor's UX). Only the tenant server did the
  // graft, so preview showed a dashed "SITE NAV" box where the live site shows
  // the nav. Mirrors `libs/tenant/runtime/src/lib/get-components.ts` and is
  // fail-open the same way: on error an empty map leaves instances as-is
  // rather than blanking the page.
  useEffect(() => {
    if (!hostId || !firestore) return
    let cancelled = false
    // The same short backoff every other one-shot read in the console gets
    // (AGL-1062): Firestore can deny the first read after sign-in, a beat
    // before the credential provider has attached the ID token — and a
    // preview tab opened by `window.open` is exactly a fresh sign-in race.
    firestoreOneShotRetry(
      () =>
        getDocs(
          query(
            collection(firestore, 'hosts', hostId, 'components'),
            limit(200),
          ),
        ),
      'components',
    )
      .then((res) => {
        if (cancelled) return
        const next: Record<string, Aglyn.ReusableComponentTree> = {}
        for (const docSnapshot of res.docs) {
          const value = docSnapshot.data() as Aglyn.AglynHostComponent
          if (value?.deletedAt || !value?.nodes || !value?.rootId) continue
          next[docSnapshot.id] = {
            rootId: value.rootId,
            nodes: value.nodes as Aglyn.ReusableComponentTree['nodes'],
            // Preview is a third render surface (AGL-1247): it must agree
            // with the tenant about each instance's prop values.
            ...(value.props?.length && { props: value.props }),
          }
        }
        setDefinitions(next)
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setDefinitions({})
      })
    // A read that never SETTLES is the case the `.catch` above cannot cover,
    // and it is the one that produced "Preview opens a tab that never
    // finishes loading": with `definitions` still `undefined` the apply
    // effect below returns early forever, so the page paints nothing at all —
    // no snapshot, no message, no spinner. A one-shot `getDocs` has no
    // timeout of its own and can hang indefinitely (offline, a wedged
    // WebChannel, a multi-tab persistence lease held by a frozen tab).
    //
    // So bound it, and fail OPEN exactly like the error path already does:
    // an empty definitions map leaves `reusableInstance` nodes as their named
    // placeholder, which is the AGL-1211 behaviour — strictly better than a
    // blank tab, and it self-corrects if the read lands afterwards.
    const timer = setTimeout(() => {
      if (cancelled) return
      setDefinitions((current) => {
        if (current) return current
        console.warn(
          `[preview] the host components read did not settle within ` +
            `${DEFINITIONS_TIMEOUT_MS}ms — rendering without reusable-component ` +
            'definitions rather than holding a blank page.',
        )
        return {}
      })
    }, DEFINITIONS_TIMEOUT_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [hostId, firestore])

  useEffect(() => {
    if (!hostId || !kind || !docId) return
    // Wait for the definitions read to settle before the first paint. Grafting
    // with a "loading" empty map would render the placeholder and then swap it
    // for the real nav a beat later — a visible flash of chrome that the live
    // site never shows.
    if (!definitions) return
    const resolved: PreviewStateIds = { hostId, kind, docId, versionId }

    const applyState = () => {
      const state = readPreviewState(resolved)
      if (!state) {
        setMissing(true)
        return
      }
      setMissing(false)
      setHostTheme(state.theme)
      Aglyn.canvas.setNodes(
        Aglyn.canvas.processNodesToDenormalized(
          Aglyn.composeReusableComponentNodes(
            state.nodes as any,
            definitions as any,
          ) as any,
        ),
      )
    }
    applyState()

    // Re-apply when the besigner tab writes a fresh snapshot, so an already
    // open preview tab reflects the latest Preview click immediately.
    const handleStorage = (event: StorageEvent) => {
      if (event.key === previewStateKey(resolved)) applyState()
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [hostId, kind, docId, versionId, definitions])

  // Interactions parity (AGL-830): mount the registered site runtimes exactly
  // like the tenant page, each fed the page-props slice it rebuilds
  // client-side. Actions are host-scoped and delegated at the document level,
  // so this loads once — a fresh node snapshot re-renders the DOM but the
  // armed listeners still match.
  useEffect(() => {
    if (!hostId || !firestore) return
    let cancelled = false
    const runtimes = Aglyn.listSiteRuntimes()
    Promise.all(
      runtimes.map((runtime) =>
        runtime.loadPreviewProps
          ? runtime.loadPreviewProps({ hostId, firestore }).catch(() => ({}))
          : Promise.resolve({}),
      ),
    ).then((pages) => {
      if (!cancelled) setRuntimePages(pages)
    })
    return () => {
      cancelled = true
    }
  }, [hostId, firestore])

  // The site identity every plugin block reads (AGL-1139). Memoised because
  // it is a context value: a fresh object each render would re-render every
  // block on every keystroke elsewhere on the page.
  const siteContext = useMemo(
    () => ({ hostId, preview: true }),
    [hostId],
  )

  // One message for every refused write, rather than thirteen blocks each
  // inventing their own. `useSiteFetch` announces the refusal; this is the
  // only thing listening, so a block that has not migrated cannot produce a
  // half-answer here — it simply does nothing, which is the pre-existing
  // behaviour rather than a new lie.
  const [blocked, setBlocked] = useState<string | null>(null)
  useEffect(() => {
    const handler = () =>
      setBlocked(
        'That works on the published site. Preview shows your real content ' +
          'but never changes it.',
      )
    window.addEventListener(Aglyn.PREVIEW_WRITE_BLOCKED_EVENT, handler)
    return () =>
      window.removeEventListener(Aglyn.PREVIEW_WRITE_BLOCKED_EVENT, handler)
  }, [])

  const root = Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)
  // Style like the live site: the snapshot carries the host theme, and the
  // scheme resolves from the shared cookie + prefers-color-scheme state so
  // the preview goes dark exactly when the tenant site would.
  const [[, themeMode]] = useThemeModeState()
  const scheme = themeMode === 'dark' ? 'dark' : 'light'
  const siteTheme = useAglynSiteTheme({ theme: hostTheme, scheme })
  const fontsHref = getGoogleFontsUrl(hostTheme?.fonts)

  if (missing) {
    return (
      <Stack
        sx={{
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: 1,
        }}
      >
        <Typography variant="h6">{'No preview state found'}</Typography>
        <Typography color="text.secondary">
          {`Open this ${KIND_LABEL[kind ?? 'screen']} in the besigner and click Preview again.`}
        </Typography>
      </Stack>
    )
  }

  // Say so, rather than painting white (AGL-1261). Everything above this can
  // legitimately take a moment — the components read, the host-id resolution
  // that supplies `ids`, the snapshot apply — and the old code rendered an
  // empty document throughout, which is indistinguishable from a tab that
  // will never load. The bounded read above means this state is temporary
  // even when Firestore never answers.
  if (!root) {
    return (
      <Stack
        sx={{
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography color="text.secondary">
          {`Preparing the ${KIND_LABEL[kind ?? 'screen']} preview…`}
        </Typography>
      </Stack>
    )
  }

  return (
    <ThemeProvider theme={siteTheme}>
      {fontsHref ? (
        <>
          <link
            key="host-fonts-preconnect"
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link key="host-fonts" rel="stylesheet" href={fontsHref} />
        </>
      ) : null}
      <CssBaseline enableColorScheme />
      {/* Shared hidden-class rule (AGL-562/830): the tenant page ships this in
          its SSR HTML so author-hidden elements (a mega-menu panel carries the
          class to start closed) paint hidden from the first frame. Preview
          renders the same nodes, so it ships the same rule — without it the
          panel is stuck open. */}
      <style>{Aglyn.ELEMENT_HIDDEN_STYLE_TEXT}</style>
      {root ? (
        // Preview renders draft state outside the tenant site: screen links
        // show their content but must not navigate the console origin.
        // suppressNavigation only — NOT editorInert — so interactions run for
        // real and hover-to-open menus behave like the live site (AGL-830).
        <Aglyn.ScreenLinkContext.Provider value={SUPPRESSED_SCREEN_LINKS}>
          {/* The site's identity, which Preview knew all along and never
              passed on (AGL-1139). Thirty `if (!hostId)` guards across the
              plugin blocks took their placeholder branch without it, so a
              shop previewed as a grid of dashed boxes — and the cart, being
              inert markup rather than a broken button, had nothing to click.
              `preview` rides alongside so `useSiteFetch` can refuse the
              writes that same hostId now makes possible. */}
          <Aglyn.SiteContext.Provider value={siteContext}>
            <AglynNodeRenderer node={root} />
          </Aglyn.SiteContext.Provider>
        </Aglyn.ScreenLinkContext.Provider>
      ) : null}
      <Snackbar
        open={Boolean(blocked)}
        autoHideDuration={5000}
        onClose={() => setBlocked(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={() => setBlocked(null)}>
          {blocked}
        </Alert>
      </Snackbar>
      {/* Site runtimes (AGL-419/830): the marketing automations engine arms
          the authored hover/click triggers and drives the menu/drawer command
          buses — the same components the tenant catch-all mounts. */}
      {runtimePages
        ? Aglyn.listSiteRuntimes().map((runtime, index) => (
            <runtime.Component
              key={runtime.runtimeId}
              hostId={hostId as string}
              page={runtimePages[index] ?? {}}
            />
          ))
        : null}
      {/* Consent region simulator (AGL-1498) — see ConsentSimulation. The
          picker is console chrome; the banner below it is the REAL shared
          component the tenant mounts, fed simulated state, so what Zach
          sees is what an EU/US/unknown/GPC visitor gets. */}
      <Paper
        elevation={4}
        sx={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 2147483500,
          padding: 1.5,
          width: 250,
        }}
      >
        <Stack spacing={1}>
          <TextField
            select
            size="small"
            label="Consent preview"
            value={consentSim}
            onChange={(event) => {
              setSimDecision(null)
              setConsentSim(event.target.value as ConsentSimulation)
            }}
          >
            {CONSENT_SIMULATIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          {consentPreview ? (
            consentPreview.required ? (
              <Typography
                variant="caption"
                color={
                  consentPreview.allowed ? 'warning.main' : 'text.secondary'
                }
              >
                {(consentPreview.allowed
                  ? 'Google Analytics: WOULD LOAD'
                  : 'Google Analytics: blocked') +
                  (consentPreview.stored
                    ? ` — recorded "${consentPreview.stored.status}"`
                    : ' — awaiting the visitor choice') +
                  '. Simulated: nothing is saved.'}
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {'No analytics configured (or the consent tool is off) — ' +
                  'no consent UI renders on this site.'}
              </Typography>
            )
          ) : consentSim !== 'off' ? (
            <Typography variant="caption" color="text.secondary">
              {'Loading site consent settings…'}
            </Typography>
          ) : null}
        </Stack>
      </Paper>
      {consentPreview?.required && hostId ? (
        <ConsentBannerUi
          hostId={hostId}
          stored={consentPreview.stored}
          posture={consentPreview.posture}
          country={consentPreview.country}
          onDecision={setSimDecision}
        />
      ) : null}
    </ThemeProvider>
  )
}

export default observer(DocumentPreview)
