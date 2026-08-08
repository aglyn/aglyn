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
  useAddElementDrawerCallback,
  useBesignerDocument,
  useRenderedCanvasElements,
  withBesignerContext,
  type BesignerSaveBaseline,
  type WorkspaceEditorComponentProps,
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
} from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import ComponentPropsDialog from '../../../../../../../../../../components/component-props-dialog.component'
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
import { buildRoute, Route } from '../../../../../../../../../../constants/route-links'
import useOpenPreview from '../../../../../../../../../../hooks/use-open-preview'
import { useHostId, useHostSubdomain } from '../../../../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../../../../hooks/use-firestore-collection'
import usePluginDrawerRegistration from '../../../../../../../../../../hooks/use-plugin-drawer-registration'
import usePresence from '../../../../../../../../../../hooks/use-presence'
import useCoEditing from '../../../../../../../../../../hooks/use-coediting'
import PresenceAvatars from '../../../../../../../../../../components/presence-avatars.component'
import CollaboratorOverlays from '../../../../../../../../../../components/collaborator-overlays.component'


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
  // Installed plugins as drawer entries and as the element panel's plugin
  // picker (AGL-1030). Registered on the screen editor since AGL-190 but
  // nowhere else, so a plugin could not be placed in a reusable component or a
  // layout at all, and the picker there had no installs to offer.
  usePluginDrawerRegistration(hostId)
  const handleAddElementClick = useAddElementDrawerCallback()
  const listUrl = buildRoute(Route.HOST_COMPONENTS, { orgSlug,  host })
  const { doc: hostResult } = useHost({ hostId })
  const { doc: componentResult } = useComponent({ hostId, componentId })
  const publishedVersionId = componentResult?.data?.versionId
  // Id-based screen links: a component can contain a link, so the canvas needs the routing map to resolve hrefs and the
  // Attributes panel needs screen names for the screen-select field.
  const firestore = useFirestore()
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screenLinks = useMemo(
    () => ({
      screens: hostResult?.data?.screens as Record<string, string> | undefined,
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
    [hostResult?.data?.screens, screenDocs],
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
          nodes: nextNodes as unknown as
            Aglyn.AglynHostComponentVersion['nodes'],
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
    notify: enqueueSnackbar,
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
      // A save makes Firestore authoritative again, so the live mirror of
      // unsaved work has to go — otherwise the next person to join replays
      // edits that are already in the document (AGL-677).
      clearMirrorRef.current?.()
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
  const handlePublish = useCallback(async () => {
    if (publishing) return
    if (saveAvailable) {
      return enqueueSnackbar('Save your changes before publishing', {
        variant: 'warning',
        persist: false,
      })
    }
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
      await updateDoc(doc(firestore, 'hosts', hostId, 'components', componentId), {
        nodes: publishedNodes,
        ...(rootId ? { rootId } : {}),
        props: declaredProps ?? [],
        versionId,
        updatedAt: Timestamp.now(),
      })
      // Tenant pages are ISR with `revalidate = 60` and there is no
      // on-demand revalidation hook, so propagation is a cache window, not
      // a deploy. Saying "next build" would have people waiting for
      // something that never happens.
      enqueueSnackbar(
        'Published. Every screen using this component picks it up within a ' +
          'minute — you do not need to republish them.',
        { variant: 'success', persist: false },
      )
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : 'Publish failed',
        { variant: 'error', allowDuplicate: true },
      )
    } finally {
      setPublishing(false)
    }
  }, [
    publishing,
    saveAvailable,
    firestore,
    hostId,
    componentId,
    versionId,
    componentResult?.data?.rootId,
    data,
    enqueueSnackbar,
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
          <link key="host-fonts" rel="stylesheet" href={hostFontsHref} />
        </>
      ) : null}
      <MainLayout
        enableAppBarElevation
        besigner
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
                children: saveAvailable ? 'Save' : 'Up to Date',
                onClick: handleSave,
              },
              {
                // Saving records history; publishing is what live sites
                // actually render (AGL-679).
                id: 'center-nav-file-publish',
                disabled: publishing || saveAvailable,
                children:
                  publishedVersionId === versionId
                    ? 'Publish again'
                    : 'Publish to sites',
                onClick: handlePublish,
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
                  handleAddElementClick(Besigner.focus.getLastSelected()),
              },
            ],
          },
        ]}
      >
        {error || notFound ? (
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
              onSave={handleSave}
              saveAvailable={saveAvailable}
            />
            <BesignerDraftAlertComponent draft={draft} noun="component" />
            {/* Shown as soon as their save lands, not on Save — finding out
                after twenty more minutes of editing is the bad version of
                this (AGL-674). */}
            {remoteChanged ? (
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

export default withSitePlugins(withBesignerContext(observer(ComponentBesignerPage)))
