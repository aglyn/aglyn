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
  LayoutChromeContext,
  PropertiesDialogComponent,
  useAddElementDrawerCallback,
  useLayoutChromeCanvas,
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
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import { registerLegacyMuiPlugin } from '@aglyn/plugins-ui-mui'
import {
  useHost,
  useLayout,
  useLayoutVersion,
  useScreen,
  useScreenVersion,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, deleteField, limit, query } from 'firebase/firestore'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import Head from 'next/head'
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
import {
  publishScreenRoute,
  unpublishScreenRoute,
} from '../../../../../../../constants/screen-publishing'
import { buildScreenLiveUrl } from '../../../../../../../constants/tenant-links'

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
  const {doc: screenResult, setDoc: updateScreenDoc} = useScreen({
    hostId,
    screenId,
  })
  const layoutId = screenResult?.data?.layoutId
  const {doc: layoutResult} = useLayout({
    hostId,
    layoutId: layoutId ?? '-no-layout-',
  })
  const layoutVersionId = layoutResult?.data?.versionId
  const {doc: layoutVersionResult} = useLayoutVersion({
    hostId,
    layoutId: layoutId ?? '-no-layout-',
    versionId: layoutVersionId ?? '-no-version-',
  })
  const chromeCanvas = useLayoutChromeCanvas(
    layoutId ? layoutVersionResult?.data?.nodes : undefined,
  )
  const {doc: result, setDoc: updateScreen} = useScreenVersion({
    hostId: hostId as string,
    screenId: screenId as string,
    versionId: versionId as string,
  })
  const {data, status, error} = result
  const nodes = data?.nodes
  const hasError = Boolean(error) || status === 'error'
  const notFound = status === 'success' && !data

  // The canvas is a singleton shared by every editing session; without a
  // reset on leave, client-side navigation to another screen or a layout
  // keeps (and could save) this document's nodes.
  useEffect(() => {
    return () => {
      Aglyn.canvas.reset()
      Besigner.focus.clearFocusStatus()
    }
  }, [hostId, screenId, versionId])

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
  const liveUrl = useMemo(
    () => buildScreenLiveUrl(hostResult?.data, screenId),
    [hostResult?.data, screenId],
  )
  const hostTheme = hostResult?.data?.theme
  const hostFontsHref = useMemo(
    () => getGoogleFontsUrl(hostTheme?.fonts),
    [hostTheme?.fonts],
  )
  const firestore = useFirestore()
  const layoutsQuery = query(
    collection(firestore, 'hosts', hostId, 'layouts'),
    limit(50),
  )
  const { data: layoutOptions } = useFirestoreCollectionData<any>(
    layoutsQuery,
    { idField: '$id' },
  )
  const chromeContextValue = useMemo(
    () => ({ chromeCanvas }),
    [chromeCanvas],
  )

  const handleLayoutChange = useCallback(
    async (event) => {
      const value = event.target.value as string
      const nextLayoutId = value === '__none__' ? undefined : value
      await updateScreenDoc({
        layoutId: nextLayoutId ?? (deleteField() as any),
      } as any)
        .then(() => {
          enqueueSnackbar(
            nextLayoutId ? 'Layout assigned' : 'Layout removed',
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
    [updateScreenDoc, enqueueSnackbar],
  )

  // Publishing: the tenant site only serves paths present in the host's
  // `screens` routing map, so the slug save must register the entry there
  // too — the screen doc's `slug` alone routes nothing.
  const publishedPath = hostResult?.data?.screens?.[screenId]
  const [slugInput, setSlugInput] = useState<string | null>(null)
  const slugValue =
    slugInput ?? screenResult?.data?.slug ?? publishedPath ?? ''
  const normalizedSlug = Aglyn.normalizeScreenSlug(slugValue)
  const slugOwner = normalizedSlug
    ? Aglyn.findScreenIdByRoutePath(
        hostResult?.data?.screens as Record<string, string> | undefined,
        normalizedSlug,
      )
    : undefined
  const slugConflict = Boolean(slugOwner && slugOwner !== screenId)

  const handlePublish = useCallback(async () => {
    if (slugConflict) return
    const ids = { hostId, screenId }
    const action = normalizedSlug
      ? publishScreenRoute(firestore, ids, normalizedSlug).then(() => {
          setSlugInput(null)
          enqueueSnackbar(
            `Published at ${Aglyn.screenRoutePathToUrl(normalizedSlug)}`,
            { variant: 'success', persist: false },
          )
        })
      : unpublishScreenRoute(firestore, ids, { clearSlug: true }).then(() => {
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
    normalizedSlug,
    firestore,
    hostId,
    screenId,
    enqueueSnackbar,
  ])

  const handlePreview = useCallback(() => {
    const ids = { hostId, screenId, versionId }
    // Preview what the site will render: the draft screen composed into its
    // bound layout's published version.
    const composed = Aglyn.composeLayoutAndScreenNodes(
      layoutId ? (layoutVersionResult?.data?.nodes as any) : undefined,
      Aglyn.canvas.toJSON().nodes as any,
    )
    writePreviewState(ids, composed, hostTheme)
    window.open(buildRoute(Route.SCREEN_PREVIEW, ids), previewWindowName(ids))
  }, [
    hostId,
    screenId,
    versionId,
    layoutId,
    layoutVersionResult?.data?.nodes,
    hostTheme,
  ])

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
    <HostThemeDocumentContext.Provider value={hostTheme}>
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
                    disabled={!layoutVersionId}
                    href={
                      layoutVersionId
                        ? buildRoute(Route.LAYOUT_BESIGNER, {
                            hostId,
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
            <LayoutChromeContext.Provider value={chromeContextValue}>
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
          <Typography variant="subtitle2">{'Publishing'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'The slug is the path this screen is served at on your site. Use "/" for the home page. Clearing it and pressing Unpublish removes the screen from the site.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label="Slug"
              fullWidth
              value={slugValue}
              onChange={(e) => setSlugInput(e.target.value)}
              error={slugConflict}
              helperText={
                slugConflict
                  ? 'Another screen already uses this path'
                  : normalizedSlug
                    ? `Served at ${Aglyn.screenRoutePathToUrl(normalizedSlug)}`
                    : publishedPath
                      ? `Currently published at ${Aglyn.screenRoutePathToUrl(publishedPath)}`
                      : 'Not published'
              }
            />
            <Button
              size="small"
              variant="outlined"
              onClick={handlePublish}
              disabled={slugConflict || (!normalizedSlug && !publishedPath)}
              sx={{ mt: 0.5, flexShrink: 0 }}
            >
              {normalizedSlug ? 'Publish' : 'Unpublish'}
            </Button>
          </Stack>
          <Typography variant="subtitle2">{'Shared layout'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'Wraps this screen in chrome (appbar, footer, …) maintained once for every bound screen. Saved immediately.'}
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
    </HostThemeDocumentContext.Provider>
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
