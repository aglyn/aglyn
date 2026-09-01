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
  useFirestore,
  useFirestoreDoc,
  useFormVersion,
  useFormVersionRef,
  useHost,
  useHostActivityLogger,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import { Bytes, collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Dynamic site-plugin activation (AGL-417): the `form` and `formField`
// components this editor exists to arrange are plugin-registered, so the
// canvas is gated on the loader being ready.
import { withSitePlugins } from '../../../../../../../../../../components/console-plugins-gate.component'
import BesignerFunctionsButton from '../../../../../../../../../../components/besigner-functions-button.component'
import BindingPickerProvider from '../../../../../../../../../../components/binding-picker-provider.component'
import InteractionsProvider from '../../../../../../../../../../components/interactions-provider.component'
import BesignerMediaPickerProvider from '../../../../../../../../../../components/besigner-media-picker-provider.component'
import BesignerAppBarComponent from '../../../../../../../../../../components/besigner-app-bar.component'
import EntityPickerProvider from '../../../../../../../../../../components/entity-picker-provider.component'
import ReusableComponentsProvider from '../../../../../../../../../../components/reusable-components-provider.component'
import MainLayout from '../../../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../../../constants/app-setup'
import {
  buildRoute,
  Route,
} from '../../../../../../../../../../constants/route-links'
import useCollectionTemplates from '../../../../../../../../../../hooks/use-collection-templates'
import useOpenPreview from '../../../../../../../../../../hooks/use-open-preview'
import revalidateLivePages from '../../../../../../../../../../utils/revalidate-live-pages'
import useScreenLinkRoutes from '../../../../../../../../../../hooks/use-screen-link-routes'
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

/**
 * The plugin component id a form node carries. The contract check and the
 * field-declaration read both key off it, so the search for the node and the
 * two functions that consume it agree by construction.
 */
const FORM_COMPONENT_ID = 'form'

/**
 * Author-facing summary of everything blocking a publish.
 *
 * The first violation in full plus a count, rather than every message joined:
 * the messages are sentences, and a stack of six of them in one snackbar is
 * read as a wall rather than as instructions. The count is what says the list
 * does not end at the one being shown.
 */
function publishBlockedByContract(
  violations: Aglyn.FormContractViolation[],
): string {
  const [first, ...rest] = violations
  const message = first?.message ?? ''
  if (!rest.length) return message
  return (
    `${message} There ${rest.length === 1 ? 'is' : 'are'} ${rest.length} ` +
    `other problem${rest.length === 1 ? '' : 's'} to fix before this form ` +
    'can be published.'
  )
}

function FormBesignerPage() {
  const params = useParams<{
    hostId: string
    formId: string
    versionId: string
  }>()
  const hostId = useHostId()
  const formId = params?.formId as string
  const versionId = params?.versionId as string
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
  // picker (AGL-1030). `form` and `formField` are themselves plugin
  // components, so without this the drawer has nothing this editor is for.
  usePluginDrawerRegistration(hostId)
  const handleAddElementClick = useAddElementDrawerCallback()
  // Back and Close both land on the form's own detail page rather than the
  // list: the declaration the design has to satisfy — routing, the consent
  // field — is edited there, so it is where an author goes next.
  const detailsUrl = buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId })
  const { doc: hostResult } = useHost({ hostId })
  /**
   * The form document itself — the PUBLISHED design and, more importantly
   * here, the declaration the design has to keep satisfying: what it
   * `routing`s to and which field it reads consent from.
   */
  const formResult = useFirestoreDoc<Aglyn.FormDocument>(
    () =>
      hostId && formId ? doc(firestore, 'hosts', hostId, 'forms', formId) : null,
    [firestore, hostId, formId],
  )
  const formDoc = formResult.data
  // The browser tab names THIS document, not just its site (AGL-2486).
  useDeclareDocumentSubject(formId, formDoc?.displayName)
  const { data: user } = useUser()
  const publishedVersionId = formDoc?.versionId
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
   * Has this version been SAVED since it was last promoted? (AGL-1152)
   *
   * `publishedVersionId === versionId` only says the parent was promoted from
   * this version at some point — a later save writes the VERSION document and
   * leaves the PARENT, which is what a live page renders the form from,
   * behind. So the pointer alone cannot answer "is the live site current".
   */
  const [savedSincePublish, setSavedSincePublish] = useState(false)
  /**
   * Only the LIVE version has a draft (AGL-1152) — and for a form the test is
   * not the pointer alone, for the same reason the save button's is not.
   */
  const editingLiveVersion = Boolean(
    versionId && versionId === publishedVersionId,
  )
  const [draftPending, setDraftPending] = useState(false)
  // Id-based screen links: a form's confirmation copy or its surrounding
  // layout can contain a link, so the canvas needs the routing map to resolve
  // hrefs and the Attributes panel needs screen names for the screen-select
  // field.
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
      labels: Object.fromEntries(
        (screenDocs ?? []).map((screen: any) => [
          screen.$id,
          screen.displayName ?? screen.$id,
        ]),
      ),
      suppressNavigation: true,
      // Static canvas: interactions inert, menus/drawers show editor
      // affordance (AGL-830). A form on the canvas must not submit.
      editorInert: true,
    }),
    [linkableRoutes, screenDocs],
  )
  const { doc: result } = useFormVersion({ hostId, formId, versionId })
  const formVersionRef = useFormVersionRef({ hostId, formId, versionId })
  const { data, status, error, hasPendingWrites } = result
  const nodes = data?.nodes

  // The canvas is a singleton shared by every editing session; without a
  // reset on leave, client-side navigation to another document keeps (and
  // could save) this form's nodes.
  useEffect(() => {
    return () => {
      Aglyn.canvas.reset()
      Besigner.focus.clearFocusStatus()
    }
  }, [hostId, formId, versionId])

  useEffect(() => {
    if (status === 'loading') {
      return queueLoading()
    }
  }, [status])

  // Conditional write (AGL-1301): the transaction re-checks the baseline
  // against what Firestore actually holds, so a save racing another writer's
  // commit aborts server-side instead of clobbering it.
  const saveFormVersion = useCallback(
    async (
      nextNodes: Record<string, unknown>,
      baseline?: BesignerSaveBaseline,
    ) => {
      await saveNodesGuarded(
        formVersionRef,
        {
          nodes: nextNodes as unknown as Aglyn.FormVersion['nodes'],
        },
        baseline,
      )
    },
    [formVersionRef],
  )

  // Who else is in this document (AGL-675).
  const selectedNodeId = Besigner.focus.getLastSelected()?.$id
  const { elements: canvasElements } = useRenderedCanvasElements()
  const getCanvasRoot = useCallback(
    () => canvasElements.current?.[Aglyn.CANVAS_ROOT_ELEMENT_ID]?.node,
    [canvasElements],
  )
  const presence = usePresence({
    hostId,
    docType: 'form',
    docId: formId,
    versionId,
    selectedNodeId,
    broadcastCursor: true,
    getCanvasRoot,
  })

  // Canvas lifecycle, first load, concurrent-write detection (AGL-674) and
  // the size-guarded save (AGL-678) are shared by every besigner editor
  // (AGL-746). What stays here is what is actually about a form.
  const {
    saveAvailable,
    remoteChanged,
    draft,
    handleSave,
    saveWorkingDraft,
    hasError,
    notFound,
  } = useBesignerDocument({
    nodes,
    updatedAt: (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    pendingWrites: hasPendingWrites,
    status,
    error,
    save: saveFormVersion,
    noun: 'form',
    documentKey: `${hostId}:${formId}:${versionId}`,
    draft: {
      scope: hostId,
      kind: 'form',
      docId: formId,
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
    // A form save writes the VERSION document, and a live page renders the
    // form from the PARENT — so on a draft version the honest next step to
    // name is the publish, never "wait". Suppressed on the live version,
    // where `handleSaveAndPublish` owns the message and can only write it
    // once the promote has resolved.
    savedMessage:
      publishedVersionId === versionId
        ? undefined
        : 'Form saved to this version. Publish it to update the live pages.',
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
      // Records that the write LANDED (AGL-1152) — `handleSave` resolves
      // `void` whether it wrote or refused, so this is the only signal
      // `Save & publish` can chain on.
      savedLandedRef.current = true
      // The version moved; the parent did not. Until a publish the live site
      // is behind, and the button should say so rather than "Up to date".
      setSavedSincePublish(true)
      return logActivity('Saved the form', {
        // `content` rather than a new activity type: the presenter branches
        // on this persisted value, and a member it does not know renders as
        // an unlinked row.
        type: 'content',
        id: formId,
        name: formDoc?.displayName,
      })
    },
  })

  const [publishing, setPublishing] = useState(false)

  /**
   * Publish: copy this version's tree onto the form document — AND refuse to,
   * when the design would stop the submissions arriving.
   *
   * This is the one way a form editor is not a component editor. A component
   * is only ever drawn, so its publish is a copy. A form is drawn AND it is a
   * contract: `/api/forms/submit` keys submissions on the id the form node
   * carries, reads consent out of a field the document NAMES, and creates a
   * lead from an address it expects to find. Every one of those couplings is
   * resolved by name at submit time, so the design can break them — and every
   * break is silent. The form still renders, the visitor still submits, the
   * row still lands, and the thing the merchant believed they were collecting
   * is simply not there.
   *
   * So the check runs on the tree that is ABOUT to be written, not on the one
   * that is stored, and a violation stops the write. `checkFormContract` is
   * the pure module that owns which couplings those are; this function's only
   * job is to run it at the moment it can still say no.
   */
  const promoteToSites = useCallback(async () => {
    setPublishing(true)
    try {
      // Unwrap the synthetic canvas root: a placed form grafts from `rootId`,
      // so publishing the wrapper would put an always-empty container around
      // every instance (AGL-680).
      const definition = Aglyn.canvasTreeToDefinition(
        Aglyn.canvas.toJSON().nodes as Record<string, unknown>,
      )
      if (definition.ambiguousRoot) {
        return enqueueSnackbar(
          'A form needs a single top-level element. Wrap what you have in ' +
            'one container, then publish.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      const formNodeId = Object.keys(definition.nodes).find(
        (nodeId) =>
          definition.nodes[nodeId]?.componentId === FORM_COMPONENT_ID,
      )
      const violations = Aglyn.checkFormContract({
        form: formDoc,
        formId,
        nodes: definition.nodes,
        formNodeId,
      })
      if (!Aglyn.formContractIsSatisfied(violations)) {
        // `persist` because this is a refusal an author has to act on: an
        // auto-dismissed warning is how someone walks away believing the
        // form shipped.
        return enqueueSnackbar(publishBlockedByContract(violations), {
          variant: 'warning',
          allowDuplicate: true,
          persist: true,
        })
      }
      const publishedNodes = definition.nodes
      const rootId = definition.rootId ?? formDoc?.rootId
      /**
       * The DECLARATION publishes with the DESIGN.
       *
       * `fields` is what the submit route validates against and what the
       * detail page's consent-field picker offers; `nodes` is what the author
       * drew. Writing one without the other is how they drift, and the drift
       * is exactly what the check above just refused to ship — so the two go
       * out in a single write, derived from the same tree.
       *
       * `checkFormContract` reports `form-node-missing` when there is no form
       * node, so reaching here means this id resolved.
       */
      const fields = Aglyn.formFieldDeclsFromNodes(
        definition.nodes,
        formNodeId as Aglyn.NodeId,
      )
      await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), {
        // Compressed at rest (AGL-1151), like the version this promotes from
        // and like the server promote route that writes the same document.
        nodes: Bytes.fromUint8Array(Aglyn.encodeStoredNodes(publishedNodes)!),
        ...(rootId ? { rootId } : {}),
        fields,
        versionId,
        updatedAt: Timestamp.now(),
      })
      setSavedSincePublish(false)
      /*
       * Make the sentence below true.
       *
       * Every page that PLACES this form renders the design just written, so
       * each of them is now serving fields the form no longer has. The console
       * route owns the fan-out — it is the side holding both the node graph and
       * the tenant's cache keys — and this fires without awaiting, as every
       * other publish surface does: the write already landed, and a cache hint
       * that fails must never make a successful publish look failed.
       */
      void revalidateLivePages({ user, hostId, formId: formId as string })
      enqueueSnackbar(
        'Published. The live sites now serve this design, and the form’s ' +
          'declared fields match it.',
        { variant: 'success', persist: false },
      )
    } catch (error) {
      // A publish that throws must never read like a success (AGL-1334).
      enqueueSnackbar(publishFailureMessage(error), {
        variant: 'error',
        allowDuplicate: true,
        persist: true,
      })
    } finally {
      setPublishing(false)
    }
  }, [firestore, hostId, formId, versionId, formDoc, enqueueSnackbar])

  /**
   * Saves the working draft rather than the form the sites are serving.
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
    // the click.
    if (wrote === 'unchanged') {
      enqueueSnackbar('Already saved — the draft is up to date.', {
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
  }, [saveWorkingDraft, user, enqueueSnackbar])

  /**
   * Do the live sites already match this version?
   *
   * A form is live only once its tree has been promoted onto the PARENT
   * document — the pointer alone is not enough, which is the asymmetry with
   * screens. An unpublished draft makes the sites out of date just as surely
   * as an unpromoted save does.
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
     * Two different "did not write" cases, and only one of them should stop
     * here. A REFUSAL — a size guard, a concurrent edit — has already told
     * the author why, and promoting past it would push a canvas the document
     * does not hold. NOTHING TO SAVE is not a refusal: the document already
     * has the tree, so the promote is exactly the step that is left.
     */
    if (!savedLandedRef.current) {
      if (livePublished) {
        return enqueueSnackbar(
          'Already published — the live sites match this version.',
          { variant: 'info', persist: false },
        )
      }
      if (remoteChanged) return
    }
    await promoteToSites()
    void clearServerDraft(firestore, {
      scope: hostId,
      kind: 'form',
      docId: formId,
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
    formId,
    versionId,
  ])

  // The site's theme with this site's overrides resolved over it
  // (AGL-1021). The editor must render exactly what the tenant will.
  const hostTheme = useMemo(
    () => resolveSiteTheme(hostResult?.data),
    [hostResult?.data],
  )

  // Draft preview (AGL-1203): a form renders on its own, so the canvas
  // snapshot is the whole story — no layout chain to compose.
  const handlePreview = useOpenPreview({
    ids: hostId
      ? {
          hostId,
          kind: 'form',
          docId: formId,
          versionId,
        }
      : null,
    href: buildRoute(Route.FORM_PREVIEW, {
      orgSlug,
      host,
      formId,
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
      enqueueSnackbar('404: Form not found', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [enqueueSnackbar, hasError, error, notFound])

  return (
    <HostThemeDocumentContext.Provider value={hostTheme}>
      <Aglyn.ScreenLinkContext.Provider value={screenLinks}>
        <EntityPickerProvider hostId={hostId}>
          {/* This canvas IS the form, and a form design names itself, so its
              published copy is withheld from the placed-form graft. */}
          <ReusableComponentsProvider
            hostId={hostId}
            editingFormId={formId as string}
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
                          onSave={
                            editingLiveVersion ? handleSaveDraft : handleSave
                          }
                          onSaveAndPublish={handleSaveAndPublish}
                          // A form is live only once its tree has been
                          // promoted onto the PARENT document — the pointer
                          // alone is not enough.
                          livePublished={livePublished}
                          publishBlockedReason={
                            canPublish ? undefined : publishBlock
                          }
                          saveAvailable={saveAvailable}
                        />
                        <BesignerDraftAlertComponent
                          draft={draft}
                          noun="form"
                          remoteChanged={remoteChanged}
                        />
                        {/* Shown as soon as their save lands, not on Save —
                finding out after twenty more minutes of editing is the
                bad version of this (AGL-674). */}
                        {remoteChanged && !draft.available ? (
                          <BesignerConflictAlertComponent noun="form" />
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
      </Aglyn.ScreenLinkContext.Provider>
    </HostThemeDocumentContext.Provider>
  )
}

FormBesignerPage.displayName = 'Page:FormBesigner'

export default withSitePlugins(withBesignerContext(observer(FormBesignerPage)))
