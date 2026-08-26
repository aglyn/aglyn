/**
 * @license
 * Copyright 2024 Aglyn LLC
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
  isFirstPublishedRoute,
  trackEvent,
} from '@aglyn/aglyn/app-utils/analytics-events'
import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import {
  besignerDocsUrl,
  BesignerConflictAlertComponent,
  BesignerDraftAlertComponent,
  describeComponentPropagation,
  recoverableRoomSessions,
  LayoutChromeContext,
  PropertiesDialogComponent,
  useAddElementDrawerCallback,
  useBesignerDocument,
  useComponentPropagationNotice,
  useRenderedCanvasElements,
  useLayoutChromeCanvas,
  withBesignerContext,
  type BesignerSaveBaseline,
  type ComponentPropagationChange,
  type WorkspaceEditorComponentProps,
  clearServerDraft,
  writeServerDraft,
} from '@aglyn/besigner-ui'
// import '@aglyn/foundation-feature-singleton'
import {
  HAS_BROWSER,
  ICON_VARIANT_APP_SETTINGS,
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { AppLink, HelpTip, useLoading } from '@aglyn/shared-ui-jsx'
import { LOADING_OVERLAY_ELEMENT } from '@aglyn/shared-ui-jsx/const/prebuilt-components'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import {
  saveNodesGuarded,
  useHost,
  useHostActivityLogger,
  useLayout,
  useLayoutVersion,
  useScreen,
  useScreenVersion,
  useScreenVersionRef,
  writeGuardedBySeed,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  getDoc,
  limit,
  query,
} from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Dynamic site-plugin activation (AGL-417): canvas components register
// via the org-gated loader; the page gates the canvas on readiness.
import { withSitePlugins } from '../../../../../../../../../../components/console-plugins-gate.component'
import BesignerFunctionsButton from '../../../../../../../../../../components/besigner-functions-button.component'
import BindingPickerProvider from '../../../../../../../../../../components/binding-picker-provider.component'
import InteractionsProvider from '../../../../../../../../../../components/interactions-provider.component'
import usePluginDrawerRegistration from '../../../../../../../../../../hooks/use-plugin-drawer-registration'
import BesignerMediaPickerProvider from '../../../../../../../../../../components/besigner-media-picker-provider.component'
import ScreenSocialImageField from '../../../../../../../../../../components/screen-social-image-field.component'
import BesignerAppBarComponent from '../../../../../../../../../../components/besigner-app-bar.component'
import BesignerDocumentSwitcherComponent from '../../../../../../../../../../components/besigner-document-switcher.component'
import BesignerVersionsComponent, {
  type BesignerVersionsActions,
} from '../../../../../../../../../../components/besigner-versions.component'
import EntityPickerProvider from '../../../../../../../../../../components/entity-picker-provider.component'
import revalidateLivePages from '../../../../../../../../../../utils/revalidate-live-pages'
import ReusableComponentsProvider from '../../../../../../../../../../components/reusable-components-provider.component'
import AuthenticatedLayout from '../../../../../../../../../../components/layouts/authenticated.layout'
import MainLayout from '../../../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../../../constants/app-setup'
import {
  previewWindowName,
  writePreviewState,
} from '../../../../../../../../../../constants/preview-state'
import {
  buildRoute,
  Route,
} from '../../../../../../../../../../constants/route-links'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'
import { syncScreenRouteEntries } from '../../../../../../../../../../constants/screen-publishing'
import {
  buildScreenSeoUpdate,
  type ScreenSocialImageDraft,
} from '../../../../../../../../../../constants/screen-seo'
import { resolveScreenLiveUrl } from '../../../../../../../../../../constants/tenant-links'
import {
  collectionTemplatePublishMessage,
  collectionTemplateRoutesSummary,
} from '../../../../../../../../../../constants/collection-templates'
import useCollectionTemplates from '../../../../../../../../../../hooks/use-collection-templates'
import useScreenLinkRoutes from '../../../../../../../../../../hooks/use-screen-link-routes'
import useFirestoreCollection from '../../../../../../../../../../hooks/use-firestore-collection'
import useHostComponentDefinitions from '../../../../../../../../../../hooks/use-host-component-definitions'
import usePresence from '../../../../../../../../../../hooks/use-presence'
import useCoEditing from '../../../../../../../../../../hooks/use-coediting'
import PresenceAvatars from '../../../../../../../../../../components/presence-avatars.component'
import CollaboratorOverlays from '../../../../../../../../../../components/collaborator-overlays.component'
import useHostRole from '../../../../../../../../../../hooks/use-host-role'
import { useDeclareDocumentSubject } from '../../../../../../../../../../components/document-subject'

const WorkspaceEditorComponent = dynamic<WorkspaceEditorComponentProps>(
  () =>
    import('@aglyn/besigner-ui').then((mod) => mod.WorkspaceEditorComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const ViewportRootComponent = dynamic<WorkspaceEditorComponentProps>(
  () => import('@aglyn/besigner-ui').then((mod) => mod.ViewportRootComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const ViewportCanvasComponent = dynamic<WorkspaceEditorComponentProps>(
  () => import('@aglyn/besigner-ui').then((mod) => mod.ViewportCanvasComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const JsonEditor = dynamic<JsonEditorProps>(
  () => import('@aglyn/shared-ui-json-editor').then((mod) => mod.JsonEditor),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)

function BesignerPage(props) {
  const params = useParams<{
    host: string
    screenId: string
    versionId: string
  }>()
  const hostId = useHostId()
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string
  const { enqueueSnackbar } = useSnackbar()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { queueLoading } = useLoading()
  const logActivity = useHostActivityLogger(hostId)
  // The `author` host role edits content and may NOT publish it (AGL-2334).
  // Disabled with a reason rather than hidden, so the console says no instead
  // of the rules answering with a bare `permission-denied`.
  const { canPublish, loaded: hostRoleLoaded } = useHostRole(hostId)
  const publishBlock = hostRoleLoaded
    ? 'Your role on this site can edit content but not publish it'
    : 'Checking your access…'
  // Who else is in this document (AGL-675). Fails quiet — an editor that
  // will not open because nobody could be listed is far worse than an
  // empty avatar stack.
  // Selection rides presence so collaborators can see what you have picked;
  // `Besigner.focus` is a mobx store and this page is an observer, so this
  // re-renders (and re-broadcasts) as the selection moves.
  const selectedNodeId = Besigner.focus.getLastSelected()?.$id
  const clearMirrorRef = useRef<(() => void) | undefined>(undefined)
  // The canvas element registry is how presence anchors a cursor and the
  // overlays anchor a selection box — the canvas renders into shadow roots,
  // so nothing here can be found with a document query.
  const { elements: canvasElements } = useRenderedCanvasElements()
  const getCanvasRoot = useCallback(
    () => canvasElements.current?.[Aglyn.CANVAS_ROOT_ELEMENT_ID]?.node,
    [canvasElements],
  )
  const presence = usePresence({
    hostId,
    docType: 'screen',
    docId: screenId,
    versionId,
    selectedNodeId,
    broadcastCursor: true,
    getCanvasRoot,
  })
  const [screenDialog, setScreenDialog] = useState(false)
  // Screen SEO fields (SEO Toolkit); null = untouched, falls back to doc.
  const [seoTitle, setSeoTitle] = useState<string | null>(null)
  const [seoDescription, setSeoDescription] = useState<string | null>(null)
  /**
   * Staged social image (AGL-1337); null = untouched. The staging contract
   * travels with the type — see `ScreenSocialImageDraft`.
   */
  const [seoImage, setSeoImage] = useState<ScreenSocialImageDraft | null>(null)
  // Screen password protection (AGL-87); null = untouched.
  const [protectPassword, setProtectPassword] = useState<string | null>(null)
  const handleAddElementClick = useAddElementDrawerCallback()
  // File ▸ New version drives the versions panel's own create flow (AGL-1218)
  // rather than re-implementing the entitlement gate and the save-first rule.
  const versionsActions = useRef<BesignerVersionsActions>(null)
  // Installed plugins appear as named drawer entries (AGL-190).
  usePluginDrawerRegistration(hostId)
  const detailUrl = buildRoute(Route.SCREEN_DETAILS, {
    orgSlug,
    host: host as string,
    screenId: screenId as string,
    versionId: versionId as string,
  })
  const { data: user } = useUser()
  const { doc: hostResult } = useHost({ hostId: hostId as string })
  const { doc: screenResult, setDoc: updateScreenDoc } = useScreen({
    hostId,
    screenId,
  })
  // The browser tab names THIS document, not just its site (AGL-2486).
  // The server put the id in the title; this swaps in the loaded name.
  useDeclareDocumentSubject(screenId, screenResult?.data?.displayName)
  const layoutId = screenResult?.data?.layoutId
  const firestore = useFirestore()
  /**
   * Is the version being edited the one the site is SERVING?
   *
   * Zach: "versions should not have a draft, only the current live version
   * should be able to have a draft." That is the whole gate. A non-live
   * version is already a place to work without touching the live site — that
   * is what versions are for — so a draft there would be a second answer to a
   * question that already has one, offering a distinction with nothing behind
   * it. On the live version there is no other way to work without publishing,
   * which is exactly why the draft belongs here and only here.
   */
  const editingLiveVersion = Boolean(
    versionId && versionId === screenResult?.data?.versionId,
  )
  const { doc: layoutResult } = useLayout({
    hostId,
    layoutId: layoutId ?? '-no-layout-',
  })
  const layoutVersionId = layoutResult?.data?.versionId
  const { doc: layoutVersionResult } = useLayoutVersion({
    hostId,
    layoutId: layoutId ?? '-no-layout-',
    versionId: layoutVersionId ?? '-no-version-',
  })
  // Layout chrome renders the host's reusable components for real (AGL-1217)
  // — the same graft the tenant runtime and Preview (AGL-1211) run. Held back
  // until the definitions settle: building the chrome canvas without them
  // paints the dashed "SITE NAV" placeholder and swaps it for the nav a beat
  // later, and the canvas is rebuilt wholesale per node map anyway.
  const { definitions: componentDefinitions, docs: componentDocs } =
    useHostComponentDefinitions(hostId)
  const chromeCanvas = useLayoutChromeCanvas(
    layoutId && componentDefinitions
      ? layoutVersionResult?.data?.nodes
      : undefined,
    componentDefinitions,
  )
  const { doc: result } = useScreenVersion({
    hostId: hostId as string,
    screenId: screenId as string,
    versionId: versionId as string,
  })
  const screenVersionRef = useScreenVersionRef({
    hostId: hostId as string,
    screenId: screenId as string,
    versionId: versionId as string,
  })
  const { data, status, error, hasPendingWrites } = result
  const nodes = data?.nodes

  // Say so when a component on this page changed under the author
  // (AGL-1898 phase 2). The re-graft itself already happened — the
  // definitions listener above is the whole transport — but a component
  // edit is usually too small to notice, so without a word the author
  // cannot tell a working propagation from one they have not published
  // yet. No extra reads: this is derived from the snapshot stream the
  // canvas already consumes.
  //
  // The LAYOUT's nodes are watched alongside the screen's because the
  // component an author goes off to edit is most often the site nav, which
  // lives in the layout chrome rather than on the screen.
  const componentNames = useMemo(
    () =>
      Object.fromEntries(
        (componentDocs ?? []).map((definition) => [
          definition.$id,
          definition.displayName,
        ]),
      ),
    [componentDocs],
  )
  const handleComponentPropagation = useCallback(
    (changes: ComponentPropagationChange[]) =>
      void enqueueSnackbar(describeComponentPropagation(changes), {
        variant: 'info',
        persist: false,
      }),
    [enqueueSnackbar],
  )
  useComponentPropagationNotice({
    documents: [
      nodes as Record<string, unknown> | undefined,
      layoutVersionResult?.data?.nodes as Record<string, unknown> | undefined,
    ],
    definitions: componentDefinitions,
    names: componentNames,
    onPropagated: handleComponentPropagation,
  })

  const screenKind = screenResult?.data?.kind

  // Conditional write (AGL-1301): the transaction re-checks the baseline
  // against what Firestore actually holds, so a save racing another writer's
  // commit aborts server-side instead of clobbering it — the listener-based
  // AGL-674 guard alone cannot see a write whose snapshot has not arrived.
  const saveScreenVersion = useCallback(
    async (
      nextNodes: Record<string, unknown>,
      baseline?: BesignerSaveBaseline,
    ) => {
      await saveNodesGuarded(
        screenVersionRef,
        { nodes: nextNodes as unknown as Aglyn.AglynScreenVersion['nodes'] },
        baseline,
      )
    },
    [screenVersionRef],
  )

  // Canvas lifecycle, first load, concurrent-write detection (AGL-674) and
  // the size-guarded save (AGL-678) are shared by every besigner editor
  // (AGL-746). What stays in this route is what is actually about a screen
  // belonging to a host — SEO, password protection, publishing, layout
  // chrome and the live URL.
  const {
    saveAvailable,
    remoteChanged,
    draft,
    handleSave,
    jsonOpen,
    openJsonEditor,
    closeJsonEditor,
    handleJsonSave,
    hasError,
    notFound,
  } = useBesignerDocument({
    nodes,
    updatedAt: (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    pendingWrites: hasPendingWrites,
    status,
    error,
    save: saveScreenVersion,
    noun: 'screen',
    // Email documents (kind 'email', AGL-395) restrict the component drawer
    // to the email plugin's email-safe blocks.
    viewType:
      screenKind === 'email'
        ? Aglyn.HostViewType.EMAIL
        : Aglyn.HostViewType.SCREEN,
    documentKey: `${hostId}:${screenId}:${versionId}`,
    draft: {
      scope: hostId,
      kind: 'screen',
      docId: screenId,
      versionId,
    },
    // Turns on the SHARED working draft beside the local crash net: it is what
    // `handleSaveDraft` writes, and what the restore prompt now prefers.
    // Undefined off the live version, so that editor keeps the local crash net
    // alone and never offers a draft that should not exist there.
    firestore: editingLiveVersion ? firestore : undefined,
    // The crash-recovery prompt is withheld while anyone else is in this
    // room (AGL-2486): the mirror already has the unsaved work, so there is
    // nothing to recover and both of its buttons could only take something
    // away. Presence, not the mirror alone, because a colleague who has the
    // document open but has not typed since we joined publishes nothing.
    roomSessions: recoverableRoomSessions(
      presence.status,
      presence.entries.length,
    ),
    notify: enqueueSnackbar,
    // Tell the author what happens next when they are editing the LIVE
    // version. Without it the only feedback is "saved", the live page keeps
    // serving cached HTML for a moment, and the rational response is to save
    // again — which is the loop this message and the revalidate call above
    // exist to end together. A draft save says nothing about the live site,
    // because it does not touch it.
    savedMessage:
      versionId && versionId === screenResult?.data?.versionId
        ? 'Screen saved — your live page is refreshing now'
        : undefined,
    queueLoading,
    onSaved: () => {
      // Records that the write LANDED (AGL-1152), for `Save & publish`.
      // `handleSave` resolves `void` whether it wrote or refused — a size
      // guard, a concurrent edit, or nothing-to-save all return early — and
      // `saveAvailable` is React state that is still stale in the same tick.
      // Making a version live after a refused save would publish bytes that
      // were never stored.
      savedLandedRef.current = true
      // A save makes Firestore authoritative again, so the live mirror of
      // unsaved work has to go — otherwise the next person to join replays
      // edits that are already in the document. Via a ref because the
      // co-editing engine is created below this hook: it needs the stamp
      // this hook resolves.
      clearMirrorRef.current?.()
      // Editing the PUBLISHED version edits the live site, so the live page's
      // cached HTML is stale the moment this returns (AGL-1150 wired this to
      // publish only). Without it the author saves, refreshes, sees the old
      // page, and saves again — which is the loop this exists to end, and the
      // reason "did my change go out?" was never answerable from the editor.
      // Editing a DRAFT version changes nothing live, so it drops nothing.
      if (versionId && versionId === screenResult?.data?.versionId) {
        // Best effort and deliberately not awaited: the save has already
        // succeeded, and a cache hint that fails must never make a successful
        // save look failed. The revalidate window remains the backstop.
        void revalidateLivePages({ user, hostId, screenId })
      }
      return logActivity('Saved the screen', {
        type: 'screen',
        id: screenId,
        name: screenResult?.data?.displayName,
        versionId,
      })
    },
  })

  // Live co-editing (AGL-677). Rides the presence session's authenticated
  // RTDB app rather than brokering a second token.
  const coediting = useCoEditing({
    session: presence.session,
    docType: 'screen',
    docId: screenId,
    versionId,
    storedStamp: (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    loaded: Aglyn.canvas.didSetInitial,
  })
  clearMirrorRef.current = coediting.clearMirror

  // Publishing a collection's list/entry template is what makes the compose
  // pipeline use it, but the template is not a page of the site (AGL-1267):
  // its routing-map slug 404s, so nothing here may name it (AGL-1269).
  const collectionTemplates = useCollectionTemplates(hostId)
  const { templateScreenIds, routesByScreenId } = collectionTemplates
  // AGL-1271: a template's live URL is decided by the collection that
  // renders it, not its own (dropped) routing-map entry.
  const { url: liveUrl, unavailableReason: liveUnavailableReason } = useMemo(
    () =>
      resolveScreenLiveUrl(hostResult?.data, screenId, {
        isTemplate: templateScreenIds.has(screenId),
        routes: routesByScreenId.get(screenId),
      }),
    [hostResult?.data, screenId, templateScreenIds, routesByScreenId],
  )
  // The site's theme with this site's overrides resolved over it
  // (AGL-1021). The editor must render exactly what the tenant will.
  const hostTheme = useMemo(
    () => resolveSiteTheme(hostResult?.data),
    [hostResult?.data],
  )
  const hostFontsHref = useMemo(
    () => getGoogleFontsUrl(hostTheme?.fonts),
    [hostTheme?.fonts],
  )
  const { data: layoutOptions } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'layouts'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const chromeContextValue = useMemo(() => ({ chromeCanvas }), [chromeCanvas])

  const handleProtectionSave = useCallback(async () => {
    if (protectPassword == null) return
    const value = protectPassword.trim()
    let update: Record<string, unknown>
    if (!value) {
      update = { protection: deleteField() as any }
    } else {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value),
      )
      const passwordHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      update = { protection: { passwordHash } }
    }
    await updateScreenDoc(update as any)
      .then(() => {
        enqueueSnackbar(
          value ? 'Password protection enabled' : 'Password protection removed',
          { variant: 'success', persist: false },
        )
        setProtectPassword(null)
      })
      .catch((e) => {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
          variant: 'error',
          allowDuplicate: true,
        })
      })
  }, [protectPassword, updateScreenDoc, enqueueSnackbar])

  const handleSeoSave = useCallback(async () => {
    /**
     * Shared with the screen detail page's SEO card (AGL-1437).
     *
     * This panel used to build the map itself and DEFAULT the social-image
     * triple — `image: existing.image ?? ''` with `0`/`0` dimensions — so
     * saving a description on a screen with no social image added three keys
     * the document never had. `/careers` stored exactly `{ description,
     * title }`; a save here made it five, and an `image: ''` beside `0`×`0`
     * makes a screen look like it has an authored social card to every reader
     * that checks presence rather than truthiness.
     */
    const seo = buildScreenSeoUpdate((screenResult?.data as any)?.seo, {
      title: seoTitle,
      description: seoDescription,
      image: seoImage,
    })
    /**
     * Refuse a save whose seed the server never confirmed (AGL-1358).
     *
     * This handler was the twin AGL-1358's sweep of ~126 call sites missed.
     * Carrying `existing` forward is what makes it that shape: it is
     * `screenResult.data.seo` off the screen LISTENER, and `updateDoc`
     * REPLACES a nested map, so a cached seed reinstates that snapshot's
     * title, description and social image while the author believes they
     * edited one field — including writing a stale `image` over a newer one
     * this tab never displayed.
     *
     * The guard WRAPS the write; an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'SEO settings',
        unreadable: screenResult?.status === 'error',
        fromCache: screenResult?.fromCache,
      },
      async () => {
        // An emptied map is removed rather than stored blank — an empty `seo`
        // reads back as an authored-but-blank record.
        await updateScreenDoc({ seo: seo ?? (deleteField() as any) } as any)
          .then(() => {
            enqueueSnackbar('SEO saved', { variant: 'success', persist: false })
            setSeoTitle(null)
            setSeoDescription(null)
            setSeoImage(null)
          })
          .catch((e) => {
            enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
              variant: 'error',
              allowDuplicate: true,
            })
          })
      },
    )
    // A refusal leaves the staged title, description and image where they
    // are, with Save SEO still live.
    if (!verdict.ok) {
      enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
    }
  }, [
    updateScreenDoc,
    screenResult,
    seoTitle,
    seoDescription,
    seoImage,
    enqueueSnackbar,
  ])

  const handleLayoutChange = useCallback(
    async (event) => {
      const value = event.target.value as string
      const nextLayoutId = value === '__none__' ? undefined : value
      await updateScreenDoc({
        layoutId: nextLayoutId ?? (deleteField() as any),
      } as any)
        .then(() => {
          enqueueSnackbar(nextLayoutId ? 'Layout assigned' : 'Layout removed', {
            variant: 'success',
            persist: false,
          })
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
            variant: 'error',
            allowDuplicate: true,
          })
        })
    },
    [updateScreenDoc, enqueueSnackbar],
  )

  // Publishing: the tenant site only serves paths present in the host's
  // `screens` routing map. The routed path composes ancestor slugs (parent
  // `company` + own `about` → /company/about), so slug and parent changes
  // must rewrite this screen's entry AND every descendant's.
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screensById = useMemo(() => {
    const map: Record<
      string,
      Aglyn.ScreenRouteNode & { displayName?: string }
    > = {}
    for (const screen of screenDocs ?? []) {
      map[screen.$id] = {
        slug: screen.slug,
        parentId: screen.parentId,
        displayName: screen.displayName,
      }
    }
    return map
  }, [screenDocs])
  const routingMap = hostResult?.data?.screens as
    Record<string, string> | undefined

  const isCollectionTemplate = templateScreenIds.has(screenId)
  const templateRoutes = collectionTemplateRoutesSummary(
    routesByScreenId.get(screenId),
  )

  const publishedPath = routingMap?.[screenId]
  const parentId = screenResult?.data?.parentId
  const [slugInput, setSlugInput] = useState<string | null>(null)
  const slugValue = slugInput ?? screenResult?.data?.slug ?? publishedPath ?? ''
  const normalizedSlug = Aglyn.normalizeScreenSlug(slugValue)
  // Candidate map with the pending slug applied, so the composed path and
  // conflict check reflect what Publish would write.
  const candidateById = useMemo(
    () => ({
      ...screensById,
      [screenId]: {
        ...screensById[screenId],
        slug: normalizedSlug,
        parentId,
      },
    }),
    [screensById, screenId, normalizedSlug, parentId],
  )
  const composedPath = normalizedSlug
    ? Aglyn.composeScreenRoutePath(screenId, candidateById)
    : undefined
  const slugOwner = composedPath
    ? Aglyn.findScreenIdByRoutePath(routingMap, composedPath)
    : undefined
  const slugConflict = Boolean(slugOwner && slugOwner !== screenId)
  const unpublishedAncestor = Boolean(normalizedSlug && !composedPath)
  // An address the published site cannot answer, whatever the routing map says
  // (AGL-2076). Read off the COMPOSED path so a `search` nested under a parent
  // — `docs/search`, which serves fine — is not refused with it.
  const reservedSegment = Aglyn.reservedScreenRouteSegment(
    composedPath ?? normalizedSlug,
  )

  // Routing entries for this screen plus all descendants under a candidate
  // screens map; null removes entries whose chain no longer resolves.
  const buildRouteEntries = useCallback(
    (byId: Record<string, Aglyn.ScreenRouteNode | undefined>) =>
      Aglyn.buildScreenRouteEntries(screenId, byId, routingMap),
    [screenId, routingMap],
  )

  /** Did the last save actually land? See `onSaved`. */
  const savedLandedRef = useRef(false)
  /**
   * A draft has been saved and NOT yet published.
   *
   * The app bar's three states describe the LIVE SITE, not the canvas, which
   * is the correction Zach asked for the first time round — "Is up to date
   * accurate if they saved the draft but they did not save and publish?".
   * It was not, and it would be wrong again here for a new reason: on the live
   * version `versionId === screens/{id}.versionId` is true by definition, so
   * the pointer alone reports "Up to date" while a draft sits unpublished
   * beside it. The draft is the thing that makes the site out of date.
   */
  const [draftPending, setDraftPending] = useState(false)

  /**
   * SAVE THE WORKING DRAFT (AGL-1152).
   *
   * Zach: "Save draft seemed to save and publish at the same time for screens,
   * we need both". It did, and the menu said the opposite — "Keeps your work;
   * the live site is unchanged" — while the toast said the live page was
   * refreshing. Both were describing the same call.
   *
   * The cause was not the wiring but the target: on the version a screen is
   * SERVING, the document an author edits IS the live one, so any write to it
   * is a publish. There is no honest way to save that document without
   * publishing it, which is why the draft now goes somewhere else entirely —
   * its own document beside the version, never read by the tenant.
   *
   * The mirror is cleared for the same reason a real save clears it: Firestore
   * is authoritative again, and replaying in-flight keystrokes over a draft
   * that already contains them would re-apply them.
   */
  const handleSaveDraft = useCallback(async () => {
    const nodes = Aglyn.canvas.toJSON().nodes as Aglyn.ProcessableNodes
    const wrote = await writeServerDraft(
      firestore,
      { scope: hostId, kind: 'screen', docId: screenId, versionId },
      {
        nodes,
        baseStamp: Aglyn.versionStamp(screenResult?.data?.updatedAt),
        updatedByUid: user?.uid ?? null,
        updatedByEmail: user?.email ?? null,
      },
    ).catch(() => false)
    if (!wrote) {
      enqueueSnackbar('Could not save the draft — your work is still here.', {
        variant: 'error',
        persist: false,
      })
      return
    }
    clearMirrorRef.current?.()
    setDraftPending(true)
    enqueueSnackbar('Draft saved — the live site is unchanged.', {
      variant: 'success',
      persist: false,
    })
  }, [
    firestore,
    hostId,
    screenId,
    versionId,
    screenResult?.data?.updatedAt,
    user,
    enqueueSnackbar,
  ])

  /**
   * SAVE, THEN MAKE THIS VERSION THE LIVE ONE (AGL-1152).
   *
   * A screen's tree lives on its VERSION document and the tenant reads
   * `screens/{id}/versions/{versionId}`, so saving the version an author is on
   * is only live if that version is the one `screens/{id}.versionId` points
   * at. Saving a draft version changes nothing a visitor can see — which is
   * the whole point of a draft, and also why an author working in one needs a
   * way to say "this one, now" without leaving the editor.
   *
   * Already on the published version, this is a save plus a cache drop, which
   * `onSaved` was already doing — so the action is the same shape either way
   * and the author does not have to know which case they are in.
   */
  const handleSaveAndPublish = useCallback(async () => {
    savedLandedRef.current = false
    await handleSave()
    if (!savedLandedRef.current) return
    const livePointer = screenResult?.data?.versionId
    if (livePointer !== versionId) {
      await updateScreenDoc({ versionId } as any)
    }
    // Not awaited: the writes above have already succeeded, and a cache hint
    // that fails must never make a completed publish look failed.
    void revalidateLivePages({ user, hostId, screenId })
    // The draft has been published, so it must stop being offered — otherwise
    // the next open invites the author to restore the state they just moved
    // past. Best effort, like the cache drop above.
    void clearServerDraft(firestore, {
      scope: hostId,
      kind: 'screen',
      docId: screenId,
      versionId,
    })
    setDraftPending(false)
    enqueueSnackbar(
      livePointer === versionId
        ? 'Saved and published — the live pages are refreshing now.'
        : 'Published this version — it is now what the live site serves.',
      { variant: 'success', persist: false },
    )
  }, [
    handleSave,
    screenResult?.data?.versionId,
    versionId,
    updateScreenDoc,
    user,
    hostId,
    screenId,
    enqueueSnackbar,
  ])

  const handlePublish = useCallback(async () => {
    if (slugConflict || unpublishedAncestor || reservedSegment) return
    // Captured BEFORE the writes below (AGL-1588). `routingMap` is a live
    // subscription with latency compensation, so by the time the write chain
    // resolves the snapshot has already grown the entry being added — reading
    // it down there would answer `false` for a genuine first publish. The
    // stale closure happens to preserve the old value today; that is an
    // accident of `useCallback` identity, not something to depend on.
    const firstPublish = isFirstPublishedRoute(routingMap)
    const action =
      normalizedSlug && composedPath
        ? updateScreenDoc({ slug: normalizedSlug } as any)
            .then(() =>
              syncScreenRouteEntries(
                firestore,
                hostId,
                buildRouteEntries(candidateById),
              ),
            )
            .then(() => {
              // Only when the screen was not already live (AGL-1561): this
              // same handler re-syncs the routing map when someone merely
              // RENAMES the path of an already-published screen, and a rename
              // is not an activation.
              if (!publishedPath) {
                trackEvent('site_published', { first_publish: firstPublish })
              }
              setSlugInput(null)
              enqueueSnackbar(
                collectionTemplatePublishMessage(
                  routesByScreenId.get(screenId),
                  { isTemplateScreen: isCollectionTemplate },
                ) ?? `Published at ${Aglyn.screenRoutePathToUrl(composedPath)}`,
                { variant: 'success', persist: false },
              )
            })
        : updateScreenDoc({ slug: deleteField() } as any)
            .then(() =>
              syncScreenRouteEntries(
                firestore,
                hostId,
                buildRouteEntries({
                  ...screensById,
                  [screenId]: {
                    ...screensById[screenId],
                    slug: undefined,
                    parentId,
                  },
                }),
              ),
            )
            .then(() => {
              setSlugInput(null)
              enqueueSnackbar('Screen unpublished', {
                variant: 'success',
                persist: false,
              })
            })
    await action.catch((e) => {
      enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    })
  }, [
    slugConflict,
    unpublishedAncestor,
    reservedSegment,
    normalizedSlug,
    composedPath,
    candidateById,
    screensById,
    parentId,
    buildRouteEntries,
    updateScreenDoc,
    firestore,
    hostId,
    screenId,
    enqueueSnackbar,
    isCollectionTemplate,
    publishedPath,
    routesByScreenId,
  ])

  // One-click publish from the app bar (AGL-452). Publish points the live
  // site at the version being edited AND registers the routing entry;
  // Unpublish removes the routing entry but keeps the slug on the doc so
  // re-publishing is one click. The Properties dialog remains the place to
  // change the path itself.
  const handleTogglePublish = useCallback(async () => {
    try {
      if (publishedPath) {
        await syncScreenRouteEntries(
          firestore,
          hostId,
          buildRouteEntries({
            ...screensById,
            [screenId]: {
              ...screensById[screenId],
              slug: undefined,
              parentId,
            },
          }),
        )
        enqueueSnackbar('Screen unpublished', {
          variant: 'success',
          persist: false,
        })
        return
      }
      if (!normalizedSlug) {
        setScreenDialog(true)
        enqueueSnackbar('Set the screen path to publish it', {
          variant: 'info',
          persist: false,
        })
        return
      }
      if (slugConflict || unpublishedAncestor || reservedSegment) {
        enqueueSnackbar(
          slugConflict
            ? 'Another screen is already published at this path'
            : reservedSegment
              ? Aglyn.reservedScreenRouteMessage(reservedSegment)
              : 'Publish the parent screen first',
          { variant: 'warning', persist: false },
        )
        return
      }
      // Read before the two writes below, for the reason given in
      // `handlePublish`: the live routing map grows this entry as soon as the
      // sync lands (AGL-1588).
      const firstPublish = isFirstPublishedRoute(routingMap)
      await updateScreenDoc({ slug: normalizedSlug, versionId } as any)
      await syncScreenRouteEntries(
        firestore,
        hostId,
        buildRouteEntries(candidateById),
      )
      // The one-click publish (AGL-452) reaches the routing map through
      // `syncScreenRouteEntries` rather than `publishScreenRoute`, so it does
      // not inherit that function's activation event (AGL-1561) — and it is
      // the publish button people actually use. Counted here explicitly.
      // The unpublish branch above returns before this point, and the two
      // guard clauses bail without writing, so only a route actually going
      // live is counted.
      trackEvent('site_published', { first_publish: firstPublish })
      enqueueSnackbar(
        collectionTemplatePublishMessage(routesByScreenId.get(screenId), {
          isTemplateScreen: isCollectionTemplate,
        }) ??
          `Published at ${Aglyn.screenRoutePathToUrl(composedPath as string)}`,
        { variant: 'success', persist: false },
      )
    } catch (e) {
      enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    publishedPath,
    normalizedSlug,
    slugConflict,
    unpublishedAncestor,
    reservedSegment,
    composedPath,
    candidateById,
    screensById,
    parentId,
    buildRouteEntries,
    updateScreenDoc,
    firestore,
    hostId,
    screenId,
    versionId,
    enqueueSnackbar,
    isCollectionTemplate,
    routesByScreenId,
  ])

  const handleParentChange = useCallback(
    async (event) => {
      const value = event.target.value as string
      const nextParentId = value === '__none__' ? undefined : value
      if (Aglyn.wouldCreateScreenCycle(screenId, nextParentId, screensById)) {
        return enqueueSnackbar(
          "A screen can't be nested inside itself or its own children",
          { variant: 'warning', persist: false },
        )
      }
      const nextById = {
        ...screensById,
        [screenId]: { ...screensById[screenId], parentId: nextParentId },
      }
      const nextSelfPath = Aglyn.composeScreenRoutePath(screenId, nextById)
      const owner = nextSelfPath
        ? Aglyn.findScreenIdByRoutePath(routingMap, nextSelfPath)
        : undefined
      if (owner && owner !== screenId) {
        return enqueueSnackbar(
          `Another screen is already published at ${Aglyn.screenRoutePathToUrl(nextSelfPath as string)}`,
          { variant: 'warning', persist: false },
        )
      }
      await updateScreenDoc({
        parentId: nextParentId ?? (deleteField() as any),
      } as any)
        .then(() =>
          syncScreenRouteEntries(
            firestore,
            hostId,
            buildRouteEntries(nextById),
          ),
        )
        .then(() => {
          enqueueSnackbar(
            nextParentId ? 'Parent screen assigned' : 'Parent screen removed',
            { variant: 'success', persist: false },
          )
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
            variant: 'error',
            allowDuplicate: true,
          })
        })
    },
    [
      screenId,
      screensById,
      routingMap,
      buildRouteEntries,
      updateScreenDoc,
      firestore,
      hostId,
      enqueueSnackbar,
    ],
  )

  const handlePreview = useCallback(async () => {
    const ids = {
      hostId: hostId as string,
      kind: 'screen' as const,
      docId: screenId,
      versionId,
    }
    /**
     * Preview what the site will render: the draft screen composed through
     * its whole layout CHAIN, since a layout may itself render inside
     * another (AGL-703).
     *
     * Fetched here rather than through hooks because the chain's length is
     * only known by walking it, and a hook count cannot vary. The already
     * subscribed layout supplies the first link, so the common case (no
     * nesting) makes no extra read at all.
     */
    const chain: Array<Record<string, any> | undefined> = []
    if (layoutId) {
      chain.push(layoutVersionResult?.data?.nodes as any)
      const seen = new Set<string>([String(layoutId)])
      let parentId = layoutResult?.data?.layoutId
      while (
        parentId &&
        !seen.has(String(parentId)) &&
        chain.length < Aglyn.MAX_LAYOUT_CHAIN_DEPTH
      ) {
        seen.add(String(parentId))
        try {
          const layoutSnapshot = await getDoc(
            doc(
              firestore,
              'hosts',
              hostId as string,
              'layouts',
              String(parentId),
            ),
          )
          const parentVersionId = layoutSnapshot.get('versionId')
          if (!parentVersionId) break
          const versionSnapshot = await getDoc(
            doc(
              firestore,
              'hosts',
              hostId as string,
              'layouts',
              String(parentId),
              'versions',
              String(parentVersionId),
            ),
          )
          // Decoded (AGL-1397). The immediate layout above arrives through
          // `useLayoutVersion`'s converter and is already a node map; this
          // raw `getDoc` walks the GRANDPARENT chain with no converter, so
          // every ancestor came back as a `Bytes` and composed to nothing —
          // preview silently lost the outer chrome.
          chain.push(Aglyn.decodeStoredNodes(versionSnapshot.get('nodes')))
          parentId = layoutSnapshot.get('layoutId')
        } catch (error) {
          // A preview is worth showing without the outer chrome; it is not
          // worth failing over.
          console.error(error)
          break
        }
      }
    }
    const composed = Aglyn.composeLayoutChainAndScreenNodes(
      chain as any,
      Aglyn.canvas.toJSON().nodes as any,
    )
    writePreviewState(ids, composed as any, hostTheme)
    window.open(
      buildRoute(Route.SCREEN_PREVIEW, { orgSlug, host, screenId, versionId }),
      previewWindowName(ids),
    )
  }, [
    hostId,
    screenId,
    versionId,
    layoutId,
    layoutResult?.data?.layoutId,
    layoutVersionResult?.data?.nodes,
    firestore,
    hostTheme,
    orgSlug,
    host,
  ])

  // Id-based screen links: the canvas resolves hrefs from the live routing
  // map (rendered, never navigable in the editor), and the Attributes panel
  // uses the same context to list screens in the screen-select field.
  // What the SITE serves, not what publishing wrote (AGL-1998): a picker that
  // offers a path the tenant router 404s hands the author a dead anchor.
  const linkableRoutes = useScreenLinkRoutes({
    templates: collectionTemplates,
    routingMap,
    screens: screenDocs,
  })
  const screenLinks = useMemo(
    () => ({
      screens: linkableRoutes,
      labels: Object.fromEntries(
        Object.entries(screensById).map(([id, screen]) => [
          id,
          screen?.displayName ?? id,
        ]),
      ),
      suppressNavigation: true,
      // Static canvas: interactions inert, menus/drawers show editor affordance (AGL-830).
      editorInert: true,
    }),
    [linkableRoutes, screensById],
  )

  useEffect(() => {
    if (hasError) {
      enqueueSnackbar(`Error: ${error?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    } else if (notFound) {
      enqueueSnackbar('404: Screen not found', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [enqueueSnackbar, hasError, error, notFound])

  return (
    <HostThemeDocumentContext.Provider value={hostTheme}>
      <Aglyn.ScreenLinkContext.Provider value={screenLinks}>
        <EntityPickerProvider hostId={hostId}>
          <ReusableComponentsProvider hostId={hostId}>
            <BindingPickerProvider hostId={hostId}>
              <BesignerDraftAlertComponent
                draft={draft}
                noun="screen"
                remoteChanged={remoteChanged}
              />
              {/* Email documents run no client JS (AGL-587): disable interaction
        capabilities so the attributes panel never offers the section. */}
              <InteractionsProvider
                hostId={hostId}
                screenId={screenId}
                disabled={screenKind === 'email'}
              >
                <BesignerMediaPickerProvider hostId={hostId}>
                  {hostFontsHref ? (
                    <>
                      <link
                        key="host-fonts-preconnect"
                        rel="preconnect"
                        href="https://fonts.gstatic.com"
                        crossOrigin="anonymous"
                      />
                      <link
                        key="host-fonts"
                        rel="stylesheet"
                        href={hostFontsHref}
                      />
                    </>
                  ) : null}
                  <MainLayout
                    enableAppBarElevation
                    besigner
                    centerPrefix={
                      <BesignerDocumentSwitcherComponent
                        hostId={hostId}
                        current={{ kind: 'screen', id: screenId }}
                      />
                    }
                    // appBarSuffix={'Besigner'}
                    actionsPrefix={
                      <>
                        <Tooltip
                          title={
                            !canPublish
                              ? publishBlock
                              : publishedPath && isCollectionTemplate
                                ? templateRoutes
                                  ? `Live — this template renders ${templateRoutes}`
                                  : 'Live as a collection template — no path of its own'
                                : publishedPath
                                  ? `Live at ${Aglyn.screenRoutePathToUrl(publishedPath)}`
                                  : 'Publish this version to your site'
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              variant={publishedPath ? 'outlined' : 'contained'}
                              color="primary"
                              disabled={!canPublish}
                              onClick={handleTogglePublish}
                              sx={{
                                mr: 1,
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {publishedPath ? 'Unpublish' : 'Publish'}
                            </Button>
                          </span>
                        </Tooltip>
                        <BesignerFunctionsButton hostId={hostId} />
                        <BesignerVersionsComponent
                          hostId={hostId}
                          parent={{ kind: 'screen', id: screenId }}
                          versionId={versionId}
                          publishedVersionId={screenResult?.data?.versionId}
                          actionsRef={versionsActions}
                        />
                      </>
                    }
                    backButton={
                      {
                        component: AppLink,
                        componentVariant: 'naked',
                        href: detailUrl,
                      } as any
                    }
                    centerNavigationItems={[
                      // {
                      //   id: 'center-nav-site-picker',
                      //   children: ,
                      // },
                      {
                        id: 'center-nav-file',
                        children: 'File',
                        // href: '/besigner',
                        items: [
                          {
                            id: 'center-nav-file-save',
                            icon: saveAvailable
                              ? { path: ICON_VARIANT_MODIFY_SAVE.path }
                              : { path: ICON_VARIANT_SYMBOL_CONFIRMED.path },
                            children: saveAvailable ? 'Save' : 'Up to Date',
                            onClick: handleSave,
                          },
                          {
                            id: 'center-nav-file-close',
                            children: 'Close',
                            href: detailUrl,
                            component: AppLink,
                            componentVariant: 'naked',
                            ListItemTextProps: { inset: true },
                          },
                          {
                            type: 'divider',
                          },
                          {
                            id: 'center-nav-file-new-version',
                            children: 'New version',
                            // Deferred to the versions panel (AGL-1218): it owns the
                            // `versioning` entitlement check, the refusal to snapshot a
                            // dirty canvas, and the name dialog. Read at click time, so
                            // the mount order of the app bar does not matter.
                            onClick: () =>
                              versionsActions.current?.createVersion(),
                            ListItemTextProps: { inset: true },
                          },
                          {
                            type: 'divider',
                          },
                          {
                            id: 'center-nav-edit-properties',
                            icon: {
                              path: ICON_VARIANT_APP_SETTINGS.path,
                            },
                            children: 'Screen Properties',
                            onClick: () => setScreenDialog(true),
                          },
                        ],
                      },
                      {
                        id: 'center-nav-edit',
                        children: 'Edit',
                        // href: '/besigner',
                        items: [
                          {
                            id: 'center-nav-edit-undo',
                            children: 'Undo',
                            onClick: () => Aglyn.canvas.undo(),
                            disabled: !Aglyn.canvas.canUndo,
                            ListItemTextProps: { inset: true },
                          },
                          {
                            id: 'center-nav-edit-redo',
                            children: 'Redo',
                            onClick: () => Aglyn.canvas.redo(),
                            disabled: !Aglyn.canvas.canRedo,
                            ListItemTextProps: { inset: true },
                          },
                          {
                            type: 'divider',
                          },
                          {
                            id: 'center-nav-edit-rawjson',
                            children: 'Raw JSON',
                            onClick: () => openJsonEditor(),
                            ListItemTextProps: { inset: true },
                          },
                        ],
                      },
                      {
                        id: 'center-nav-insert',
                        children: 'Insert',
                        // href: '/besigner',
                        items: [
                          {
                            id: 'center-nav-insert-element',
                            icon: {
                              path: ICON_VARIANT_MODIFY_ADD.path,
                            },
                            children: 'New Element',
                            // Capture the current selection as the insert target when
                            // the picker opens. Passing the callback directly handed the
                            // menu click event in as `parent`, which both detached the
                            // created node from the tree and broke placement-constraint
                            // validation (AGL-537).
                            onClick: () =>
                              handleAddElementClick(
                                Besigner.focus.getLastSelected(),
                              ),
                          },
                        ],
                      },
                    ]}
                  >
                    {/* `hasError`, not the raw `error` (AGL-1066): a refused read that
            still has the screen cached must keep rendering the canvas rather
            than replace an author's open document with "Not found". */}
                    {hasError || notFound ? (
                      <Stack
                        sx={{
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Typography>{'Not found'}</Typography>
                      </Stack>
                    ) : status === 'loading' ? (
                      LOADING_OVERLAY_ELEMENT
                    ) : (
                      <>
                        <CollaboratorOverlays entries={presence.entries} />
                        <BesignerAppBarComponent
                          detailsUrl={detailUrl}
                          presence={<PresenceAvatars presence={presence} />}
                          onSave={
                            editingLiveVersion ? handleSaveDraft : handleSave
                          }
                          onSaveAndPublish={handleSaveAndPublish}
                          // Live only when the parent's pointer names THIS version.
                          livePublished={
                            screenResult?.data?.versionId === versionId &&
                            // A draft found on OPEN counts too, not just one saved in this
                            // session — otherwise reopening the tab reports the site as up
                            // to date while yesterday's draft is still waiting.
                            !draftPending &&
                            !draft.available
                          }
                          onPreview={handlePreview}
                          liveUrl={liveUrl}
                          liveUnavailableReason={liveUnavailableReason}
                          onPropertiesEdit={() => setScreenDialog(true)}
                          saveAvailable={saveAvailable}
                        />
                        {/* Surfaced as soon as their save lands, not on Save — finding
                out after twenty more minutes of editing is the bad
                version of this (AGL-674). */}
                        {remoteChanged && !draft.available ? (
                          <BesignerConflictAlertComponent noun="screen" />
                        ) : null}
                        {layoutId ? (
                          <Alert
                            severity="info"
                            sx={{
                              borderRadius: 0,
                              // Stack above the canvas selection overlays.
                              position: 'relative',
                              zIndex: 'appBar',
                            }}
                            action={
                              <Button
                                color="inherit"
                                size="small"
                                component={AppLink}
                                componentVariant="naked"
                                nativeButton={false}
                                disabled={!layoutVersionId}
                                href={
                                  layoutVersionId
                                    ? buildRoute(Route.LAYOUT_BESIGNER, {
                                        orgSlug,
                                        host,
                                        layoutId,
                                        versionId: layoutVersionId,
                                      })
                                    : undefined
                                }
                              >
                                {'Edit layout'}
                              </Button>
                            }
                          >
                            {`Shared layout "${
                              layoutResult?.data?.displayName ?? layoutId
                            }" frames this screen — its elements are locked here.`}
                          </Alert>
                        ) : null}
                        <LayoutChromeContext.Provider
                          value={chromeContextValue}
                        >
                          <WorkspaceEditorComponent>
                            <ViewportRootComponent>
                              <ViewportCanvasComponent />
                            </ViewportRootComponent>
                          </WorkspaceEditorComponent>
                        </LayoutChromeContext.Provider>
                      </>
                    )}
                  </MainLayout>
                  <PropertiesDialogComponent
                    open={screenDialog}
                    onClose={() => {
                      setScreenDialog(false)
                    }}
                    onActionClick={async () => {
                      await handleSave()
                      setScreenDialog(false)
                    }}
                  >
                    <Stack spacing={1} sx={{ px: 3, pb: 3 }}>
                      <Typography variant="subtitle2">
                        {'Publishing'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {
                          'The slug is this screen\'s own path segment; nesting under a parent screen composes the full path (parent "company" + slug "about" → /company/about). Use "/" for the home page. Clearing the slug and pressing Unpublish removes the screen (and unroutes its children) from the site.'
                        }
                      </Typography>
                      <TextField
                        select
                        size="small"
                        label="Parent screen"
                        value={parentId ?? '__none__'}
                        onChange={handleParentChange}
                      >
                        <MenuItem value="__none__">
                          {'None (top level)'}
                        </MenuItem>
                        {(screenDocs ?? [])
                          .filter(
                            (screen) =>
                              screen.$id !== screenId &&
                              !Aglyn.wouldCreateScreenCycle(
                                screenId,
                                screen.$id,
                                screensById,
                              ),
                          )
                          .map((screen) => (
                            <MenuItem key={screen.$id} value={screen.$id}>
                              {screen.displayName ?? screen.$id}
                            </MenuItem>
                          ))}
                      </TextField>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'flex-start' }}
                      >
                        <TextField
                          size="small"
                          label="Slug"
                          fullWidth
                          value={slugValue}
                          onChange={(e) => setSlugInput(e.target.value)}
                          error={Boolean(
                            slugConflict ||
                            unpublishedAncestor ||
                            reservedSegment,
                          )}
                          helperText={
                            slugConflict
                              ? 'Another screen already uses this path'
                              : reservedSegment
                                ? Aglyn.reservedScreenRouteMessage(
                                    reservedSegment,
                                  )
                                : unpublishedAncestor
                                  ? 'A parent screen has no slug yet — publish the parent first'
                                  : isCollectionTemplate
                                    ? templateRoutes
                                      ? `A collection template — renders ${templateRoutes}, not this path`
                                      : 'A collection template — not served at a path of its own'
                                    : composedPath
                                      ? `Served at ${Aglyn.screenRoutePathToUrl(composedPath)}`
                                      : publishedPath
                                        ? `Currently published at ${Aglyn.screenRoutePathToUrl(publishedPath)}`
                                        : 'Not published'
                          }
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={handlePublish}
                          disabled={Boolean(
                            slugConflict ||
                            unpublishedAncestor ||
                            reservedSegment ||
                            (!normalizedSlug && !publishedPath),
                          )}
                          sx={{ mt: 0.5, flexShrink: 0 }}
                        >
                          {normalizedSlug ? 'Publish' : 'Unpublish'}
                        </Button>
                      </Stack>
                      <Typography variant="subtitle2">
                        {'Shared layout'}
                        {/* AGL-2167 — binding a layout is the one control here whose
                effect is invisible on this screen's own canvas until it is
                set, and nesting rules are not guessable from a picker. */}
                        <HelpTip
                          title="Screens & layouts"
                          excerpt="A layout wraps this screen in shared chrome — appbar, footer — maintained once. Layouts can nest; the screen renders in the innermost slot."
                          href={besignerDocsUrl('layouts', '#what-a-layout-is')}
                          sx={{ ml: 0.25, fontSize: '0.9em' }}
                        />
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {
                          'Wraps this screen in chrome (appbar, footer, …) maintained once for every bound screen. Saved immediately.'
                        }
                      </Typography>
                      <TextField
                        select
                        size="small"
                        label="Layout"
                        value={layoutId ?? '__none__'}
                        onChange={handleLayoutChange}
                      >
                        <MenuItem value="__none__">{'None'}</MenuItem>
                        {(layoutOptions ?? []).map((layout) => (
                          <MenuItem key={layout.$id} value={layout.$id}>
                            {layout.displayName ?? layout.$id}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Typography variant="subtitle2">
                        {'SEO'}
                        {/* AGL-2167 — these three fields are per-screen overrides of
                site-wide defaults, and nothing on this panel says so or
                says where the defaults live. */}
                        <HelpTip
                          title="SEO"
                          excerpt="Per-screen overrides of the site's SEO defaults. Left empty, a screen falls back to the site-wide title pattern and social card."
                          href={besignerDocsUrl('seo', '#per-screen-seo')}
                          sx={{ ml: 0.25, fontSize: '0.9em' }}
                        />
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {'Search and social metadata for this screen. Saved separately ' +
                          'from the canvas.'}
                      </Typography>
                      <TextField
                        size="small"
                        label="Search title"
                        value={
                          seoTitle ??
                          (screenResult?.data as any)?.seo?.title ??
                          ''
                        }
                        onChange={(e) => setSeoTitle(e.target.value)}
                        helperText="The whole tab/search title, published verbatim (≤60 chars works best)"
                      />
                      <TextField
                        size="small"
                        label="Search description"
                        multiline
                        minRows={2}
                        value={
                          seoDescription ??
                          (screenResult?.data as any)?.seo?.description ??
                          ''
                        }
                        onChange={(e) => setSeoDescription(e.target.value)}
                        helperText="Search snippet / social share text (≤160 chars works best)"
                      />
                      {/* Social image (AGL-1337), shared with the screen detail page's
              SEO card so the two surfaces cannot drift (AGL-1368). */}
                      <ScreenSocialImageField
                        hostId={hostId}
                        saved={screenResult?.data?.seo?.image}
                        // See the twin on the screen detail page (AGL-2417).
                        savedAlt={screenResult?.data?.seo?.imageAlt}
                        savedWidth={screenResult?.data?.seo?.imageWidth}
                        savedHeight={screenResult?.data?.seo?.imageHeight}
                        value={seoImage}
                        onChange={setSeoImage}
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleSeoSave}
                        disabled={
                          seoTitle == null &&
                          seoDescription == null &&
                          seoImage == null
                        }
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {'Save SEO'}
                      </Button>
                      <Typography variant="subtitle2">
                        {'Password protection'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(screenResult?.data as any)?.protection?.passwordHash
                          ? 'This screen is password-protected. Enter a new password to ' +
                            'change it, or save empty to remove protection.'
                          : 'Visitors must enter this password to view the published ' +
                            'screen. Leave empty for public.'}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <TextField
                          size="small"
                          type="password"
                          label="Password"
                          value={protectPassword ?? ''}
                          onChange={(e) => setProtectPassword(e.target.value)}
                          sx={{ flex: 1 }}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={handleProtectionSave}
                          disabled={protectPassword == null}
                        >
                          {'Save'}
                        </Button>
                      </Stack>
                    </Stack>
                  </PropertiesDialogComponent>
                  {Boolean(Aglyn.canvas.rootNode && jsonOpen) && (
                    <JsonEditor
                      open={Boolean(Aglyn.canvas.rootNode && jsonOpen)}
                      onClose={closeJsonEditor}
                      onSave={handleJsonSave}
                      defaultValue={Aglyn.canvas.nestedNodes as any}
                    />
                  )}
                </BesignerMediaPickerProvider>
              </InteractionsProvider>
            </BindingPickerProvider>
          </ReusableComponentsProvider>
        </EntityPickerProvider>
      </Aglyn.ScreenLinkContext.Provider>
    </HostThemeDocumentContext.Provider>
  )
}

BesignerPage.displayName = 'Page:Besigner'

export default withSitePlugins(withBesignerContext(observer(BesignerPage)))
