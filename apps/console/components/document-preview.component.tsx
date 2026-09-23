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
// Deep, like the line above and for the same reason (AGL-2486): the theme
// resolver is not on the client barrel, and the besigner editors reach it by
// this same path. One resolver for every surface that draws a site's
// appearance, so a fallback preview cannot style differently from the editor.
import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
// Deep import for the same reason as `consent-banner-ui` above (AGL-2486):
// the plugin-manager barrel is server-reachable and this hook is not.
import { PluginStyles } from '@aglyn/aglyn/plugin-manager/plugin-styles-ui'
import { AglynNodeRenderer, useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
// Deep, not the designer barrel: Preview renders no besigner.
import { useMediaAssetFactsOverlay } from '@aglyn/besigner-ui/hooks/use-media-asset-facts-overlay'
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
import BesignerMediaAssetFactsProvider from './besigner-media-asset-facts-provider.component'
import { useDeclareDocumentSubject } from './document-subject'

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
  form: 'form',
}

/**
 * The host-scoped collection each previewable kind's PARENT document lives in
 * (AGL-2551), i.e. `hosts/{hostId}/{collection}/{docId}`.
 *
 * Spelled out rather than pluralized from the kind. The two are equal today
 * and the map is one line longer for it, but a kind whose collection is not
 * `kind + 's'` would otherwise read a path that does not exist and fail as a
 * missing name — silently, since the name is optional decoration on this
 * surface.
 */
const KIND_COLLECTION: Record<PreviewKind, string> = {
  screen: 'screens',
  component: 'components',
  layout: 'layouts',
  template: 'templates',
  form: 'forms',
}

/**
 * Region simulation for the consent banner (AGL-1498): "view my site
 * as-if-from the EU / the US / an unknown region / a GPC browser" without
 * leaving the console. An author sitting in one region never sees the banner
 * any other region gets, and "it works" needs a better answer than trust.
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

/**
 * Where the simulator's own chrome sits in the stack (AGL-2486).
 *
 * Without a raised value here, the region picker's own menu paints UNDER this
 * panel's helper text. Both elements are direct children of `<body>` and both
 * are positioned, so they share the root stacking context and the numbers
 * really are comparable — measured in the preview, the panel resolves to
 * 2147483500 and MUI's portalled menu to `theme.zIndex.modal`, i.e. 1300.
 * Nothing exotic: the menu has no value that could clear the panel it belongs
 * to.
 *
 * The panel's own number stays what it was, because it is load-bearing against
 * a ladder that lives OUTSIDE this component — the consent banner (2147483400)
 * and the "Your Privacy Choices" pill (2147483390) in `consent-banner-ui.tsx`,
 * and the marketing popup backdrop (2147483200). Those are deliberately near
 * the ceiling because on a published page they must beat arbitrary customer
 * content, and the preview renders that same page. Naming it here rather than
 * leaving a bare literal is the whole change.
 *
 * Transient chrome that must clear the panel takes `theme.zIndex.max` — the
 * scale's existing ceiling token, already used by `SplashScreen` and
 * `LoadingModal`, rather than a fresh literal invented one higher than
 * whatever was in the way. It reaches this component through the SITE theme,
 * which merges `consoleOptions` as its base, so the token resolves here.
 */
const PREVIEW_PANEL_Z_INDEX = 2147483500

/**
 * The stack for the picker's menu and the snackbar, as an `sx` fragment.
 *
 * The snackbar has the same defect and the same cause: MUI gives it
 * `theme.zIndex.snackbar` (1400) and anchors it bottom-centre, which is
 * exactly where the consent banner sits at 2147483400 — so the one Alert the
 * preview uses to explain why a click did nothing was rendering behind the
 * banner that click was about.
 */
