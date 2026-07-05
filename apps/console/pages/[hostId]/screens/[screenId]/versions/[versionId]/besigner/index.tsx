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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import {
  PropertiesDialogComponent,
  useAddElementDrawerCallback,
  withBesignerContext,
  type WorkspaceEditorComponentProps,
} from '@aglyn/besigner-ui'
// import '@aglyn/foundation-feature-singleton'
import {
  HAS_BROWSER,
  ICON_VARIANT_APP_SETTINGS,
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  LOADING_OVERLAY_ELEMENT,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { registerLegacyMuiPlugin } from '@aglyn/plugins-ui-mui'
import { useHost, useScreenVersion } from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import BesignerAppBarComponent from '../../../../../../../components/besigner-app-bar.component'
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import '../../../../../../../constants/app-setup'
import {
  previewWindowName,
  writePreviewState,
} from '../../../../../../../constants/preview-state'
import { buildRoute, Route } from '../../../../../../../constants/route-links'

registerLegacyMuiPlugin()

const WorkspaceEditorComponent = dynamic<WorkspaceEditorComponentProps>(
  () =>
    import('@aglyn/besigner-ui').then((mod) => mod.WorkspaceEditorComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const ViewportRootComponent = dynamic<WorkspaceEditorComponentProps>(
  () => import('@aglyn/besigner-ui').then((mod) => mod.ViewportRootComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)
const ViewportCanvasComponent = dynamic<WorkspaceEditorComponentProps>(
  () => import('@aglyn/besigner-ui').then((mod) => mod.ViewportCanvasComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)
const JsonEditor = dynamic<JsonEditorProps>(
  () =>
    import('@aglyn/shared-ui-json-editor').then((mod) => mod.JsonEditor),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)

function setLocalNodes(value: Aglyn.ProcessableNodes) {
  const parsed = Aglyn.canvas.processNodesToDenormalized(value)
  const nodes = Aglyn.canvas.setNodes(parsed)
  return nodes
}

function BesignerPage(props) {
  const params = useParams<{
    hostId: string,
    screenId: string,
    versionId: string
  }>()
  const hostId = params?.hostId as string
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string
  const {enqueueSnackbar} = useSnackbar()
  const {queueLoading} = useLoading()
  const saveAvailable = !Aglyn.canvas.isInitialSame
  const [screenDialog, setScreenDialog] = useState(false)
  const handleAddElementClick = useAddElementDrawerCallback()
  const detailUrl = buildRoute(Route.SCREEN_DETAILS, {
    hostId: hostId as string,
    screenId: screenId as string,
    versionId: versionId as string,
  })
  const {doc: hostResult} = useHost({ hostId: hostId as string })
  const {doc: result, setDoc: updateScreen} = useScreenVersion({
    hostId: hostId as string,
    screenId: screenId as string,
    versionId: versionId as string,
  })
  const {data, status, error} = result
  const nodes = data?.nodes
  const hasError = Boolean(error) || status === 'error'
  const notFound = status === 'success' && !data

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
    const saveScreen = updateScreen as unknown as (
      data: Partial<Aglyn.AglynScreenVersion>,
      options?: Parameters<typeof updateScreen>[1],
    ) => Promise<void>
    await saveScreen(
      {nodes: nodes as unknown as Aglyn.AglynScreenVersion['nodes']},
      {merge: true},
    )
      .then(() => {
        Aglyn.canvas.updateInitialNodes(nodes)
        enqueueSnackbar('Canvas saved successfully', {
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
  }, [saveAvailable, updateScreen, enqueueSnackbar, queueLoading])

  const [jsonOpen, setJsonOpen] = useState(false)
  const openJsonEditor = useCallback(() => setJsonOpen(true), [])
  const closeJsonEditor = useCallback(() => setJsonOpen(false), [])
  const liveUrl = useMemo(() => {
    const host = hostResult?.data
    if (!host) return undefined
    const domain =
      host.cname || (host.subdomain ? `${host.subdomain}.aglyn.app` : undefined)
    if (!domain) return undefined
    const slug = host.screens?.[screenId]
    if (slug == null) return undefined
    return `https://${domain}/${slug === '/' ? '' : slug}`
  }, [hostResult?.data, screenId])

  const handlePreview = useCallback(() => {
    const ids = { hostId, screenId, versionId }
    writePreviewState(ids, Aglyn.canvas.toJSON().nodes)
    window.open(buildRoute(Route.SCREEN_PREVIEW, ids), previewWindowName(ids))
  }, [hostId, screenId, versionId])

  const handleJsonSave = useCallback((e, value) => {
    Aglyn.canvas.applyNodes(value)
    setJsonOpen(false)
  }, [])


  useEffect(() => {
    if (hasError) {
      enqueueSnackbar(`Error: ${error?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    }
    else if (notFound) {
      enqueueSnackbar('404: Screen not found', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [enqueueSnackbar, hasError, error, notFound])

  return (
    <>
      <MainLayout
        title={'Besigner'}
        enableAppBarElevation
        // besigner={true}
        // appBarSuffix={'Besigner'}
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
                disabled: !saveAvailable,
                icon: saveAvailable
                  ? {path: ICON_VARIANT_MODIFY_SAVE.path}
                  : {path: ICON_VARIANT_SYMBOL_CONFIRMED.path},
                children: saveAvailable ? 'Save' : 'Up to Date',
                onClick: handleSave,
              },
              {
                id: 'center-nav-file-close',
                children: 'Close',
                href: detailUrl,
                component: AppLink,
                componentVariant: 'naked',
                ListItemTextProps: {inset: true},
              },
              {
                type: 'divider',
              },
              {
                id: 'center-nav-file-new-version',
                children: (
                  <Typography component="div">
                    {'New Version'}{' '}
                    <Typography variant="caption" component="sup">
                      {'Coming Soon'}
                    </Typography>
                  </Typography>
                ),
                onClick: () =>
                  handleAddElementClick(Besigner.focus.getLastSelected()),
                disabled: true,
                ListItemTextProps: {inset: true},
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
                ListItemTextProps: {inset: true},
              },
              {
                id: 'center-nav-edit-redo',
                children: 'Redo',
                onClick: () => Aglyn.canvas.redo(),
                disabled: !Aglyn.canvas.canRedo,
                ListItemTextProps: {inset: true},
              },
              {
                type: 'divider',
              },
              {
                id: 'center-nav-edit-rawjson',
                children: 'Raw JSON',
                onClick: () => openJsonEditor(),
                ListItemTextProps: {inset: true},
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
                onClick: handleAddElementClick,
              },
            ],
          },
        ]}
      >
        <NextPageTitle screen={'Besigner'} />

        {error || notFound ? (
          <Stack
            sx={{
              alignItems: "center",
              justifyContent: "center"
            }}>
            <Typography>{'Not found'}</Typography>
          </Stack>
        ) : status === 'loading' ? (
          LOADING_OVERLAY_ELEMENT
        ) : (
          <>
            <BesignerAppBarComponent
              detailsUrl={detailUrl}
              onSave={handleSave}
              onPreview={handlePreview}
              liveUrl={liveUrl}
              onPropertiesEdit={() => setScreenDialog(true)}
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
      <PropertiesDialogComponent
        open={screenDialog}
        onClose={() => {
          setScreenDialog(false)
        }}
        onActionClick={async () => {
          await handleSave()
          setScreenDialog(false)
        }}
      />
      {Boolean(Aglyn.canvas.rootNode && jsonOpen) && (
        <JsonEditor
          open={Boolean(Aglyn.canvas.rootNode && jsonOpen)}
          onClose={closeJsonEditor}
          onSave={handleJsonSave}
          defaultValue={Aglyn.canvas.nestedNodes as any}
        />
      )}
    </>
  );
}

BesignerPage.displayName = 'Page:Besigner'
BesignerPage.layouts = [{Component: AuthenticatedLayout}]

export default withBesignerContext(observer(BesignerPage))

// export const getServerSideProps = async (ctx) => {
//   // await setAdminTenant({$id: '-atN0g5dZgoDp4rfMaO_', displayName: 'sample
// tenant', hosts: []}) console.log('Page:Besigner getStaticProps START') const
// tenantId = '-atN0g5dZgoDp4rfMaO_' const tenant = await
// getAdminTenant(tenantId) .then((snapshot) => { if (snapshot.exists()) {
// console.log('getAdminTenant exists', tenantId, snapshot.val())
// console.log(snapshot.val()) return snapshot.val() } else {
// console.log('getAdminTenant No data available', tenantId) return null }
// }).catch((error) => { console.error(`getAdminTenant error`, tenantId, error)
// return null }) console.log('Page:Besigner getStaticProps AWAIT DONE',
// tenant)   if (!tenant && ctx) { console.log('Page:Besigner WRITE START') //
// await setAdminTenant({$id: '-atN0g5dZgoDp4rfMaO_', displayName: 'test fake
// tenant'}) // tenant = await getServerSideProps(null).then((data) =>
// data.props.tenant) console.log('Page:Besigner WRITE DONE', tenant) }  return
// { props: { tenant, }, } }
