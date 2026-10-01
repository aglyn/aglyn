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

import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/site-theme'
// By its own module rather than the barrel, as `useFormsPublishBlock` reads
// it: the site's plugin set `withSitePlugins` publishes to every editor.
import { useEnabledPlugins } from '@aglyn/aglyn/app-utils/enabled-plugins-context'
import type * as Aglyn from '@aglyn/aglyn'
import {
  canvas,
  CANVAS_ROOT_ELEMENT_ID,
  definitionToCanvasTree,
  ScreenLinkContext,
} from '@aglyn/aglyn'
import {
  besignerDocumentForSegment,
  besignerDocumentOffForSite,
  besignerDocumentTitle,
  besignerPublishRefusal,
} from '@aglyn/aglyn/plugin-manager/besigner-documents'
import * as Besigner from '@aglyn/besigner'
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
} from '@aglyn/shared-data-enums'
import { AppLink, useLoading } from '@aglyn/shared-ui-jsx'
import { LOADING_OVERLAY_ELEMENT } from '@aglyn/shared-ui-jsx/const/prebuilt-components'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import {
  saveNodesGuarded,
  useFirestore,
  useFirestoreDoc,
  useHostActivityLogger,
  useHostDocumentVersion,
  useHostDocumentVersionRef,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { useHost } from '../../../../../../../../../../hooks/use-host'
import { Stack, Typography } from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { notFound as routeNotFound, useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Dynamic site-plugin activation (AGL-417): the elements a plugin document
// exists to arrange are that plugin's, so the canvas is gated on the loader
// being ready.
import { withSitePlugins } from '../../../../../../../../../../components/console-plugins-gate.component'
import BesignerFunctionsButton from '../../../../../../../../../../components/besigner-functions-button.component'
import BindingPickerProvider from '../../../../../../../../../../components/binding-picker-provider.component'
import InteractionsProvider from '../../../../../../../../../../components/interactions-provider.component'
import BesignerMediaPickerProvider from '../../../../../../../../../../components/besigner-media-picker-provider.component'
import BesignerAppBarComponent from '../../../../../../../../../../components/besigner-app-bar.component'
import EntityPickerProvider from '../../../../../../../../../../components/entity-picker-provider.component'
import LinkTargetSearchProvider from '../../../../../../../../../../components/link-target-search-provider.component'
import ReusableComponentsProvider from '../../../../../../../../../../components/reusable-components-provider.component'
import BesignerWordmark from '../../../../../../../../../../components/layouts/besigner-wordmark.component'
import MainLayout from '../../../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../../../constants/app-setup'
import {
  buildRoute,
  Route,
} from '../../../../../../../../../../constants/route-links'
import useCollectionTemplates from '../../../../../../../../../../hooks/use-collection-templates'
import useOpenPreview from '../../../../../../../../../../hooks/use-open-preview'
import { isPreviewKind } from '../../../../../../../../../../utils/staff-site-links'
import useScreenLinkRoutes, {
  screenLinkLabels,
} from '../../../../../../../../../../hooks/use-screen-link-routes'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../../../../hooks/use-firestore-collection'
import usePluginDrawerRegistration from '../../../../../../../../../../hooks/use-plugin-drawer-registration'
import usePresence from '../../../../../../../../../../hooks/use-presence'
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

/** What a plugin document's parent carries that this editor reads. */
interface PluginDocumentParent {
  displayName?: string
  /** The version the site serves; the published copy is on this document. */
  versionId?: string
}

/**
 * THE BESIGNER FOR A DOCUMENT A PLUGIN KEEPS UNDER A SITE (AGL-3080).
 *
 * The segment names the kind, declared by the plugin that keeps it
 * (`plugin-manager/besigner-documents.ts`): where its documents live, what
 * one is called and how a version is published. Everything else is the
 * editor every besigner document gets — the canvas lifecycle, the guarded
 * save, the shared working draft, presence and preview.
 *
 * Publishing is the plugin's. The editor saves the version it holds, then
 * asks the plugin's publish route to make that version the one the site
 * serves; the route reads the stored version itself, refuses a design that
 * breaks what the document promises, writes the published copy and drops
 * the live pages that place it. A form is the case this was built for: it is
 * drawn AND it is a contract the submit route resolves by name, so a design
 * can stop the submissions arriving while still rendering perfectly.
 */
function PluginDocumentBesignerPage() {
  const params = useParams<{
    documentSegment: string
    docId: string
    versionId: string
  }>()
  const hostId = useHostId()
  const docId = params?.docId as string
  const versionId = params?.versionId as string
  const declared = besignerDocumentForSegment(params?.documentSegment)
  // The layout above already refuses a segment no plugin declared; this is
  // the same answer for a client navigation that lands here first.
  if (!declared) routeNotFound()
  const { kind, segment, collection: documentCollection, noun } = declared
  const nounTitle = besignerDocumentTitle(noun)
  const { enqueueSnackbar } = useSnackbar()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { queueLoading } = useLoading()
  const logActivity = useHostActivityLogger(hostId)
  const firestore = useFirestore()
  // The `author` host role edits content and may NOT publish it (AGL-2334).
  // Disabled with a reason rather than hidden, so the console says no instead
  // of the rules answering with a bare `permission-denied`.
  const { canPublish, loaded: hostRoleLoaded } = useHostRole(hostId)
  const publishBlock = hostRoleLoaded
    ? 'Your role on this site can edit content but not publish it'
    : 'Checking your access…'
  // Installed plugins as drawer entries and as the element panel's plugin
  // picker (AGL-1030). The elements a plugin document is made of are plugin
  // components, so without this the drawer has nothing this editor is for.
  usePluginDrawerRegistration(hostId)
  const handleAddElementClick = useAddElementDrawerCallback()
  // Back and Close both land on the document's own page in its plugin rather
  // than the list: what the design has to satisfy is edited there, so it is
  // where an author goes next.
  const detailsUrl = buildRoute(Route.PLUGIN_DOCUMENT_DETAILS, {
    orgSlug,
    host,
    documentSegment: segment,
    docId,
  })
  const { doc: hostResult } = useHost({ hostId })
  /** The document itself: its name and the version the site serves. */
  const parentResult = useFirestoreDoc<PluginDocumentParent>(
    () =>
      hostId && docId
        ? doc(firestore, 'hosts', hostId, documentCollection, docId)
        : null,
    [firestore, hostId, documentCollection, docId],
  )
  const parentDoc = parentResult.data
  // The browser tab names THIS document, not just its site (AGL-2486).
  useDeclareDocumentSubject(docId, parentDoc?.displayName)
  const { data: user } = useUser()
  const publishedVersionId = parentDoc?.versionId
  /**
   * Did the last save actually LAND? (AGL-1152)
   *
   * `handleSave` resolves `void` whether it wrote or refused — a size guard, a
   * concurrent edit, or nothing-to-save all return early — and `saveAvailable`
   * is React state that is still stale in the same tick. `onSaved` fires only
   * on a real write, so this is the one signal `Save & publish` can trust
   * before promoting.
   */
  const savedLandedRef = useRef(false)
  /**
   * Was the last save REFUSED, as opposed to having nothing to do? (AGL-2877)
   *
   * `savedLandedRef` staying false cannot tell the two apart, and they need
   * opposite handling: nothing-to-save promotes, a refusal must not. Nor can
   * `remoteChanged`, which is React state and still false in this tick for a
   * conflict the save itself discovered — without this, a stale-baseline
   * refusal is followed by publishing this canvas onto the document every
   * page that places it renders.
   */
  const saveRefusedRef = useRef(false)

  /**
   * Has this version been SAVED since it was last promoted? (AGL-1152)
   *
   * `publishedVersionId === versionId` only says the parent was promoted from
   * this version at some point — a later save writes the VERSION document and
   * leaves the PARENT, which is what a live page renders the document from,
   * behind. So the pointer alone cannot answer "is the live site current".
   */
  const [savedSincePublish, setSavedSincePublish] = useState(false)
  /**
   * Only the LIVE version has a draft (AGL-1152) — and for a document with a
   * published copy the test is not the pointer alone, for the same reason the
   * save button's is not.
   */
  const editingLiveVersion = Boolean(
    versionId && versionId === publishedVersionId,
  )
  const [draftPending, setDraftPending] = useState(false)
  // Id-based screen links: a document's copy can contain a link, so the
  // canvas needs the routing map to resolve hrefs and the Attributes panel
  // needs screen names for the screen-select field.
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // What the SITE serves, not what publishing wrote (AGL-1998): a picker that
  // offers a path the tenant router 404s hands the author a dead anchor.
  const collectionTemplates = useCollectionTemplates(hostId)
  const linkableRoutes = useScreenLinkRoutes({
    templates: collectionTemplates,
    routingMap: hostResult?.data?.screens as Record<string, string> | undefined,
    screens: screenDocs,
  })
  const screenLinks = useMemo(
    () => ({
      screens: linkableRoutes,
      labels: screenLinkLabels(screenDocs, {
        listingTargets: collectionTemplates.listingTargets,
      }),
      suppressNavigation: true,
      // Static canvas: interactions inert, menus/drawers show editor
      // affordance (AGL-830). A form on the canvas must not submit.
      editorInert: true,
    }),
    [linkableRoutes, screenDocs, collectionTemplates.listingTargets],
  )
  const versionIds = { hostId, collection: documentCollection, docId, versionId }
  const { doc: result } = useHostDocumentVersion(versionIds)
  const versionRef = useHostDocumentVersionRef(versionIds)
  const { data, status, error, hasPendingWrites } = result
  const nodes = data?.nodes

  // The canvas is a singleton shared by every editing session; without a
  // reset on leave, client-side navigation to another document keeps (and
  // could save) this document's nodes.
  useEffect(() => {
    return () => {
      canvas.reset()
      Besigner.focus.clearFocusStatus()
    }
  }, [hostId, documentCollection, docId, versionId])

  useEffect(() => {
    if (status === 'loading') {
      return queueLoading()
    }
  }, [status])

  // Conditional write (AGL-1301): the transaction re-checks the baseline
  // against what Firestore actually holds, so a save racing another writer's
  // commit aborts server-side instead of clobbering it.
  const saveVersion = useCallback(
    async (
      nextNodes: Record<string, unknown>,
      baseline?: BesignerSaveBaseline,
    ) => {
      await saveNodesGuarded(
        versionRef,
        {
          nodes: nextNodes as Record<Aglyn.NodeId, Aglyn.AglynNodeSchema>,
        },
        baseline,
      )
    },
    [versionRef],
  )

  // Who else is in this document (AGL-675).
  const selectedNodeId = Besigner.focus.getLastSelected()?.$id
  const { elements: canvasElements } = useRenderedCanvasElements()
  const getCanvasRoot = useCallback(
    () => canvasElements.current?.[CANVAS_ROOT_ELEMENT_ID]?.node,
    [canvasElements],
  )
  const presence = usePresence({
    hostId,
    docType: kind,
    docId,
    versionId,
    selectedNodeId,
    broadcastCursor: true,
    getCanvasRoot,
  })

  // Canvas lifecycle, first load, concurrent-write detection (AGL-674) and
  // the size-guarded save (AGL-678) are shared by every besigner editor
  // (AGL-746). What stays here is what is actually about a plugin document.
  const {
    saveAvailable,
    remoteChanged,
    draft,
    handleSave,
    saveWorkingDraft,
    workingDraftSaved,
    refuseOverUnopenedDraft,
    hasError,
    notFound,
  } = useBesignerDocument({
    nodes,
    updatedAt: (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    pendingWrites: hasPendingWrites,
    status,
    error,
    save: saveVersion,
    noun,
    documentKey: `${hostId}:${kind}:${docId}:${versionId}`,
    draft: {
      scope: hostId,
      kind,
      docId,
      versionId,
    },
    // The SHARED working draft, live version only.
    firestore: editingLiveVersion ? firestore : undefined,
    // The crash-recovery prompt is withheld while anyone else is in this
    // room (AGL-2486): the mirror already has the unsaved work, so there is
    // nothing to recover and both of its buttons could only take something
    // away.
    roomSessions: recoverableRoomSessions(
      presence.status,
      presence.entries.length,
    ),
    notify: enqueueSnackbar,
    // A save writes the VERSION document, and a live page renders the
    // document from the PARENT — so on a draft version the honest next step
    // to name is the publish, never "wait". Suppressed on the live version,
    // where `handleSaveAndPublish` owns the message and can only write it
    // once the publish has resolved.
    savedMessage:
      publishedVersionId === versionId
        ? undefined
        : `${nounTitle} saved to this version. Publish it to update the live pages.`,
    queueLoading,
    // The refusal half of `onSaved`: together they let `handleSaveAndPublish`
    // tell a document that needs no save from one that could not be saved.
    onSaveRefused: () => {
      saveRefusedRef.current = true
    },
    // A definition's root is the promoted node, not the canvas root, so it
    // has to be wrapped or the canvas has no root and renders nothing
    // (AGL-680).
    toCanvasNodes: (storedNodes) =>
      definitionToCanvasTree({
        rootId: data?.rootId,
        nodes: storedNodes as Record<string, unknown>,
      }) as Aglyn.ProcessableNodes,
    onSaved: () => {
      // Records that the write LANDED (AGL-1152) — `handleSave` resolves
      // `void` whether it wrote or refused, so this is the only signal
      // `Save & publish` can chain on.
      savedLandedRef.current = true
      // The version moved; the parent did not. Until a publish the live site
      // is behind, and the button should say so rather than "Up to date".
      setSavedSincePublish(true)
      return logActivity(`Saved the ${noun}`, {
        // `content` rather than a new activity type: the presenter branches
        // on this persisted value, and a member it does not know renders as
        // an unlinked row.
        type: 'content',
        id: docId,
        name: parentDoc?.displayName,
      })
    },
  })

  const [publishing, setPublishing] = useState(false)
  // Whether the document's plugin runs on this site: `undefined` where no
  // site set was published to the editor, which refuses nothing.
  const enabledPlugins = useEnabledPlugins()
  const pluginOnForSite = enabledPlugins
    ? enabledPlugins.includes(declared.pluginId)
    : undefined

  /**
   * Publish: ask the document's plugin to make this version the one the site
   * serves — and say plainly when it refuses.
   *
   * Nothing about the design crosses the wire. The plugin's route reads the
   * stored version itself, which is why every publish follows a save: the
   * version it reads is the canvas. A refusal answers the violations the
   * design would introduce, and the first of them is shown in full with a
   * count of the rest. `quiet` is the republish of a version the site already
   * serves, which says nothing on success because the caller already has.
   *
   * Answers whether the plugin published it.
   */
  const publishVersion = useCallback(
    async (options?: { quiet?: boolean }): Promise<boolean> => {
      // The plugin's route sits behind the site's switch and would answer as
      // though it did not exist, so the editor says why before asking it.
      if (pluginOnForSite === false) {
        enqueueSnackbar(besignerDocumentOffForSite(declared), {
          variant: 'warning',
          allowDuplicate: true,
          persist: true,
        })
        return false
      }
      setPublishing(true)
      try {
        const response = await authorizedFetch(user, declared.publish.path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            [declared.publish.idField]: docId,
            versionId,
          }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          // `persist` because this is a refusal an author has to act on: an
          // auto-dismissed warning is how someone walks away believing the
          // document shipped.
          enqueueSnackbar(besignerPublishRefusal(body, noun), {
            variant: response.status >= 500 ? 'error' : 'warning',
            allowDuplicate: true,
            persist: true,
          })
          return false
        }
        setSavedSincePublish(false)
        if (!options?.quiet) {
          enqueueSnackbar('Published. The live sites now serve this design.', {
            variant: 'success',
            persist: false,
          })
        }
        return true
      } catch (error) {
        // A publish that throws must never read like a success (AGL-1334).
        enqueueSnackbar(publishFailureMessage(error), {
          variant: 'error',
          allowDuplicate: true,
          persist: true,
        })
        return false
      } finally {
        setPublishing(false)
      }
    },
    [
      pluginOnForSite,
      user,
      declared,
      hostId,
      docId,
      versionId,
      noun,
      enqueueSnackbar,
    ],
  )

  /**
   * Saves the working draft rather than the document the sites are serving.
   */
  const handleSaveDraft = useCallback(async () => {
    // A saved draft on offer is replaced by the next draft save (AGL-2874).
    if (refuseOverUnopenedDraft('save')) return
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
    // the click.
    if (wrote === 'unchanged') {
      enqueueSnackbar('Already saved — nothing new to save.', {
        variant: 'info',
        persist: false,
      })
      return
    }
    setDraftPending(true)
    enqueueSnackbar('Draft saved — the live sites are unchanged.', {
      variant: 'success',
      persist: false,
    })
  }, [refuseOverUnopenedDraft, saveWorkingDraft, user, enqueueSnackbar])

  /**
   * SAVE DRAFT — one action, wherever it is reached from (AGL-2868).
   *
   * The toolbar and File ▸ Save draft both call this: the shared working
   * draft on the version the sites are serving, the version itself anywhere
   * else. Two controls under one name must never write two different
   * documents — whichever one an author checks afterwards has to be the one
   * the other control wrote.
   */
  const saveDraft = editingLiveVersion ? handleSaveDraft : handleSave

  /**
   * Do the live sites already match this version?
   *
   * A plugin document is live only once its tree has been published onto the
   * PARENT document — the pointer alone is not enough, which is the asymmetry
   * with screens. An unpublished draft makes the sites out of date just as
   * surely as an unpublished save does.
   */
  const livePublished =
    publishedVersionId === versionId &&
    !savedSincePublish &&
    !draftPending &&
    !draft.available

  const handleSaveAndPublish = useCallback(async () => {
    if (publishing) return
    // Publishing a canvas that never took in the saved draft on offer would
    // push the stored design live and then clear the draft as published
    // (AGL-2874).
    if (refuseOverUnopenedDraft('publish')) return
    savedLandedRef.current = false
    saveRefusedRef.current = false
    await handleSave()
    // A REFUSED save stops here, before anything is promoted, revalidated or
    // cleared (AGL-2877). The refusal has already said why.
    if (saveRefusedRef.current) return
    /**
     * A save that did not write is not a reason to stop (AGL-1483).
     *
     * Two different "did not write" cases, and only one of them should stop
     * here. A REFUSAL — a size guard, a concurrent edit — has already told
     * the author why, and promoting past it would push a canvas the document
     * does not hold. NOTHING TO SAVE is not a refusal: the document already
     * has the tree, so the promote is exactly the step that is left.
     */
    if (!savedLandedRef.current) {
      if (livePublished) {
        /*
          Nothing to promote, but that is not the same as nothing to do
          (AGL-2540).

          `livePublished` is a fact about the POINTER. "The live sites match"
          is a claim about the CACHE, and this path used to make it without
          checking. The two come apart whenever the version document's content
          moved while the pointer stood still — a direct Firestore write, an
          import, or an earlier publish whose revalidate the tenant refused.

          A placed document lives on pages that are cached separately from it,
          and the plugin's publish is what walks them — so the version the site
          already serves is published again, which drops those pages.
        */
        enqueueSnackbar(
          'Already published — refreshing the live pages to match.',
          { variant: 'info', persist: false },
        )
        await publishVersion({ quiet: true })
        return
      }
      if (remoteChanged) return
    }
    await publishVersion()
    // Only a draft this canvas took in is published by this; one withheld
    // from a shared room and never opened is still somebody's unpublished
    // work (AGL-2874).
    if (!draft.sharedDraftUnopened) {
      void clearServerDraft(firestore, {
        scope: hostId,
        kind,
        docId,
        versionId,
      })
    }
    setDraftPending(false)
  }, [
    publishing,
    refuseOverUnopenedDraft,
    handleSave,
    publishVersion,
    livePublished,
    remoteChanged,
    enqueueSnackbar,
    firestore,
    draft.sharedDraftUnopened,
    hostId,
    kind,
    docId,
    versionId,
  ])

  // The site's theme with this site's overrides resolved over it
  // (AGL-1021). The editor must render exactly what the tenant will.
  const hostTheme = useMemo(
    () => resolveSiteTheme(hostResult?.data),
    [hostResult?.data],
  )

  // Draft preview (AGL-1203): a placed document renders on its own, so the
  // canvas snapshot is the whole story — no layout chain to compose. Only a
  // kind the preview surface knows how to compose offers one.
  const handlePreview = useOpenPreview({
    ids:
      hostId && isPreviewKind(kind)
        ? {
            hostId,
            kind,
            docId,
            versionId,
          }
        : null,
    href: buildRoute(Route.PLUGIN_DOCUMENT_PREVIEW, {
      orgSlug,
      host,
      documentSegment: segment,
      docId,
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
      enqueueSnackbar(`404: ${nounTitle} not found`, {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [enqueueSnackbar, hasError, error, notFound, nounTitle])

  return (
    <HostThemeDocumentContext.Provider value={hostTheme}>
      <ScreenLinkContext.Provider value={screenLinks}>
        {/* Entries as link targets (AGL-3119): the link pickers below search
            this host's collections as the author types, rather than reading
            every entry into a dropdown. */}
        <LinkTargetSearchProvider
          hostId={hostId}
          collections={collectionTemplates.listingTargets}
        >
        <EntityPickerProvider hostId={hostId}>
          {/* This canvas IS the document, and a placed document's design can
              name itself, so its published copy is withheld from the graft. */}
          <ReusableComponentsProvider
            hostId={hostId}
            editingDocument={{ kind, id: docId }}
          >
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
                    wordmark={<BesignerWordmark />}
                    actionsPrefix={<BesignerFunctionsButton hostId={hostId} />}
                    backButton={
                      {
                        component: AppLink,
                        componentVariant: 'naked',
                        href: detailsUrl,
                      } as any
                    }
                    centerNavigationItems={[
                      {
                        id: 'center-nav-file',
                        children: 'File',
                        items: [
                          {
                            // Named for the action, never for the canvas's
                            // state: an entry reading "Up to Date" is not one
                            // anybody recognizes as the way to save. A click
                            // with nothing to store still answers.
                            id: 'center-nav-file-save',
                            icon: { path: ICON_VARIANT_MODIFY_SAVE.path },
                            children: 'Save draft',
                            onClick: saveDraft,
                          },
                          {
                            id: 'center-nav-file-save-publish',
                            disabled: publishing || !canPublish,
                            children: 'Save & publish',
                            // A disabled menu item with no reason reads as a
                            // bug. The secondary line says which reason it is.
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
                            id: 'center-nav-file-close',
                            children: 'Close',
                            href: detailsUrl,
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
                            onClick: () => canvas.undo(),
                            disabled: !canvas.canUndo,
                            ListItemTextProps: { inset: true },
                          },
                          {
                            id: 'center-nav-edit-redo',
                            children: 'Redo',
                            onClick: () => canvas.redo(),
                            disabled: !canvas.canRedo,
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
                            // Capture the current selection as the insert
                            // target when the picker opens. Passing the
                            // callback directly hands the menu click event in
                            // as `parent` (AGL-537).
                            onClick: () =>
                              handleAddElementClick(
                                Besigner.focus.getLastSelected(),
                              ),
                          },
                        ],
                      },
                    ]}
                  >
                    {/* `hasError`, not the raw `error` — see the screens
            besigner (AGL-1066). */}
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
                          detailsUrl={detailsUrl}
                          presence={<PresenceAvatars presence={presence} />}
                          onSave={saveDraft}
                          onSaveAndPublish={handleSaveAndPublish}
                          // A plugin document is live only once its tree has
                          // been published onto the PARENT document — the
                          // pointer alone is not enough.
                          livePublished={livePublished}
                          publishBlockedReason={
                            canPublish ? undefined : publishBlock
                          }
                          saveAvailable={saveAvailable}
                          // Save draft writes the draft document, not
                          // this version, so the canvas never reads
                          // clean while a draft is waiting — this is
                          // what still lets the button say Publish
                          // (AGL-3271).
                          draftSaved={workingDraftSaved}
                        />
                        <BesignerDraftAlertComponent
                          draft={draft}
                          noun={noun}
                          remoteChanged={remoteChanged}
                        />
                        {/* Shown as soon as their save lands, not on Save —
                finding out after twenty more minutes of editing is the
                bad version of this (AGL-674). */}
                        {remoteChanged && !draft.available ? (
                          <BesignerConflictAlertComponent noun={noun} />
                        ) : null}
                        <WorkspaceEditorComponent>
                          <ViewportRootComponent>
                            <ViewportCanvasComponent />
                          </ViewportRootComponent>
                        </WorkspaceEditorComponent>
                      </>
                    )}
                  </MainLayout>
                </BesignerMediaPickerProvider>
              </InteractionsProvider>
            </BindingPickerProvider>
          </ReusableComponentsProvider>
        </EntityPickerProvider>
        </LinkTargetSearchProvider>
      </ScreenLinkContext.Provider>
    </HostThemeDocumentContext.Provider>
  )
}

PluginDocumentBesignerPage.displayName = 'Page:PluginDocumentBesigner'

export default withSitePlugins(
  withBesignerContext(observer(PluginDocumentBesignerPage)),
)