const ABOVE_PREVIEW_CHROME = { zIndex: 'max' } as const

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
function DocumentPreviewSurface(props: DocumentPreviewProps) {
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
  // The published design of each form entity, keyed by id, on the same
  // "`undefined` means still loading" contract. Read beside the definitions
  // because a placed form resolves the same way an instance does, and Preview
  // has to agree with the tenant about both.
  const [formDesigns, setFormDesigns] = useState<
    Record<string, Aglyn.PlacedFormDesign> | undefined
  >(undefined)
  // The snapshot as composed and denormalized, before the placed assets'
  // current DAM facts are laid over it (AGL-2849, AGL-2856).
  const [composed, setComposed] = useState<
    Record<string, unknown> | undefined
  >(undefined)
  /**
   * The site document, read once per preview (AGL-2881).
   *
   * `{{host.*}}` tokens resolve from it, as the published page resolves them
   * from the same document, and the consent simulator reads the site's config
   * off the same read. `undefined` while the read is outstanding, which holds
   * the first paint the way the definitions do, so a token never flashes as
   * written. `null` when the read failed, timed out or found nothing: the
   * tokens then render as written, because an absent site has no values and a
   * blank would hide that a variable is there.
   */
  const [hostDoc, setHostDoc] = useState<
    Record<string, unknown> | null | undefined
  >(undefined)
  // Consent-banner region simulation (AGL-1498); see ConsentSimulation.
  const [consentSim, setConsentSim] = useState<ConsentSimulation>('off')
  // A click made inside the simulation. Carries the ADVERTISING answer as well
  // as the status (AGL-2486): `ConsentBannerUi` reports both through
  // `onDecision`, and dropping the second argument meant ticking the
  // advertising box in preview changed nothing the panel could show.
  const [simDecision, setSimDecision] = useState<{
    status: Aglyn.VisitorConsentStatus
    advertising: boolean
  } | null>(null)

  /**
   * The PARENT document of the thing being previewed (AGL-2551, AGL-3204).
   *
   * One read, three readers: its `displayName` titles the browser tab, and
   * the resolver below takes its version pointer, its definition root and its
   * layout binding off the same snapshot. `undefined` while the read is
   * outstanding; `null` once it has failed or found nothing.
   */
  const [parentDoc, setParentDoc] = useState<
    Record<string, unknown> | null | undefined
  >(undefined)
  // Stays `undefined` while the read is outstanding, and stays that way if
  // the document has no name — see `useDeclareDocumentSubject` below.
  const subjectName = (parentDoc as { displayName?: string } | null | undefined)
    ?.displayName

  /**
   * The document as STORED, for a preview opened without a snapshot
   * (AGL-3204) — the composed canvas tree, not the raw `nodes` field.
   *
   * `undefined` while the reads are outstanding, `null` once they have
   * settled on nothing renderable. The difference matters: one holds the
   * spinner, the other prints the refusal.
   */
  const [storedNodes, setStoredNodes] = useState<
    Aglyn.NodesMap | null | undefined
  >(undefined)

  const hostId = ids?.hostId
  const kind = ids?.kind
  const docId = ids?.docId
  const versionId = ids?.versionId

  /**
   * The tab names WHICH document is open, not just its site (AGL-2486).
   *
   * The besigner routes get this for free: they already hold the document, so
   * they hand its `displayName` to `useDeclareDocumentSubject` and the id the
   * server put in the title is swapped for the name. Preview held nothing to
   * hand over — the snapshot in `localStorage` carries `nodes` and `theme` and
   * no name — so all five preview routes shipped titling themselves with the
   * raw id (AGL-2551). That is not a fallback firing; it was the only title
   * the route could produce.
   *
   * So the name is read here, once, from the PARENT document rather than the
   * version: `displayName` is a property of the screen/component/layout/
   * template/form, and `AglynScreenVersion` has no such field — unlike
   * `layoutId`, which really is version-first and is resolved that way by the
   * besigner and the tenant runtime alike. Reading the version for a name
   * would find nothing on every document there is.
   *
   * One document read, on a surface that already reads the host, its
   * component definitions and its form designs before it can paint. A failure
   * is swallowed: an unnamed preview tab is the behavior that shipped, and
   * the id title underneath it is still unique per document.
   *
   * ## …and, without a snapshot, WHAT it renders (AGL-3204)
   *
   * AGL-1203 gave this surface a single source: a `localStorage` snapshot the
   * besigner writes just before opening the tab. Nothing else writes that
   * key, and five surfaces link straight at a preview route — a version row's
   * Preview, the layouts/components/templates/forms cards — so all of them,
   * plus any pasted or bookmarked preview URL, landed on "No preview state
   * found". That was not a fallback firing; it was the only thing the route
   * could produce for a reader who had not just pressed Preview in the editor.
   *
   * So the snapshot becomes the optimization it reads as. It still wins, and
   * has to: it is the only thing that can carry besigner edits that were
   * never saved. Without one, the stored document is read and rendered —
   * the version the URL names, or the one the document currently points at.
   *
   * Resolved HERE rather than in an effect of its own because the first read
   * is this one. The parent carries the name, the version pointer, the
   * definition root and the layout binding, so on the snapshot path nothing
   * below runs and the read profile is exactly what it was.
   */
  useEffect(() => {
    if (!firestore || !hostId || !kind || !docId) return undefined
    let cancelled = false
    const collectionName = KIND_COLLECTION[kind]

    /**
     * The layout chain above a screen, walked as the besigner walks it
     * before writing a snapshot (AGL-703): a layout may itself render inside
     * another, and a screen preview that dropped the outer chrome would be a
     * different kind of wrong from the one being fixed here.
     *
     * Walked rather than subscribed because the chain's length is only known
     * by walking it. Fail-open at every step, exactly as the besigner's own
     * walk is — a preview is worth showing without its outer chrome, and it
     * is not worth failing over.
     */
    const readLayoutChain = async (binding: unknown) => {
      const chain: Aglyn.LayoutChainEntry[] = []
      const seen = new Set<string>()
      let layoutId = binding
      while (
        layoutId &&
        !seen.has(String(layoutId)) &&
        chain.length < Aglyn.MAX_LAYOUT_CHAIN_DEPTH
      ) {
        seen.add(String(layoutId))
        try {
          const layout = await getDoc(
            firestoreDoc(firestore, 'hosts', hostId, 'layouts', String(layoutId)),
          )
          const layoutVersionId = layout.get('versionId')
          if (!layoutVersionId) break
          const version = await getDoc(
            firestoreDoc(
              firestore,
              'hosts',
              hostId,
              'layouts',
              String(layoutId),
              'versions',
              String(layoutVersionId),
            ),
          )
          chain.push({
            layoutId: String(layoutId),
            // Decoded (AGL-1397). These reads carry no converter, so every
            // ancestor arrives as `Bytes` and composes to nothing — the
            // preview loses its outer chrome silently.
            nodes: Aglyn.decodeStoredNodes(version.get('nodes')) as any,
            // The layout's properties (AGL-2893), applied with this version's
            // values exactly as the published page applies them.
            props: version.get('props'),
          })
          layoutId = layout.get('layoutId')
        } catch (error) {
          console.error(error)
          break
        }
      }
      return chain
    }

    const resolve = async () => {
      let parent: Record<string, unknown> | null
      try {
        const snapshot = await firestoreOneShotRetry(
          () =>
            getDoc(
              firestoreDoc(firestore, 'hosts', hostId, collectionName, docId),
            ),
          'preview-subject',
        )
        parent = (snapshot.data() as Record<string, unknown> | undefined) ?? null
      } catch {
        parent = null
      }
      if (cancelled) return
      setParentDoc(parent)

      /**
       * The snapshot wins, so nothing below is read when there is one — the
       * besigner path costs exactly what it cost before this change.
       *
       * `null` rather than left `undefined`: it means "no fallback was
       * resolved", which is what `applyState` needs to hear. Left undefined
       * it would read as "still reading", so the ceiling below would warn
       * about a read nobody started, and a snapshot EVICTED while this tab
       * is open (the budget in `writePreviewState` allows exactly that)
       * would hold a spinner instead of saying what it said before.
       */
      if (readPreviewState({ hostId, kind, docId, versionId })) {
        setStoredNodes(null)
        return
      }

      // A template versions but never publishes, so its tree lives on the
      // document itself and its route carries no version segment.
      let raw: unknown = kind === 'template' ? parent?.nodes : undefined
      let rootId = parent?.rootId
      let layoutBinding = parent?.layoutId
      let layoutPropValues: unknown
      let layoutStyleOverrides: unknown

      if (kind !== 'template') {
        // The version the URL names, or — for a link that named none — the
        // one this document currently points at.
        const version = versionId ?? (parent?.versionId as string | undefined)
        if (!version) {
          if (!cancelled) setStoredNodes(null)
          return
        }
        let data: Record<string, unknown> | undefined
        try {
          const snapshot = await firestoreOneShotRetry(
            () =>
              getDoc(
                firestoreDoc(
                  firestore,
                  'hosts',
                  hostId,
                  collectionName,
                  docId,
                  'versions',
                  version,
                ),
              ),
            'preview-version',
          )
          data = snapshot.data() as Record<string, unknown> | undefined
        } catch (error) {
          console.error(error)
          if (!cancelled) setStoredNodes(null)
          return
        }
        if (cancelled) return
        raw = data?.nodes
        // A component's and a form's definition root is written on the
        // VERSION; the parent's is the fallback for one saved before it was.
        rootId = data?.rootId ?? rootId
        layoutPropValues = data?.layoutPropValues
        // The page's restyling of its layout's elements (AGL-3286).
        layoutStyleOverrides = data?.layoutStyleOverrides
        // Version-first with a document fallback — the rule the besigner and
        // `composeScreenNodes` both follow. A key PRESENT on the version
        // wins, because a `null` there means explicitly no layout.
        if (data && 'layoutId' in data) layoutBinding = data.layoutId
      }

      const decoded = Aglyn.decodeStoredNodes<Aglyn.NodesMap>(raw)
      if (!decoded || !Object.keys(decoded).length) {
        setStoredNodes(null)
        return
      }
      // A component, a form and a component-kind template are stored as a
      // DEFINITION rooted at the promoted node, and the canvas needs the
      // canonical root or it renders nothing (AGL-680). A tree that already
      // carries one passes straight through, so this is safe for the kinds
      // that never wrap.
      const tree = Aglyn.definitionToCanvasTree({
        rootId: rootId as string | undefined,
        nodes: decoded,
      }) as Aglyn.NodesMap

      if (kind !== 'screen') {
        setStoredNodes(tree)
        return
      }
      const chain = await readLayoutChain(layoutBinding)
      if (cancelled) return
      setStoredNodes(
        Aglyn.composeLayoutChainWithProps(
          chain as any,
          tree as any,
          layoutPropValues as any,
          layoutStyleOverrides,
        ) as Aglyn.NodesMap,
      )
    }

    resolve().catch((error) => {
      console.error(error)
      if (!cancelled) setStoredNodes(null)
    })

    /**
     * The same ceiling the host reads get, for the same reason (AGL-1261): a
     * one-shot read has no timeout of its own, and while `storedNodes` is
     * `undefined` the apply effect returns early — so a wedged read would
     * hold the spinner forever, which is the blank tab in a new costume.
     * Fail open to the refusal, which is at least a true statement.
     */
    const timer = setTimeout(() => {
      if (cancelled) return
      setStoredNodes((current) => {
        if (current !== undefined) return current
        console.warn(
          `[preview] the stored-document read did not settle within ` +
            `${DEFINITIONS_TIMEOUT_MS}ms — saying so rather than holding a ` +
            'spinner that never resolves.',
        )
        return null
      })
    }, DEFINITIONS_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [firestore, hostId, kind, docId, versionId])

  // Unconditional, and tolerant of a name that has not arrived: until one
  // does, the hook leaves the server's id title alone rather than blanking the
  // subject. Clears on unmount so closing a preview cannot strand its name in
  // a tab that has navigated elsewhere.
  useDeclareDocumentSubject(docId, subjectName)

  // The host's consent config (GA id + mode), off the site read, once the
  // simulator is switched on. A read that failed simulates a site with no
  // consent configured.
  const consentHost = useMemo<Aglyn.VisitorConsentHost | null>(
    () =>
      consentSim === 'off' || hostDoc === undefined
        ? null
        : ((hostDoc ?? {}) as Aglyn.VisitorConsentHost),
    [consentSim, hostDoc],
  )

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
    // Whether this site asks the advertising question at all (AGL-1649). The
    // banner needs it to render the second checkbox, and the verdict below
    // needs it to say anything true about advertising.
    const asksAds = Aglyn.hostAsksAboutAdvertising(consentHost)
    let stored: Aglyn.StoredVisitorConsent | null = null
    let posture: Aglyn.VisitorConsentPosture | null = null
    if (simDecision) {
      stored = {
        v: 1,
        at: now,
        status: simDecision.status,
        analytics: Aglyn.analyticsGrantedByStatus(simDecision.status),
        country,
        // Only ever recorded on a site that ASKED — the same condition the
        // tenant applies before writing a grant, so the simulated record
        // cannot claim a decision the visitor was never offered.
        ...(asksAds ? { advertising: simDecision.advertising } : {}),
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
        stored = {
          v: 1,
          at: now,
          status: 'implied',
          analytics: true,
          country,
          // ANALYTICS ONLY, because that is exactly what
          // `decideVisitorConsent` writes: the implied default carries no
          // advertising grant. AGL-2402 briefly made this `advertising:
          // asksAds`; narrowed back on 2026-08-24 with the engine.
          //
          // The preview has to mirror the WRITE, not just end up at the same
          // verdict. `adsAllowed` below re-derives through
          // `advertisingGrantedByRecord`, which refuses `implied` either way —
          // so a stale `true` here would not change the verdict, and would
          // instead sit in the simulated record OVERSTATING what a US visitor
          // gets to anything that reads the record itself.
        }
      }
    }
    return {
      required: true as const,
      stored,
      posture,
      country,
      asksAds,
      allowed: Aglyn.isAnalyticsAllowed(consentHost, stored),
      // The advertising verdict, from the SAME predicate the tenant gates the
      // tags with — not a re-derivation that could drift from it.
      adsAllowed: Aglyn.advertisingGrantedByRecord(consentHost, stored),
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
          // BOTH stored forms (AGL-1151), mirroring `get-components.ts`: this
          // surface has to agree with the tenant about what each definition
          // contains, and a raw read agrees with nothing.
          const nodes = Aglyn.decodeStoredNodes<
            Aglyn.ReusableComponentTree['nodes']
          >(value.nodes)
          if (!nodes) continue
          next[docSnapshot.id] = {
            rootId: value.rootId,
            nodes,
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

    // Form entities (`docs/specs/reusable-forms.md`), read the same way and
    // failing open the same way: an empty map leaves each placed form
    // rendering the fields the document itself holds, which is what Preview
    // showed before entities existed.
    firestoreOneShotRetry(
      () =>
        getDocs(
          query(collection(firestore, 'hosts', hostId, 'forms'), limit(200)),
        ),
      'forms',
    )
      .then((res) => {
        if (cancelled) return
        const next: Record<string, Aglyn.PlacedFormDesign> = {}
        for (const docSnapshot of res.docs) {
          const value = docSnapshot.data() as Aglyn.FormDocument
          if (!value?.nodes || !value?.rootId) continue
          // BOTH stored forms (AGL-1151), mirroring `get-forms.ts`.
          const nodes = Aglyn.decodeStoredNodes<
            NonNullable<Aglyn.FormDocument['nodes']>
          >(value.nodes)
          if (!nodes?.[value.rootId]) continue
          next[docSnapshot.id] = { rootId: value.rootId, nodes }
        }
        setFormDesigns(next)
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setFormDesigns({})
      })

    // The site document (AGL-2881), read beside them for the same reason: the
    // first paint waits on it, and the tenant composes with it.
    firestoreOneShotRetry(
      () => getDoc(firestoreDoc(firestore, 'hosts', hostId)),
      'host',
    )
      .then((snapshot) => {
        if (cancelled) return
        setHostDoc(
          (snapshot.data() as Record<string, unknown> | undefined) ?? null,
        )
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setHostDoc(null)
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
      // The forms read is gated by the same apply effect, so a hang there
      // holds the tab blank exactly as a hung components read would.
      setFormDesigns((current) => {
        if (current) return current
        console.warn(
          `[preview] the host forms read did not settle within ` +
            `${DEFINITIONS_TIMEOUT_MS}ms — rendering each placed form from ` +
            'the document itself rather than holding a blank page.',
        )
        return {}
      })
      // The site read gates the same apply, under the same ceiling.
      setHostDoc((current) => {
        if (current !== undefined) return current
        console.warn(
          `[preview] the host read did not settle within ` +
            `${DEFINITIONS_TIMEOUT_MS}ms — rendering host variables as ` +
            'written rather than holding a blank page.',
        )
        return null
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
    // site never shows. The site read holds it for the same reason: a host
    // variable drawn as its token and then as its value is that flash again.
    if (!definitions || !formDesigns || hostDoc === undefined) return
    const previewableFormDesigns =
      kind === 'form' && docId && docId in formDesigns
        ? Object.fromEntries(
            Object.entries(formDesigns).filter(([id]) => id !== docId),
          )
        : formDesigns
    const resolved: PreviewStateIds = { hostId, kind, docId, versionId }

    const applyState = () => {
      const state = readPreviewState(resolved)
      // The snapshot first — it is the only source that can carry besigner
      // edits which were never saved — then the document as stored
      // (AGL-3204).
      const nodes = state?.nodes ?? storedNodes
      if (!nodes) {
        // `undefined` means the stored read has not answered yet. Holding
        // the spinner is right; calling it missing would flash the refusal
        // over a preview that is about to work.
        if (storedNodes === undefined) return
        setMissing(true)
        return
      }
      setMissing(false)
      /**
       * The snapshot carries the theme it was taken with. Without one it
       * resolves from the site document this surface ALREADY read for
       * `{{host.*}}` tokens, through the same function the besigner calls
       * before it writes a snapshot (AGL-1021) — so the fallback costs no
       * read of its own, and a preview opened from a version row is styled
       * like the live site instead of dropping to MUI's default blue.
       */
      setHostTheme(state?.theme ?? resolveSiteTheme(hostDoc as any))
      const grafted = Aglyn.composeReusableComponentNodes(
        nodes as any,
        definitions as any,
        // Placed forms resolve here too, in the SAME call the tenant makes
        // — one graft that expands a component inside a form design and a
        // form inside a component, in either nesting order.
        //
        // Except the form being PREVIEWED. `checkFormContract` requires a
        // form design's `form` node to name its own form, so previewing a
        // form finds itself in the map — and would render the published
        // version in place of the draft this preview exists to show.
        [Aglyn.placedFormPlacement(previewableFormDesigns as any)],
      )
      setComposed(
        Aglyn.canvas.processNodesToDenormalized(
          // Host variables (AGL-2881) resolve over the GRAFTED tree, through
          // the function the tenant composes with, so a token inside a
          // component, a form or the layout chrome fills in as the page's
          // own do — and a field the site has not set renders as nothing,
          // exactly as it does for a visitor.
          (hostDoc
            ? Aglyn.resolveNodesHostTokens(grafted as any, hostDoc)
            : grafted) as any,
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
  }, [
    hostId,
    kind,
    docId,
    versionId,
    definitions,
    formDesigns,
    hostDoc,
    storedNodes,
  ])

  // A placed asset's shape, and a film's length and poster, as its DAM
  // document records them NOW (AGL-2849, AGL-2856), laid over the tree Preview
  // renders. The tenant's composition takes the same step last, on the tree a
  // published page ships, so a replace shows here as it shows to a visitor.
  // Until the asset's document answers, and if the read fails, the snapshot
  // renders as stored.
  const shownNodes = useMediaAssetFactsOverlay(composed)
  useEffect(() => {
    if (shownNodes) Aglyn.canvas.setNodes(shownNodes as any)
  }, [shownNodes])

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
        {/*
         * Retitled with the fallback (AGL-3204). "No preview state found"
         * named an implementation detail — the `localStorage` key — and the
         * line under it prescribed the workaround for the defect itself:
         * open the besigner, press Preview, come back. Now that the stored
         * document renders, this appears only when there genuinely is no
         * saved version to draw, and it says that instead.
         */}
        <Typography variant="h6">{'Nothing to preview yet'}</Typography>
        <Typography color="text.secondary">
          {`This ${KIND_LABEL[kind ?? 'screen']} has no saved version to render.`}
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
      {/* Plugin stylesheets (AGL-2486), same reasoning as the hidden-class
          rule above: Preview renders the same nodes as the published page, so
          it ships the same plugin CSS in the same unlayered slot. `document`
          scope — Preview is NOT shadow-rooted, so a mirrored sheet is already
          applying to it from the console document's own head. */}
      <PluginStyles scope="document" />
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
        // Same defect as the picker's menu: bottom-centre is where the consent
        // banner sits, and 1400 loses to it (AGL-2486).
        sx={ABOVE_PREVIEW_CHROME}
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
          component the tenant mounts, fed simulated state, so what the author
          sees is what an EU/US/unknown/GPC visitor gets. */}
      <Paper
        elevation={4}
        sx={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: PREVIEW_PANEL_Z_INDEX,
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
            // The menu portals to `<body>`, so it does NOT inherit the panel's
            // stack and has to be told (AGL-2486). `slotProps.select`, not the
            // `SelectProps` this would have been written as — MUI removed that
            // one, and on v9 it is silently ignored rather than rejected, so
            // the wrong spelling looks exactly like a fix that did not work.
            slotProps={{ select: { MenuProps: { sx: ABOVE_PREVIEW_CHROME } } }}
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
                  // The advertising verdict, reported only where the site asks
                  // very caption; it named one category because it only ever
                  // knew about one.
                  (consentPreview.asksAds
                    ? consentPreview.adsAllowed
                      ? '. Advertising storage: GRANTED'
                      : '. Advertising storage: denied'
                    : '. Advertising: not asked on this site') +
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
          // AGL-2486. This prop's own doc comment names the console preview as
          // the reason it exists ("resolved by the caller from the host
          // document, because this component is also mounted by the console
          // preview against a simulated host") — and the console preview was
          // the one caller that never passed it, so the preview rendered the
          // analytics-only banner on every site, including sites that DO ask.
          advertising={consentPreview.asksAds}
          onDecision={(status, advertising) =>
            setSimDecision({ status, advertising: advertising === true })
          }
        />
      ) : null}
    </ThemeProvider>
  )
}

const ObservedDocumentPreviewSurface = observer(DocumentPreviewSurface)

/**
 * Preview, with the site's placed images and films answering from their DAM
 * documents (AGL-2849, AGL-2856) through the provider the besigner canvas
 * mounts.
 */
export function DocumentPreview(props: DocumentPreviewProps) {
  return (
    <BesignerMediaAssetFactsProvider hostId={props.ids?.hostId ?? ''}>
      <ObservedDocumentPreviewSurface {...props} />
    </BesignerMediaAssetFactsProvider>
  )
}

export default DocumentPreview
