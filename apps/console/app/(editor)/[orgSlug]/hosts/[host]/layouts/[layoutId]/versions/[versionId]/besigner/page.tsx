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
import revalidateLivePages, {
  describeRevalidateShortfall,
} from '../../../../../../../../../../utils/revalidate-live-pages'
import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import {
  BesignerConflictAlertComponent,
  BesignerDraftAlertComponent,
  recoverableRoomSessions,
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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import {
  saveNodesGuarded,
  useHost,
  useLayout,
  useLayoutVersion,
  useLayoutVersionRef,
  useHostActivityLogger,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
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

function LayoutBesignerPage(props) {
  const params = useParams<{
    hostId: string
    layoutId: string
    versionId: string
  }>()
  const hostId = useHostId()
  const layoutId = params?.layoutId as string
  const versionId = params?.versionId as string
  const { enqueueSnackbar } = useSnackbar()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { queueLoading } = useLoading()
  const logActivity = useHostActivityLogger(hostId)
  // Installed plugins as drawer entries and as the element panel's plugin
  // picker (AGL-1030). Registered on the screen editor since AGL-190 but
  // nowhere else, so a plugin could not be placed in a reusable component or a
  // layout at all, and the picker there had no installs to offer.
  usePluginDrawerRegistration(hostId)
  const handleAddElementClick = useAddElementDrawerCallback()
  const listUrl = buildRoute(Route.HOST_LAYOUTS, { orgSlug, host })
  const { doc: hostResult } = useHost({ hostId })
  /** Did the last save actually land? See `onSaved`. */
  const savedLandedRef = useRef(false)
  const { doc: layoutResult, setDoc: updateLayoutDoc } = useLayout({
    hostId,
    layoutId,
  })
  // The browser tab names THIS document, not just its site (AGL-2486).
  // The server put the id in the title; this swaps in the loaded name.
  useDeclareDocumentSubject(layoutId, layoutResult?.data?.displayName)
  const { data: user } = useUser()
  const layoutPublishedVersionId = layoutResult?.data?.versionId
  // Id-based screen links: a layout's appbar is exactly where by-id links
  // live, so the canvas needs the routing map to resolve hrefs and the
  // Attributes panel needs screen names for the screen-select field.
  const firestore = useFirestore()
  /**
   * The live site, so a draft there answers a question versions already
   * answer. A layout is the sharper case for the gate, not the softer one: it
   * has no route of its own, so the only way its edits reach a visitor is the
   * version pointer, and every screen wrapped in it changes at once.
   */
  const editingLiveVersion = Boolean(
    versionId && versionId === layoutPublishedVersionId,
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
  const { doc: result } = useLayoutVersion({
    hostId,
    layoutId,
    versionId,
  })
  const layoutVersionRef = useLayoutVersionRef({
    hostId,
    layoutId,
    versionId,
  })
  const { data, status, error, hasPendingWrites } = result
  const nodes = data?.nodes

  // Conditional write (AGL-1301): the transaction re-checks the baseline
  // against what Firestore actually holds, so a save racing another writer's
  // commit aborts server-side instead of clobbering it.
  const saveLayoutVersion = useCallback(
    async (
      nextNodes: Record<string, unknown>,
      baseline?: BesignerSaveBaseline,
    ) => {
      await saveNodesGuarded(
        layoutVersionRef,
        { nodes: nextNodes as unknown as Aglyn.AglynLayoutVersion['nodes'] },
        baseline,
      )
    },
    [layoutVersionRef],
  )

  // Who else is in this document (AGL-675) and live co-editing (AGL-677) —
  // adopted from the screen editor (AGL-1301): the architecture already
  // carries a docType axis, layouts simply never wired it.
  const selectedNodeId = Besigner.focus.getLastSelected()?.$id
  const clearMirrorRef = useRef<(() => void) | undefined>(undefined)
  const { elements: canvasElements } = useRenderedCanvasElements()
  const getCanvasRoot = useCallback(
    () => canvasElements.current?.[Aglyn.CANVAS_ROOT_ELEMENT_ID]?.node,
    [canvasElements],
  )
  const presence = usePresence({
    hostId,
    docType: 'layout',
    docId: layoutId,
    versionId,
    selectedNodeId,
    broadcastCursor: true,
    getCanvasRoot,
  })

  // Canvas lifecycle, first load, concurrent-write detection (AGL-674) and
  // the size-guarded save (AGL-678) are identical in every besigner editor
  // and live in the shared hook (AGL-746). What stays here is what is
  // actually about a layout belonging to a host.
  const {
    saveAvailable,
    remoteChanged,
    draft,
    handleSave,
    saveWorkingDraft,
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
    save: saveLayoutVersion,
    noun: 'layout',
    viewType: Aglyn.HostViewType.LAYOUT,
    documentKey: `${hostId}:${layoutId}:${versionId}`,
    draft: {
      scope: hostId,
      kind: 'layout',
      docId: layoutId,
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
    // Tell the author what happens next when they are editing the LIVE
    // version. Without it the only feedback is "saved", the live page keeps
    // serving cached HTML for a moment, and the rational response is to save
    // again — which is the loop this message and the revalidate call above
    // exist to end together. A draft save says nothing about the live site,
    // because it does not touch it.
    savedMessage:
      versionId && versionId === layoutPublishedVersionId
        ? 'Layout saved — the live pages using it are refreshing now'
        : undefined,
    queueLoading,
    // Attribution (AGL-676): `updatedAt` carries no actor, so without this
    // "someone changed this" could never become "Sam changed this".
    onSaved: () => {
      // Records that the write LANDED, for `Save & publish` (AGL-1152).
      // `handleSave` resolves `void` whether it wrote or refused, and
      // `saveAvailable` is stale in the same tick — making a version live
      // after a refused save would publish bytes that were never stored.
      savedLandedRef.current = true
      // A save makes Firestore authoritative again, so the live mirror of
      // unsaved work has to go — otherwise the next person to join replays
      // edits that are already in the document (AGL-677).
      clearMirrorRef.current?.()
      // Editing the PUBLISHED version edits the live site, so its cached HTML
      // is stale the moment this returns. AGL-1150 wired revalidation to
      // PUBLISH only, which left the commonest case uncovered: an author
      // editing an already-live page saves, refreshes, sees the old page, and
      // saves again. Editing a DRAFT version changes nothing live and drops
      // nothing.
      //
      // Best effort and deliberately NOT awaited: the save has already
      // succeeded, and a cache hint that fails must never make a successful
      // save look failed. The revalidate window stays underneath as backstop.
      // A layout fans out to every screen rendered inside it, however deep —
      // the console route owns that graph, so it is given the layout id and
      // works out the screens itself.
      if (versionId && versionId === layoutPublishedVersionId) {
        // Reported, not discarded (AGL-1483). `revalidated: 0` reads the same
        // for "nothing was routed here, so there was nothing to drop" as it
        // does for "the tenant refused the call", and only the second leaves
        // the live page stale for the rest of its window. Discarding the
        // result is how a publish came to report itself complete over a page
        // that kept serving the old HTML.
        void revalidateLivePages({ user, hostId, layoutId }).then((result) => {
          const shortfall = describeRevalidateShortfall(result)
          if (shortfall) {
            enqueueSnackbar(shortfall, { variant: 'warning', persist: false })
          }
        })
      }
      return logActivity('Saved the layout', {
        type: 'layout',
        id: layoutId,
        name: layoutResult?.data?.displayName,
      })
    },
  })

  // Live co-editing (AGL-677). Rides the presence session's authenticated
  // RTDB app rather than brokering a second token.
  const coediting = useCoEditing({
    session: presence.session,
    docType: 'layout',
    docId: layoutId,
    versionId,
    storedStamp: (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    loaded: Aglyn.canvas.didSetInitial,
  })
  clearMirrorRef.current = coediting.clearMirror

  // The site's theme with this site's overrides resolved over it
  // (AGL-1021). The editor must render exactly what the tenant will.
  const hostTheme = useMemo(
    () => resolveSiteTheme(hostResult?.data),
    [hostResult?.data],
  )

  // Draft preview (AGL-1203). A layout previews as itself — its Layout Slot
  // stays empty because there is no screen to fill it, which is the honest
  // picture of the chrome being authored.
  /**
   * SAVE, THEN MAKE THIS VERSION THE LIVE ONE (AGL-1152).
   *
   * A layout's tree lives on its VERSION document and the tenant walks
   * `layouts/{id}` to find which one, so saving the version an author is on is
   * only live if the parent points at it. Saving a draft changes nothing a
   * visitor sees — the point of a draft, and the reason an author in one needs
   * a way to say "this one, now" without leaving the editor.
   *
   * A layout is chrome, so promoting one changes EVERY screen rendered inside
   * it; `revalidateLivePages` walks that fan-out rather than dropping one page.
   */
  /**
   * Saves the working draft rather than the layout the site is serving. See
   * the screens editor for why this cannot be a write to the version itself.
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
    enqueueSnackbar('Draft saved — the live site is unchanged.', {
      variant: 'success',
      persist: false,
    })
  }, [saveWorkingDraft, user, enqueueSnackbar])

  /**
   * Does the live site already match this version? Hoisted out of the
   * button's props (AGL-1483) because the HANDLER needs the same answer — it
   * is the difference between "nothing to publish" and "saved, but the live
   * site is still behind".
   */
  const livePublished =
    layoutPublishedVersionId === versionId && !draftPending && !draft.available

  const handleSaveAndPublish = useCallback(async () => {
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
     * Two different "did not write" cases, and only one should stop here. A
     * REFUSAL — a size guard, a concurrent edit — has already told the author
     * why, and promoting past it would push a canvas the document does not
     * hold. NOTHING TO SAVE is not a refusal: the document already has the
     * tree, so the promote is exactly the step left. `livePublished` tells
     * them apart, and is also what makes a second click on an up-to-date
     * document say so instead of republishing.
     */
    if (!savedLandedRef.current) {
      if (livePublished) {
        /*
          Nothing to promote, but that is not the same as nothing to do
          (AGL-2540).

          `livePublished` is a fact about the POINTER. "The live site matches"
          is a claim about the CACHE, and this path used to make it without
          checking. The two come apart whenever the version document's content
          moved while the pointer stood still — a direct Firestore write, an
          import, or an earlier publish whose revalidate the tenant refused.

          A layout fans out across every screen bound to it, so the stale
          window here is the widest of the four editors. Best effort like the
          success path.
        */
        void revalidateLivePages({ user, hostId, layoutId }).then((result) => {
          const shortfall = describeRevalidateShortfall(result)
          if (shortfall) {
            enqueueSnackbar(shortfall, { variant: 'warning', persist: false })
          }
        })
        return enqueueSnackbar(
          'Already published — refreshing the live pages to match.',
          { variant: 'info', persist: false },
        )
      }
      if (remoteChanged) return
    }
    if (layoutPublishedVersionId !== versionId) {
      await updateLayoutDoc({ versionId } as never)
    }
    // Not awaited: the writes have succeeded, and a cache hint that fails must
    // never make a completed publish look failed.
    // Reported, not discarded (AGL-1483). `revalidated: 0` reads the same
    // for "nothing was routed here, so there was nothing to drop" as it
    // does for "the tenant refused the call", and only the second leaves
    // the live page stale for the rest of its window. Discarding the
    // result is how a publish came to report itself complete over a page
    // that kept serving the old HTML.
    void revalidateLivePages({ user, hostId, layoutId }).then((result) => {
      const shortfall = describeRevalidateShortfall(result)
      if (shortfall) {
        enqueueSnackbar(shortfall, { variant: 'warning', persist: false })
      }
    })
    // Published, so the draft must stop being offered.
    void clearServerDraft(firestore, {
      scope: hostId,
      kind: 'layout',
      docId: layoutId,
      versionId,
    })
    setDraftPending(false)
  }, [
    firestore,
    handleSave,
    livePublished,
    remoteChanged,
    enqueueSnackbar,
    layoutPublishedVersionId,
    versionId,
    updateLayoutDoc,
    user,
    hostId,
    layoutId,
  ])

  const handlePreview = useOpenPreview({
    ids: hostId ? { hostId, kind: 'layout', docId: layoutId, versionId } : null,
    href: buildRoute(Route.LAYOUT_PREVIEW, {
      orgSlug,
      host,
      layoutId,
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
                        current={{ kind: 'layout', id: layoutId }}
                      />
                    }
                    actionsPrefix={
                      <>
                        <BesignerFunctionsButton hostId={hostId} />
                        <BesignerVersionsComponent
                          hostId={hostId}
                          parent={{ kind: 'layout', id: layoutId }}
                          versionId={versionId}
                          publishedVersionId={layoutPublishedVersionId}
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
                            children: saveAvailable ? 'Save' : 'Up to Date',
                            onClick: handleSave,
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
                          // Live only when the parent's pointer names THIS version.
                          livePublished={livePublished}
                          saveAvailable={saveAvailable}
                        />
                        <BesignerDraftAlertComponent
                          draft={draft}
                          noun="layout"
                          remoteChanged={remoteChanged}
                        />
                        {/* Shown as soon as their save lands, not on Save — finding out
                after twenty more minutes of editing is the bad version of
                this (AGL-674). */}
                        {remoteChanged && !draft.available ? (
                          <BesignerConflictAlertComponent noun="layout" />
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
                </BesignerMediaPickerProvider>
              </InteractionsProvider>
            </BindingPickerProvider>
          </ReusableComponentsProvider>
        </EntityPickerProvider>
      </Aglyn.ScreenLinkContext.Provider>
    </HostThemeDocumentContext.Provider>
  )
}

LayoutBesignerPage.displayName = 'Page:LayoutBesigner'

export default withSitePlugins(
  withBesignerContext(observer(LayoutBesignerPage)),
)
