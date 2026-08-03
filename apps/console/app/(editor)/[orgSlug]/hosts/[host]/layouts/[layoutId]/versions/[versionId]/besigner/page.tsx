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
import * as Besigner from '@aglyn/besigner'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import {
  useAddElementDrawerCallback,
  useBesignerDocument,
  withBesignerContext,
  type WorkspaceEditorComponentProps,
} from '@aglyn/besigner-ui'
import {
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  LOADING_OVERLAY_ELEMENT,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import { useHost, useLayout, useLayoutVersion, useHostActivityLogger } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo } from 'react'
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
  const listUrl = buildRoute(Route.HOST_LAYOUTS, { orgSlug,  host })
  const { doc: hostResult } = useHost({ hostId })
  const { doc: layoutResult } = useLayout({ hostId, layoutId })
  const layoutPublishedVersionId = layoutResult?.data?.versionId
  // Id-based screen links: a layout's appbar is exactly where by-id links
  // live, so the canvas needs the routing map to resolve hrefs and the
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
  const { doc: result, setDoc: updateLayoutVersion } = useLayoutVersion({
    hostId,
    layoutId,
    versionId,
  })
  const { data, status, error } = result
  const nodes = data?.nodes

  const saveLayoutVersion = useCallback(
    async (nextNodes: Record<string, unknown>) => {
      const save = updateLayoutVersion as unknown as (
        data: Partial<Aglyn.AglynLayoutVersion>,
        options?: Parameters<typeof updateLayoutVersion>[1],
      ) => Promise<void>
      await save(
        { nodes: nextNodes as unknown as Aglyn.AglynLayoutVersion['nodes'] },
        { merge: true },
      )
    },
    [updateLayoutVersion],
  )

  // Canvas lifecycle, first load, concurrent-write detection (AGL-674) and
  // the size-guarded save (AGL-678) are identical in every besigner editor
  // and live in the shared hook (AGL-746). What stays here is what is
  // actually about a layout belonging to a host.
  const {
    saveAvailable,
    remoteChanged,
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
    status,
    error,
    save: saveLayoutVersion,
    noun: 'layout',
    viewType: Aglyn.HostViewType.LAYOUT,
    documentKey: `${hostId}:${layoutId}:${versionId}`,
    notify: enqueueSnackbar,
    queueLoading,
    // Attribution (AGL-676): `updatedAt` carries no actor, so without this
    // "someone changed this" could never become "Sam changed this".
    onSaved: () =>
      logActivity('Saved the layout', {
        type: 'layout',
        id: layoutId,
        name: layoutResult?.data?.displayName,
      }),
  })

  const hostTheme = hostResult?.data?.theme

  // Draft preview (AGL-1203). A layout previews as itself — its Layout Slot
  // stays empty because there is no screen to fill it, which is the honest
  // picture of the chrome being authored.
  const handlePreview = useOpenPreview({
    ids: hostId
      ? { hostId, kind: 'layout', docId: layoutId, versionId }
      : null,
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
          <link key="host-fonts" rel="stylesheet" href={hostFontsHref} />
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
                disabled: !saveAvailable,
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
            <BesignerAppBarComponent
              onPreview={handlePreview}
              detailsUrl={listUrl}
              onSave={handleSave}
              saveAvailable={saveAvailable}
            />
            {/* Shown as soon as their save lands, not on Save — finding out
                after twenty more minutes of editing is the bad version of
                this (AGL-674). */}
            {remoteChanged ? (
              <Alert
                severity="warning"
                sx={{ borderRadius: 0, position: 'relative', zIndex: 'appBar' }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => window.location.reload()}
                  >
                    {'Reload'}
                  </Button>
                }
              >
                {'Someone else saved this layout while you were editing. ' +
                  'Saving is paused so their work is not overwritten — ' +
                  'reload to pick up their changes. Nothing you have done ' +
                  'here is lost until you do.'}
              </Alert>
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

export default withSitePlugins(withBesignerContext(observer(LayoutBesignerPage)))
