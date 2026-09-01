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

import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import {
  BesignerConflictAlertComponent,
  BesignerDraftAlertComponent,
  recoverableRoomSessions,
  publishFailureMessage,
  useAddElementDrawerCallback,
  useBesignerDocument,
  useRenderedCanvasElements,
  withBesignerContext,
  type BesignerSaveBaseline,
  type WorkspaceEditorComponentProps,
  clearServerDraft,
} from '@aglyn/besigner-ui'
import {
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { AppLink, useLoading } from '@aglyn/shared-ui-jsx'
import { LOADING_OVERLAY_ELEMENT } from '@aglyn/shared-ui-jsx/const/prebuilt-components'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import {
  saveNodesGuarded,
  useComponent,
  useComponentVersion,
  useComponentVersionRef,
  useHost,
  useHostActivityLogger,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import ComponentPropsDialog from '../../../../../../../../../../components/component-props-dialog.component'
import revalidateLivePages, {
  describeRevalidateShortfall,
} from '../../../../../../../../../../utils/revalidate-live-pages'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
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
import BesignerMediaPickerProvider from '../../../../../../../../../../components/besigner-media-picker-provider.component'
import BesignerAppBarComponent from '../../../../../../../../../../components/besigner-app-bar.component'
import BesignerDocumentSwitcherComponent from '../../../../../../../../../../components/besigner-document-switcher.component'
import BesignerVersionsComponent from '../../../../../../../../../../components/besigner-versions.component'
import EntityPickerProvider from '../../../../../../../../../../components/entity-picker-provider.component'
import ReusableComponentsProvider from '../../../../../../../../../../components/reusable-components-provider.component'
import AuthenticatedLayout from '../../../../../../../../../../components/layouts/authenticated.layout'
import MainLayout from '../../../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../../../constants/app-setup'
import {
  buildRoute,
  Route,
} from '../../../../../../../../../../constants/route-links'
import useCollectionTemplates from '../../../../../../../../../../hooks/use-collection-templates'
import useOpenPreview from '../../../../../../../../../../hooks/use-open-preview'
import useScreenLinkRoutes from '../../../../../../../../../../hooks/use-screen-link-routes'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../../../../hooks/use-firestore-collection'
import usePluginDrawerRegistration from '../../../../../../../../../../hooks/use-plugin-drawer-registration'
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

function ComponentBesignerPage(props) {
  const params = useParams<{
    hostId: string
    componentId: string
    versionId: string
  }>()
  const hostId = useHostId()
  const componentId = params?.componentId as string
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
  // Installed plugins as drawer entries and as the element panel's plugin
  // picker (AGL-1030). Registered on the screen editor since AGL-190 but
  // nowhere else, so a plugin could not be placed in a reusable component or a
  // layout at all, and the picker there had no installs to offer.
  usePluginDrawerRegistration(hostId)
  const handleAddElementClick = useAddElementDrawerCallback()
  const listUrl = buildRoute(Route.HOST_COMPONENTS, { orgSlug, host })
  const { doc: hostResult } = useHost({ hostId })
  const { doc: componentResult } = useComponent({ hostId, componentId })
  // The browser tab names THIS document, not just its site (AGL-2486).
  // The server put the id in the title; this swaps in the loaded name.
  useDeclareDocumentSubject(componentId, componentResult?.data?.displayName)
  const { data: user } = useUser()
  const publishedVersionId = componentResult?.data?.versionId
  /**
   * Did the last save actually LAND? (AGL-1152)
   *
   * `handleSave` resolves `void` whether it wrote or refused — a size guard, a
   * concurrent edit, or nothing-to-save all return early — and `saveAvailable`
   * is React state that is still stale in the same tick. `onSaved` fires only
   * on a real write, so this is the one signal `Save & publish` can trust
   * before promoting. Promoting after a refused save would push the canvas
   * live without it having been stored.
   */
  const savedLandedRef = useRef(false)

  /**
   * Has this version been SAVED since it was last promoted? (AGL-1152)
   *
   * `publishedVersionId === versionId` only says the parent was promoted from
   * this version at some point — a later save writes the VERSION document and
   * leaves the PARENT, which is what the tenant actually renders, behind. So
   * the pointer alone cannot answer "is the live site current". This can, for
   * the session that did the saving, which is the author who needs the answer.
   *
   * Starts false: on arrival the parent holds whatever the last publish left,
   * and nothing in this session has moved past it.
   */
  const [savedSincePublish, setSavedSincePublish] = useState(false)
  // Id-based screen links: a component can contain a link, so the canvas needs the routing map to resolve hrefs and the
  // Attributes panel needs screen names for the screen-select field.
  const firestore = useFirestore()
  /**
   * Only the LIVE version has a draft (AGL-1152).
   *
   * A component's test is NOT `publishedVersionId === versionId` alone, for
   * the same reason the save button's is not: that says the parent was
   * promoted from this version once, not that it still matches. A save writes
   * the version and leaves the parent — which is what the tenant renders —
   * behind. `savedSincePublish` is the other half, and both are needed here.
   */
  const editingLiveVersion = Boolean(
    versionId && versionId === publishedVersionId,
  )
  const [draftPending, setDraftPending] = useState(false)
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // What the SITE serves, not what publishing wrote (AGL-1998): a picker that
  // offers a path the tenant router 404s hands the author a dead anchor, and
  // it offered nothing at all for a collection's list template.
  const collectionTemplates = useCollectionTemplates(hostId)
  const linkableRoutes = useScreenLinkRoutes({
    templates: collectionTemplates,
    routingMap: hostResult?.data?.screens as Record<string, string> | undefined,
    screens: screenDocs,
  })
  const screenLinks = useMemo(
    () => ({
      screens: linkableRoutes,
      labels: Object.fromEntries(
        (screenDocs ?? []).map((screen: any) => [
          screen.$id,
          screen.displayName ?? screen.$id,
        ]),
      ),
      suppressNavigation: true,
      // Static canvas: interactions inert, menus/drawers show editor affordance (AGL-830).
      editorInert: true,
    }),
    [linkableRoutes, screenDocs],
  )
  const { doc: result, setDoc: updateComponentVersion } = useComponentVersion({
    hostId,
    componentId,
    versionId,
  })
  const componentVersionRef = useComponentVersionRef({
    hostId,
    componentId,
    versionId,
  })
  const { data, status, error, hasPendingWrites } = result
  const nodes = data?.nodes

  // Deliberately NO viewType override: a component edits like screen
  // content. The LAYOUT view is what exposes the LayoutSlot outlet in the
  // element drawer, and a slot inside a reusable component would have
  // nowhere to graft (AGL-680).

  // The canvas is a singleton shared by every editing session; without a
  // reset on leave, client-side navigation to a screen or another layout
  // keeps (and could save) this document's nodes.
  useEffect(() => {
    return () => {
      Aglyn.canvas.reset()
      Besigner.focus.clearFocusStatus()
    }
  }, [hostId, componentId, versionId])

  useEffect(() => {
    if (status === 'loading') {
      return queueLoading()
    }
  }, [status])

  // Conditional write (AGL-1301): the transaction re-checks the baseline
  // against what Firestore actually holds, so a save racing another writer's
  // commit aborts server-side instead of clobbering it.
  const saveComponentVersion = useCallback(
    async (
      nextNodes: Record<string, unknown>,
      baseline?: BesignerSaveBaseline,
    ) => {
      await saveNodesGuarded(
        componentVersionRef,
        {
          nodes:
            nextNodes as unknown as Aglyn.AglynHostComponentVersion['nodes'],
        },
        baseline,
      )
    },
    [componentVersionRef],
  )

  // Who else is in this document (AGL-675) and live co-editing (AGL-677) —
  // adopted from the screen editor (AGL-1301).
  const selectedNodeId = Besigner.focus.getLastSelected()?.$id
  const clearMirrorRef = useRef<(() => void) | undefined>(undefined)
  const { elements: canvasElements } = useRenderedCanvasElements()
  const getCanvasRoot = useCallback(
    () => canvasElements.current?.[Aglyn.CANVAS_ROOT_ELEMENT_ID]?.node,
    [canvasElements],
  )
  const presence = usePresence({
    hostId,
    docType: 'component',
    docId: componentId,
    versionId,
    selectedNodeId,
    broadcastCursor: true,
    getCanvasRoot,
  })

  // Canvas lifecycle, first load, concurrent-write detection (AGL-674) and
  // the size-guarded save (AGL-678) are shared by every besigner editor
  // (AGL-746). What stays here is what is actually about a component.
  const {
    saveAvailable,
    remoteChanged,
    draft,
    handleSave,
    saveWorkingDraft,
    markOwnWrite,
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
    save: saveComponentVersion,
    noun: 'component',
    documentKey: `${hostId}:${componentId}:${versionId}`,
    draft: {
      scope: hostId,
      kind: 'component',
      docId: componentId,
      versionId,
    },
    // The SHARED working draft, live version only.
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
    // Tell the author what happens next — and for a component that is
    // "publish", never "wait" (AGL-2486). This message used to promise that
    // editing the LIVE version had already started refreshing live pages,
    // which is not something a save can do: `getComponents` renders the
    // PARENT doc and a save writes the version doc. The author's whole
    // question after saving is "why has my change not appeared", and the
    // honest answer is the one action that makes it appear. Unconditional
    // because it is true of every component save, on the published version
    // or a draft one.
    // Suppressed on the live version: `handleSaveToSites` owns the message
    // there, and it can only be written once the promote has resolved —
    // "saved" followed by "published" is two toasts for one action.
    savedMessage:
      publishedVersionId === versionId
        ? undefined
        : 'Component saved to this version. Publish it to update the live pages.',
    queueLoading,
    // A definition's root is the promoted node, not the canvas root, so it
    // has to be wrapped or the canvas has no root and renders nothing
    // (AGL-680).
    toCanvasNodes: (storedNodes) =>
      Aglyn.definitionToCanvasTree({
        rootId: data?.rootId,
        nodes: storedNodes as Record<string, unknown>,
      }) as Aglyn.ProcessableNodes,
    onSaved: () => {
      // Records that the write LANDED (AGL-1152). `handleSave` resolves
      // `void` whether it wrote or refused — a size guard, a concurrent edit,
      // or nothing to save all return early — and `saveAvailable` is React
      // state that is still stale in the same tick. Promoting after a refused
      // save would push the canvas live without it having been stored, which
      // is the one outcome worse than not promoting at all.
      savedLandedRef.current = true
      // The version moved; the parent did not. Until a publish the live site
      // is behind, and the button should say so rather than "Up to date".
      setSavedSincePublish(true)
      // A save makes Firestore authoritative again, so the live mirror of
      // unsaved work has to go — otherwise the next person to join replays
      // edits that are already in the document (AGL-677).
      clearMirrorRef.current?.()
      // NO REVALIDATION HERE, DELIBERATELY (AGL-2486).
      //
      // This used to drop the cached HTML of every screen using the component
      // whenever the PUBLISHED version was saved, on the reasoning that a
      // save on the live version edits what live screens render. That is true
      // of a SCREEN — the tenant reads `screens/{id}/versions/{versionId}` —
      // and false of a component: `getComponents` reads the parent doc
      // `components/{id}`, and a save writes the version doc. So the drop was
      // real, correctly scoped and completely pointless: every dependent page
      // regenerated from a parent document the save had not touched, byte for
      // byte what it served before. What the author saw was their edit not
      // appearing, ten minutes later, with the editor claiming live pages
      // were refreshing.
      //
      // Its cost was not nothing. Firing it meant a full-site node-tree scan
      // (up to `SCAN_LIMIT` screens + layouts + components, WITH version
      // bodies) plus a cache drop per dependent path, on every save of a live
      // component — the most frequent event in the editor. The fan-out now
      // rides `handleSaveAndPublish` instead: once per deliberate publish, on the
      // one write that actually moves the bytes.
      return logActivity('Saved the component', {
        type: 'component',
        id: componentId,
        name: componentResult?.data?.displayName,
      })
    },
  })

  // Live co-editing (AGL-677). Rides the presence session's authenticated
  // RTDB app rather than brokering a second token.
  const coediting = useCoEditing({
    session: presence.session,
    docType: 'component',
    docId: componentId,
    versionId,
    storedStamp: (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    loaded: Aglyn.canvas.didSetInitial,
  })
  clearMirrorRef.current = coediting.clearMirror

  /**
   * Publish (AGL-679): copy this version's tree onto the component doc.
   *
   * The parent doc IS the published copy — `getComponents` reads it for
   * every component in a single query on each tenant render, which is why
   * nodes were never moved into version docs. So publishing is a copy, and
   * until it happens the live site keeps rendering the previous tree.
   */
  const [publishing, setPublishing] = useState(false)
  // Declared props (AGL-1247) are document metadata, not canvas nodes, so
  // they save straight to the version doc rather than riding the node save.
  const [propsDialogOpen, setPropsDialogOpen] = useState(false)
  const declaredProps = (
    data as { props?: Aglyn.ReusableComponentProp[] } | undefined
  )?.props
  const handleSaveDeclaredProps = useCallback(
    async (nextProps: Aglyn.ReusableComponentProp[]) => {
      const save = updateComponentVersion as unknown as (
        value: Partial<Aglyn.AglynHostComponentVersion>,
        options?: Parameters<typeof updateComponentVersion>[1],
      ) => Promise<void>
      // This bumps the version doc's `updatedAt` just like a node save, so
      // the conflict guard has to be told it was us — otherwise declaring a
      // property accuses the author of being a second editor and pauses
      // saving until they reload (AGL-674).
      markOwnWrite()
      await save({ props: nextProps }, { merge: true })
      enqueueSnackbar(
        'Properties saved. Publish to make them available on live pages.',
        { variant: 'success', persist: false },
      )
    },
    [updateComponentVersion, markOwnWrite, enqueueSnackbar],
  )
  /**
   * Promote the canvas onto the parent document — the thing the tenant renders.
   *
   * SPLIT FROM ITS GUARD (AGL-1152) so a save can reuse it. The guard below
   * refuses while `saveAvailable`, which is right for a deliberate Publish and
   * wrong for the save that has just finished: `saveAvailable` is React state
   * and is still true in the same tick, so a save chaining into the guarded
   * function would always refuse itself.
   */
  const promoteToSites = useCallback(async () => {
    setPublishing(true)
    try {
      // Unwrap the synthetic canvas root: the tenant runtime grafts from
      // `rootId`, so publishing the wrapper would put an always-empty
      // container inside every instance of this component (AGL-680).
      const definition = Aglyn.canvasTreeToDefinition(
        Aglyn.canvas.toJSON().nodes as Record<string, unknown>,
      )
      if (definition.ambiguousRoot) {
        return enqueueSnackbar(
          'A component needs a single top-level element. Wrap what you have ' +
            'in one container, then publish.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      const publishedNodes = definition.nodes
      const rootId = definition.rootId ?? componentResult?.data?.rootId
      // Declared props publish with the tree (AGL-1247), for the same
      // reason `rootId` does: the tenant reads the parent doc, so props
      // left behind on the version would graft every `{{prop.*}}` token
      // unresolved on the live site while the editor looked correct.
      const declaredProps = (data as { props?: Aglyn.ReusableComponentProp[] })
        ?.props
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'components', componentId),
        {
          nodes: publishedNodes,
          ...(rootId ? { rootId } : {}),
          props: declaredProps ?? [],
          versionId,
          updatedAt: Timestamp.now(),
        },
      )
      setSavedSincePublish(false)
      enqueueSnackbar(
        'Published. Every screen using this component is refreshing now — ' +
          'you do not need to republish them.',
        { variant: 'success', persist: false },
      )
      // THIS is the write that changes what a visitor sees, so this is where
      // the cache drop belongs (AGL-2486). The comment that stood here said
      // there was no on-demand revalidation hook and propagation was a cache
      // window; AGL-1161 built that hook, and every caller wired it up except
      // this one — the component editor's own Publish button. So the path
      // that moved the bytes waited out the full window while the path that
      // moved nothing dropped caches on every save.
      //
      // BOUNDED AND OUT OF BAND. Not awaited, and fired AFTER the snackbar:
      // the publish has already succeeded, a cache hint that fails must never
      // make it look failed, and the 60s window is still underneath as the
      // backstop. The console route caps its dependent scan and the tenant
      // caps the paths it will take, so a component on 500 screens costs one
      // bounded scan and one capped request — never 500 round trips, and
      // never inside the write. `describeRevalidateShortfall` is what says so
      // out loud when either cap bites, instead of reporting an unqualified
      // success over pages that did not change (AGL-1239).
      void revalidateLivePages({ user, hostId, componentId }).then((result) => {
        const shortfall = describeRevalidateShortfall(result)
        if (shortfall) {
          enqueueSnackbar(shortfall, { variant: 'warning', persist: false })
        }
      })
    } catch (error) {
      // A publish that throws must never read like a success (AGL-1334).
      // `persist` because this is the one action that moves work onto live
      // pages: an auto-dismissed toast is how an author walks away believing
      // the component shipped while every instance renders the old markup.
      enqueueSnackbar(publishFailureMessage(error), {
        variant: 'error',
        allowDuplicate: true,
        persist: true,
      })
    } finally {
      setPublishing(false)
    }
  }, [
    firestore,
    hostId,
    componentId,
    versionId,
    componentResult?.data?.rootId,
    data,
    enqueueSnackbar,
    // The revalidate route authenticates with the caller's ID token, so the
    // signed-in user is a real input to publishing now (AGL-2486).
    user,
  ])

  /**
   * SAVE, THEN MAKE IT LIVE — one action (AGL-1152).
   *
   * The editor's Save writes the VERSION document, and the tenant renders the
   * PARENT: `getComponents` reads every component's tree in one query rather
   * than a version subdoc per component, which is what keeps composing a page
   * to a single read. So a component save has never changed the live site, and
   * an author who saved and watched nothing happen had done nothing wrong.
   *
   * That asymmetry is real and worth keeping — it is a read optimisation on
   * the hottest path — so the fix is to maintain the parent copy from the
   * WRITE side rather than to make every render pay for it.
   *
   * Promotes ONLY if the save actually landed. `handleSave` resolves `void`
   * either way, so `savedLandedRef` is the signal; pushing the canvas live
   * after a refused save is the one outcome worse than not pushing at all.
   */
  /**
   * Saves the working draft rather than the component the sites are serving.
   * A component republish pushes into every page that uses it, so the gap
   * between "saved" and "published" is widest here — which is exactly the gap
   * a draft is for.
   */
  const handleSaveDraft = useCallback(async () => {
    const wrote = await saveWorkingDraft({
      uid: user?.uid,
      email: user?.email,
    })
    if (wrote === 'failed') {
      enqueueSnackbar('Could not save the draft — your work is still here.', {
        variant: 'error',
        persist: false,
      })
      return
    }
    // Nothing new to store, and saying so is the point (AGL-1483). The
    // control stays clickable on purpose — a disabled Save is a dead control
    // the one time it matters (AGL-1262) — so the answer has to come from
    // the click, and "Draft saved" four times over an untouched document is
    // how a reader stops believing the message.
    if (wrote === 'unchanged') {
      enqueueSnackbar('Already saved — the draft is up to date.', {
        variant: 'info',
        persist: false,
      })
      return
    }
    clearMirrorRef.current?.()
    setDraftPending(true)
    enqueueSnackbar('Draft saved — the live sites are unchanged.', {
      variant: 'success',
      persist: false,
    })
  }, [saveWorkingDraft, user, enqueueSnackbar])

  /**
   * Do the live sites already match this version?
   *
   * A component is live only once its tree has been promoted onto the PARENT
   * document — the pointer alone is not enough, which is the asymmetry with
   * screens. An unpublished draft makes the sites out of date just as surely
   * as an unpromoted save does.
   *
   * Hoisted out of the button's props (AGL-1483) because the HANDLER needs
   * the same answer: it is the difference between "nothing to publish" and
   * "saved, but the live site is still behind".
   */
  const livePublished =
    publishedVersionId === versionId &&
    !savedSincePublish &&
    !draftPending &&
    !draft.available

  const handleSaveAndPublish = useCallback(async () => {
    if (publishing) return
    savedLandedRef.current = false
    await handleSave()
    /**
     * A save that did not write is not a reason to stop (AGL-1483).
     *
     * It used to be: the guard returned unless the write landed, so a version
     * that was already saved but not yet promoted could not be published at
     * all — the button said Publish and silently did nothing, which is the
     * state the split label exists to name.
     *
     * Two different "did not write" cases, and only one of them should stop
     * here. A REFUSAL — a size guard, a concurrent edit — has already told
     * the author why, and promoting past it would push a canvas the document
     * does not hold. NOTHING TO SAVE is not a refusal: the document already
     * has the tree, so the promote is exactly the step that is left.
     *  is what tells them apart, and it is also what makes a
     * second click on an up-to-date document say so instead of republishing.
     */
    if (!savedLandedRef.current) {
      if (livePublished) {
        return enqueueSnackbar('Already published — the live sites match this version.', {
          variant: 'info',
          persist: false,
        })
      }
      if (remoteChanged) return
    }
    await promoteToSites()
    void clearServerDraft(firestore, {
      scope: hostId,
      kind: 'component',
      docId: componentId,
      versionId,
    })
    setDraftPending(false)
  }, [
    publishing,
    handleSave,
    promoteToSites,
    livePublished,
    remoteChanged,
    enqueueSnackbar,
    firestore,
    hostId,
    componentId,
    versionId,
  ])

  // The site's theme with this site's overrides resolved over it
  // (AGL-1021). The editor must render exactly what the tenant will.
  const hostTheme = useMemo(
    () => resolveSiteTheme(hostResult?.data),
    [hostResult?.data],
  )

  // Draft preview (AGL-1203): a reusable component renders on its own, so the
  // canvas snapshot is the whole story — no layout chain to compose.
  const handlePreview = useOpenPreview({
    ids: hostId
      ? {
          hostId,
          kind: 'component',
          docId: componentId,
          versionId,
        }
      : null,
    href: buildRoute(Route.COMPONENT_PREVIEW, {
      orgSlug,
      host,
      componentId,
      versionId,
    }),
    hostTheme,
  })
  const hostFontsHref = useMemo(
    () => getGoogleFontsUrl(hostTheme?.fonts),
    [hostTheme?.fonts],
  )

  useEffect(() => {
    if (hasError) {
      enqueueSnackbar(`Error: ${error?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    } else if (notFound) {
      enqueueSnackbar('404: Layout not found', {
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
              <InteractionsProvider hostId={hostId}>
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
                        current={{ kind: 'component', id: componentId }}
                      />
                    }
                    actionsPrefix={
                      <>
                        <BesignerFunctionsButton hostId={hostId} />
                        <BesignerVersionsComponent
                          hostId={hostId}
                          parent={{ kind: 'component', id: componentId }}
                          versionId={versionId}
                          publishedVersionId={publishedVersionId}
                        />
                      </>
                    }
                    backButton={
                      {
                        component: AppLink,
                        componentVariant: 'naked',
                        href: listUrl,
                      } as any
                    }
                    centerNavigationItems={[
                      {
                        id: 'center-nav-file',
                        children: 'File',
                        items: [
                          {
                            id: 'center-nav-file-save',
                            icon: saveAvailable
                              ? { path: ICON_VARIANT_MODIFY_SAVE.path }
                              : { path: ICON_VARIANT_SYMBOL_CONFIRMED.path },
                            children: saveAvailable
                              ? 'Save draft'
                              : 'Up to Date',
                            onClick: handleSave,
                          },
                          {
                            /*
                  `Publish again` IS GONE (AGL-1152). It was the second half of
                  an action that reads as one, it sat in a menu an author had to
                  go looking for, and on the live version its name described
                  doing something twice for a change that had never gone out
                  once. `Save & publish` replaces it AND `Publish to sites`:
                  saving a draft version and promoting it are the same two
                  writes in the same order, whichever version you are on.
                */
                            id: 'center-nav-file-save-publish',
                            disabled: publishing || !canPublish,
                            children: 'Save & publish',
                            // A disabled menu item with no reason reads as a bug. The
                            // secondary line says which of the reasons it is.
                            ...(canPublish
                              ? {}
                              : {
                                  ListItemTextProps: {
                                    secondary: publishBlock,
                                  },
                                }),
                            onClick: handleSaveAndPublish,
                          },
                          {
                            // Declared props (AGL-1247): what this component lets each
                            // page vary. Sits with Save/Publish because it is part of
                            // the component's contract, not of the selected element.
                            id: 'center-nav-file-properties',
                            children: 'Properties…',
                            onClick: () => setPropsDialogOpen(true),
                            ListItemTextProps: { inset: true },
                          },
                          {
                            id: 'center-nav-file-close',
                            children: 'Close',
                            href: listUrl,
                            component: AppLink,
                            componentVariant: 'naked',
                            ListItemTextProps: { inset: true },
                          },
                        ],
                      },
                      {
                        id: 'center-nav-edit',
                        children: 'Edit',
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
                    {/* `hasError`, not the raw `error` — see the screens besigner
            (AGL-1066). */}
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
                          onPreview={handlePreview}
                          detailsUrl={listUrl}
                          presence={<PresenceAvatars presence={presence} />}
                          onSave={
                            editingLiveVersion ? handleSaveDraft : handleSave
                          }
                          onSaveAndPublish={handleSaveAndPublish}
                          // A component is live only once its tree has been promoted onto
                          // the PARENT document — the pointer alone is not enough, which
                          // is the asymmetry with screens this whole change is about.
                          livePublished={livePublished}
                          publishBlockedReason={
                            canPublish ? undefined : publishBlock
                          }
                          saveAvailable={saveAvailable}
                        />
                        <BesignerDraftAlertComponent
                          draft={draft}
                          noun="component"
                          remoteChanged={remoteChanged}
                        />
                        {/* Shown as soon as their save lands, not on Save — finding out
                after twenty more minutes of editing is the bad version of
                this (AGL-674). */}
                        {remoteChanged && !draft.available ? (
                          <BesignerConflictAlertComponent noun="component" />
                        ) : null}
                        <WorkspaceEditorComponent>
                          <ViewportRootComponent>
                            <ViewportCanvasComponent />
                          </ViewportRootComponent>
                        </WorkspaceEditorComponent>
                      </>
                    )}
                  </MainLayout>
                  {Boolean(Aglyn.canvas.rootNode && jsonOpen) && (
                    <JsonEditor
                      open={Boolean(Aglyn.canvas.rootNode && jsonOpen)}
                      onClose={closeJsonEditor}
                      onSave={handleJsonSave}
                      defaultValue={Aglyn.canvas.nestedNodes as any}
                    />
                  )}
                  <ComponentPropsDialog
                    open={propsDialogOpen}
                    value={declaredProps}
                    onClose={() => setPropsDialogOpen(false)}
                    onSave={handleSaveDeclaredProps}
                  />
                </BesignerMediaPickerProvider>
              </InteractionsProvider>
            </BindingPickerProvider>
          </ReusableComponentsProvider>
        </EntityPickerProvider>
      </Aglyn.ScreenLinkContext.Provider>
    </HostThemeDocumentContext.Provider>
  )
}

ComponentBesignerPage.displayName = 'Page:LayoutBesigner'

export default withSitePlugins(
  withBesignerContext(observer(ComponentBesignerPage)),
)
