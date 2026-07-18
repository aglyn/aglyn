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
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import { useHost, useLayout, useLayoutVersion } from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import useFirestoreCollection from '../../../../../../../../hooks/use-firestore-collection'


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

function setLocalNodes(value: Aglyn.ProcessableNodes) {
  const parsed = Aglyn.canvas.processNodesToDenormalized(value)
  const nodes = Aglyn.canvas.setNodes(parsed)
  return nodes
}

function LayoutBesignerPage(props) {
  const params = useParams<{
    hostId: string
    layoutId: string
    versionId: string
  }>()
  const hostId = params?.hostId as string
  const layoutId = params?.layoutId as string
  const versionId = params?.versionId as string
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const saveAvailable = !Aglyn.canvas.isInitialSame
  const handleAddElementClick = useAddElementDrawerCallback()
  const listUrl = buildRoute(Route.LAYOUT_LIST, { hostId })
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
  const hasError = Boolean(error) || status === 'error'
  const notFound = status === 'success' && !data

  // The canvas edits a layout: expose the LayoutSlot in the components
  // drawer and let downstream surfaces adapt. Reset on unmount so screen
  // editing sessions are unaffected.
  useEffect(() => {
    if (!Besigner.doesBesignerAppExist()) return
    const app = Besigner.getBesignerApp()
    Besigner.setBesignerFlag(app, {
      flag: 'viewType',
      value: () => Aglyn.HostViewType.LAYOUT,
    })
    return () => {
      Besigner.setBesignerFlag(app, {
        flag: 'viewType',
        value: () => Aglyn.HostViewType.SCREEN,
      })
    }
  }, [])

  // The canvas is a singleton shared by every editing session; without a
  // reset on leave, client-side navigation to a screen or another layout
  // keeps (and could save) this document's nodes.
  useEffect(() => {
    return () => {
      Aglyn.canvas.reset()
      Besigner.focus.clearFocusStatus()
    }
  }, [hostId, layoutId, versionId])

  useEffect(() => {
    if (status === 'loading') {
      return queueLoading()
    }
  }, [status])

  useEffect(() => {
    if (nodes && !Aglyn.canvas.didSetInitial) {
      setLocalNodes(nodes)
      Aglyn.canvas.updateInitialNodes()
    }
  }, [nodes])

  const handleSave = useCallback(async () => {
    if (!saveAvailable) {
      return enqueueSnackbar('Already saved', {
        variant: 'info',
        persist: false,
      })
    }
    const dequeueLoading = queueLoading()

    const nodes = Aglyn.canvas.toJSON().nodes
    const saveLayout = updateLayoutVersion as unknown as (
      data: Partial<Aglyn.AglynLayoutVersion>,
      options?: Parameters<typeof updateLayoutVersion>[1],
    ) => Promise<void>
    await saveLayout(
      { nodes: nodes as unknown as Aglyn.AglynLayoutVersion['nodes'] },
      { merge: true },
    )
      .then(() => {
        Aglyn.canvas.updateInitialNodes(nodes)
        enqueueSnackbar('Layout saved successfully', {
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
      .finally(() => {
        dequeueLoading()
      })
  }, [saveAvailable, updateLayoutVersion, enqueueSnackbar, queueLoading])

  const [jsonOpen, setJsonOpen] = useState(false)
  const openJsonEditor = useCallback(() => setJsonOpen(true), [])
  const closeJsonEditor = useCallback(() => setJsonOpen(false), [])
  const handleJsonSave = useCallback((e, value) => {
    Aglyn.canvas.applyNodes(value)
    setJsonOpen(false)
  }, [])

  const hostTheme = hostResult?.data?.theme
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
        <Head>
          <link
            key="host-fonts-preconnect"
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link key="host-fonts" rel="stylesheet" href={hostFontsHref} />
        </Head>
      ) : null}
      <MainLayout
        title={'Besigner'}
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
        <NextPageTitle screen={'Layout Besigner'} />

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
              detailsUrl={listUrl}
              onSave={handleSave}
              saveAvailable={saveAvailable}
            />
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
