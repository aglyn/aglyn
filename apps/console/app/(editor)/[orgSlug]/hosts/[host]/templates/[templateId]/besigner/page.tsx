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
  useHost,
  useHostTemplate,
  useHostTemplateRef,
  useHostActivityLogger,
} from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'
// Dynamic site-plugin activation (AGL-417): canvas components register
// via the org-gated loader; the page gates the canvas on readiness.
import { withSitePlugins } from '../../../../../../../../components/console-plugins-gate.component'
import BesignerFunctionsButton from '../../../../../../../../components/besigner-functions-button.component'
import BindingPickerProvider from '../../../../../../../../components/binding-picker-provider.component'
import InteractionsProvider from '../../../../../../../../components/interactions-provider.component'
import BesignerMediaPickerProvider from '../../../../../../../../components/besigner-media-picker-provider.component'
import BesignerAppBarComponent from '../../../../../../../../components/besigner-app-bar.component'
import BesignerDocumentSwitcherComponent from '../../../../../../../../components/besigner-document-switcher.component'
import BesignerVersionsComponent from '../../../../../../../../components/besigner-versions.component'
import EntityPickerProvider from '../../../../../../../../components/entity-picker-provider.component'
import ReusableComponentsProvider from '../../../../../../../../components/reusable-components-provider.component'
import AuthenticatedLayout from '../../../../../../../../components/layouts/authenticated.layout'
import MainLayout from '../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../constants/app-setup'
import { buildRoute, Route } from '../../../../../../../../constants/route-links'
import useOpenPreview from '../../../../../../../../hooks/use-open-preview'
import { useHostId, useHostSubdomain } from '../../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../../hooks/use-firestore-collection'
import usePluginDrawerRegistration from '../../../../../../../../hooks/use-plugin-drawer-registration'
import usePresence from '../../../../../../../../hooks/use-presence'
import useCoEditing from '../../../../../../../../hooks/use-coediting'
import PresenceAvatars from '../../../../../../../../components/presence-avatars.component'
import CollaboratorOverlays from '../../../../../../../../components/collaborator-overlays.component'


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

function TemplateBesignerPage(props) {
  const params = useParams<{
    hostId: string
    templateId: string
  }>()
  const hostId = useHostId()
  const templateId = params?.templateId as string
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
  const { doc: result } = useHostTemplate({
    hostId,
    templateId,
  })
  const templateRef = useHostTemplateRef({ hostId, templateId })
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
  }, [hostId, templateId])

  useEffect(() => {
    if (status === 'loading') {
      return queueLoading()
    }
  }, [status])

  /** Whether the stored tree had to be wrapped for the canvas. */
  const wrappedOnLoadRef = useRef(false)

  const saveTemplateNodes = useCallback(
    async (
      nextNodes: Record<string, unknown>,
      baseline?: BesignerSaveBaseline,
    ) => {
      // Placeholders are DERIVED from the tokens in the content (AGL-672),
      // so editing has to recompute them: otherwise a template goes on
      // asking for a placeholder its copy no longer contains, or silently
      // stops asking for one the author just added. Existing labels and
      // defaults survive for tokens that are still there.
      const declared = Aglyn.detectTemplatePlaceholders(nextNodes)
      const previous = new Map(
        ((data?.placeholders ?? []) as Array<{ name: string }>).map(
          (entry) => [entry.name, entry],
        ),
      )
      const placeholders = declared.map((name) => previous.get(name) ?? { name })
      // Conditional write (AGL-1301): the transaction re-checks the baseline
      // against what Firestore actually holds, so a save racing another
      // writer's commit aborts server-side instead of clobbering it.
      await saveNodesGuarded(
        templateRef,
        {
          nodes: nextNodes as unknown as Aglyn.AglynTemplate['nodes'],
          placeholders,
          // Records that this copy has diverged from what was installed.
          // `source` itself stays server-managed and frozen (AGL-666) so
          // provenance cannot be forged; "I edited my own copy" is a claim
          // nobody gains by lying about.
          editedAt: Timestamp.now(),
        } as Partial<Aglyn.AglynTemplate>,
        baseline,
      )
    },
    [templateRef, data?.placeholders],
  )

  // Who else is in this document (AGL-675) and live co-editing (AGL-677) —
  // adopted from the screen editor (AGL-1301). Templates have no version
  // subcollection, so the co-edit room keys on the doc alone.
  const selectedNodeId = Besigner.focus.getLastSelected()?.$id
  const clearMirrorRef = useRef<(() => void) | undefined>(undefined)
  const { elements: canvasElements } = useRenderedCanvasElements()
  const getCanvasRoot = useCallback(
    () => canvasElements.current?.[Aglyn.CANVAS_ROOT_ELEMENT_ID]?.node,
    [canvasElements],
  )
  const presence = usePresence({
    hostId,
    docType: 'template',
    docId: templateId,
    selectedNodeId,
    broadcastCursor: true,
    getCanvasRoot,
  })

  // Canvas lifecycle, first load, concurrent-write detection (AGL-674) and
  // the size-guarded save (AGL-678) are shared by every besigner editor
  // (AGL-746). What stays here is what is actually about a template.
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
    save: saveTemplateNodes,
    noun: 'template',
    savedMessage: 'Template saved',
    documentKey: `${hostId}:${templateId}`,
    draft: {
      scope: hostId,
      kind: 'template',
      docId: templateId,
    },
    notify: enqueueSnackbar,
    queueLoading,
    // A page template holds a screen's canvas tree (already rooted at the
    // canonical id); a component-kind template holds a DEFINITION, whose
    // root is the promoted node. The canvas only renders the former, so the
    // latter is wrapped (AGL-680/681).
    toCanvasNodes: (storedNodes) => {
      const canvasTree = Aglyn.definitionToCanvasTree({
        rootId: data?.rootId,
        nodes: storedNodes as Record<string, unknown>,
      })
      wrappedOnLoadRef.current = canvasTree !== storedNodes
      return canvasTree as Aglyn.ProcessableNodes
    },
    // Save in the shape it arrived in: unwrapping a page template would
    // strip the canvas root its instantiation depends on.
    fromCanvasNodes: (canvasNodes) => {
      const unwrapped = wrappedOnLoadRef.current
        ? Aglyn.canvasTreeToDefinition(canvasNodes)
        : null
      if (unwrapped?.ambiguousRoot) {
        return {
          error:
            'This template needs a single top-level element. Wrap what you ' +
            'have in one container, then save.',
        }
      }
      return { nodes: unwrapped ? unwrapped.nodes : canvasNodes }
    },
    onSaved: () => {
      // A save makes Firestore authoritative again, so the live mirror of
      // unsaved work has to go — otherwise the next person to join replays
      // edits that are already in the document (AGL-677).
      clearMirrorRef.current?.()
      return logActivity('Saved the template', {
        type: 'template',
        id: templateId,
        name: result?.data?.displayName,
      })
    },
  })

  // Live co-editing (AGL-677). Rides the presence session's authenticated
  // RTDB app rather than brokering a second token.
  const coediting = useCoEditing({
    session: presence.session,
    docType: 'template',
    docId: templateId,
    versionId: undefined,
    storedStamp: (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    loaded: Aglyn.canvas.didSetInitial,
  })
  clearMirrorRef.current = coediting.clearMirror

  // No publish step: a template is inert by definition — nothing renders
  // from it until it is used to create a page, component or layout, so
  // there is no draft-versus-live distinction to maintain (AGL-681).

  // The site's theme with this site's overrides resolved over it
  // (AGL-1021). The editor must render exactly what the tenant will.
  const hostTheme = useMemo(
    () => resolveSiteTheme(hostResult?.data),
    [hostResult?.data],
  )

  // Draft preview (AGL-1203). Templates version but never publish, so the
  // snapshot key and route carry no versionId.
  const handlePreview = useOpenPreview({
    ids: hostId ? { hostId, kind: 'template', docId: templateId } : null,
    href: buildRoute(Route.TEMPLATE_PREVIEW, { orgSlug, host, templateId }),
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
            <BesignerDraftAlertComponent draft={draft} noun="template" />
            {/* No version switcher here, on purpose (AGL-688). Templates
                have versions but no publish step, so TEMPLATE_BESIGNER
                carries no versionId segment — there is no per-version URL
                to navigate to, and no parent pointer for "published" to
                mean anything against. Giving templates a switcher needs a
                route change and a decision about what "current" means for
                a document that never publishes; until then this stays
                empty rather than shipping a control that half-works. */}
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
            {/* Shown as soon as their save lands, not on Save — finding out
                after twenty more minutes of editing is the bad version of
                this (AGL-674). */}
            {remoteChanged ? (
              <BesignerConflictAlertComponent noun="template" />
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

TemplateBesignerPage.displayName = 'Page:LayoutBesigner'

export default withSitePlugins(withBesignerContext(observer(TemplateBesignerPage)))
