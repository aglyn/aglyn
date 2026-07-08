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
import { useFirestore } from 'reactfire'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AiAssistProvider from '../../../../../../../components/ai-assist-provider.component'
import BesignerFunctionsButton from '../../../../../../../components/besigner-functions-button.component'
import BindingPickerProvider from '../../../../../../../components/binding-picker-provider.component'
import usePluginDrawerRegistration from '../../../../../../../hooks/use-plugin-drawer-registration'
import BesignerMediaPickerProvider from '../../../../../../../components/besigner-media-picker-provider.component'
import BesignerAppBarComponent from '../../../../../../../components/besigner-app-bar.component'
import BesignerDocumentSwitcherComponent from '../../../../../../../components/besigner-document-switcher.component'
import BesignerVersionsComponent from '../../../../../../../components/besigner-versions.component'
import ReusableComponentsProvider from '../../../../../../../components/reusable-components-provider.component'
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import '../../../../../../../constants/app-setup'
import {
  previewWindowName,
  writePreviewState,
} from '../../../../../../../constants/preview-state'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { syncScreenRouteEntries } from '../../../../../../../constants/screen-publishing'
import { buildScreenLiveUrl } from '../../../../../../../constants/tenant-links'
import useFirestoreCollection from '../../../../../../../hooks/use-firestore-collection'

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
  // Screen SEO fields (SEO Toolkit); null = untouched, falls back to doc.
  const [seoTitle, setSeoTitle] = useState<string | null>(null)
  const [seoDescription, setSeoDescription] = useState<string | null>(null)
  // Screen password protection (AGL-87); null = untouched.
  const [protectPassword, setProtectPassword] = useState<string | null>(null)
  const handleAddElementClick = useAddElementDrawerCallback()
  // Installed plugins appear as named drawer entries (AGL-190).
  usePluginDrawerRegistration(hostId)
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
  const { data: layoutOptions } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'layouts'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const chromeContextValue = useMemo(
    () => ({ chromeCanvas }),
    [chromeCanvas],
  )

  const handleProtectionSave = useCallback(async () => {
    if (protectPassword == null) return
    const value = protectPassword.trim()
    let update: Record<string, unknown>
    if (!value) {
      update = { protection: deleteField() as any }
    } else {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value),
      )
      const passwordHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      update = { protection: { passwordHash } }
    }
    await updateScreenDoc(update as any)
      .then(() => {
        enqueueSnackbar(
          value ? 'Password protection enabled' : 'Password protection removed',
          { variant: 'success', persist: false },
        )
        setProtectPassword(null)
      })
      .catch((e) => {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
          variant: 'error',
          allowDuplicate: true,
        })
      })
  }, [protectPassword, updateScreenDoc, enqueueSnackbar])

  const handleSeoSave = useCallback(async () => {
    const existing = (screenResult?.data as any)?.seo ?? {}
    await updateScreenDoc({
      seo: {
        ...existing,
        title: (seoTitle ?? existing.title ?? '').trim(),
        description: (seoDescription ?? existing.description ?? '').trim(),
      },
    } as any)
      .then(() => {
        enqueueSnackbar('SEO saved', { variant: 'success', persist: false })
        setSeoTitle(null)
        setSeoDescription(null)
      })
      .catch((e) => {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
          variant: 'error',
          allowDuplicate: true,
        })
      })
  }, [updateScreenDoc, screenResult, seoTitle, seoDescription, enqueueSnackbar])

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
  // `screens` routing map. The routed path composes ancestor slugs (parent
  // `company` + own `about` → /company/about), so slug and parent changes
  // must rewrite this screen's entry AND every descendant's.
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screensById = useMemo(() => {
    const map: Record<
      string,
      Aglyn.ScreenRouteNode & { displayName?: string }
    > = {}
    for (const screen of screenDocs ?? []) {
      map[screen.$id] = {
        slug: screen.slug,
        parentId: screen.parentId,
        displayName: screen.displayName,
      }
    }
    return map
  }, [screenDocs])
  const routingMap = hostResult?.data?.screens as
    | Record<string, string>
    | undefined

  const publishedPath = routingMap?.[screenId]
  const parentId = screenResult?.data?.parentId
  const [slugInput, setSlugInput] = useState<string | null>(null)
  const slugValue =
    slugInput ?? screenResult?.data?.slug ?? publishedPath ?? ''
  const normalizedSlug = Aglyn.normalizeScreenSlug(slugValue)
  // Candidate map with the pending slug applied, so the composed path and
  // conflict check reflect what Publish would write.
  const candidateById = useMemo(
    () => ({
      ...screensById,
      [screenId]: {
        ...screensById[screenId],
        slug: normalizedSlug,
        parentId,
      },
    }),
    [screensById, screenId, normalizedSlug, parentId],
  )
  const composedPath = normalizedSlug
    ? Aglyn.composeScreenRoutePath(screenId, candidateById)
    : undefined
  const slugOwner = composedPath
    ? Aglyn.findScreenIdByRoutePath(routingMap, composedPath)
    : undefined
  const slugConflict = Boolean(slugOwner && slugOwner !== screenId)
  const unpublishedAncestor = Boolean(normalizedSlug && !composedPath)

  // Routing entries for this screen plus all descendants under a candidate
  // screens map; null removes entries whose chain no longer resolves.
  const buildRouteEntries = useCallback(
    (byId: Record<string, Aglyn.ScreenRouteNode | undefined>) =>
      Aglyn.buildScreenRouteEntries(screenId, byId, routingMap),
    [screenId, routingMap],
  )

  const handlePublish = useCallback(async () => {
    if (slugConflict || unpublishedAncestor) return
    const action =
      normalizedSlug && composedPath
        ? updateScreenDoc({ slug: normalizedSlug } as any)
            .then(() =>
              syncScreenRouteEntries(
                firestore,
                hostId,
                buildRouteEntries(candidateById),
              ),
            )
            .then(() => {
              setSlugInput(null)
              enqueueSnackbar(
                `Published at ${Aglyn.screenRoutePathToUrl(composedPath)}`,
                { variant: 'success', persist: false },
              )
            })
        : updateScreenDoc({ slug: deleteField() } as any)
            .then(() =>
              syncScreenRouteEntries(
                firestore,
                hostId,
                buildRouteEntries({
                  ...screensById,
                  [screenId]: {
                    ...screensById[screenId],
                    slug: undefined,
                    parentId,
                  },
                }),
              ),
            )
            .then(() => {
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
    unpublishedAncestor,
    normalizedSlug,
    composedPath,
    candidateById,
    screensById,
    parentId,
    buildRouteEntries,
    updateScreenDoc,
    firestore,
    hostId,
    screenId,
    enqueueSnackbar,
  ])

  const handleParentChange = useCallback(
    async (event) => {
      const value = event.target.value as string
      const nextParentId = value === '__none__' ? undefined : value
      if (Aglyn.wouldCreateScreenCycle(screenId, nextParentId, screensById)) {
        return enqueueSnackbar(
          "A screen can't be nested inside itself or its own children",
          { variant: 'warning', persist: false },
        )
      }
      const nextById = {
        ...screensById,
        [screenId]: { ...screensById[screenId], parentId: nextParentId },
      }
      const nextSelfPath = Aglyn.composeScreenRoutePath(screenId, nextById)
      const owner = nextSelfPath
        ? Aglyn.findScreenIdByRoutePath(routingMap, nextSelfPath)
        : undefined
      if (owner && owner !== screenId) {
        return enqueueSnackbar(
          `Another screen is already published at ${Aglyn.screenRoutePathToUrl(nextSelfPath as string)}`,
          { variant: 'warning', persist: false },
        )
      }
      await updateScreenDoc({
        parentId: nextParentId ?? (deleteField() as any),
      } as any)
        .then(() =>
          syncScreenRouteEntries(
            firestore,
            hostId,
            buildRouteEntries(nextById),
          ),
        )
        .then(() => {
          enqueueSnackbar(
            nextParentId ? 'Parent screen assigned' : 'Parent screen removed',
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
    [
      screenId,
      screensById,
      routingMap,
      buildRouteEntries,
      updateScreenDoc,
      firestore,
      hostId,
      enqueueSnackbar,
    ],
  )

  const handlePreview = useCallback(() => {
    const ids = { hostId, screenId, versionId }
    // Preview what the site will render: the draft screen composed into its
    // bound layout's published version.
    const composed = Aglyn.composeLayoutAndScreenNodes(
      layoutId ? (layoutVersionResult?.data?.nodes as any) : undefined,
      Aglyn.canvas.toJSON().nodes as any,
    )
    writePreviewState(ids, composed as any, hostTheme)
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

  // Id-based screen links: the canvas resolves hrefs from the live routing
  // map (rendered, never navigable in the editor), and the Attributes panel
  // uses the same context to list screens in the screen-select field.
  const screenLinks = useMemo(
    () => ({
      screens: routingMap,
      labels: Object.fromEntries(
        Object.entries(screensById).map(([id, screen]) => [
          id,
          screen?.displayName ?? id,
        ]),
      ),
      suppressNavigation: true,
    }),
    [routingMap, screensById],
  )


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
    <Aglyn.ScreenLinkContext.Provider value={screenLinks}>
    <ReusableComponentsProvider hostId={hostId}>
    <AiAssistProvider>
    <BindingPickerProvider hostId={hostId}>
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
            current={{ kind: 'screen', id: screenId }}
          />
        }
        // appBarSuffix={'Besigner'}
        actionsPrefix={
          <>
          <BesignerFunctionsButton hostId={hostId} />
          <BesignerVersionsComponent
            hostId={hostId}
            parent={{ kind: 'screen', id: screenId }}
            versionId={versionId}
            publishedVersionId={screenResult?.data?.versionId}
          />
          </>
        }
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
            {'The slug is this screen\'s own path segment; nesting under a parent screen composes the full path (parent "company" + slug "about" → /company/about). Use "/" for the home page. Clearing the slug and pressing Unpublish removes the screen (and unroutes its children) from the site.'}
          </Typography>
          <TextField
            select
            size="small"
            label="Parent screen"
            value={parentId ?? '__none__'}
            onChange={handleParentChange}
          >
            <MenuItem value="__none__">{'None (top level)'}</MenuItem>
            {(screenDocs ?? [])
              .filter(
                (screen) =>
                  screen.$id !== screenId &&
                  !Aglyn.wouldCreateScreenCycle(
                    screenId,
                    screen.$id,
                    screensById,
                  ),
              )
              .map((screen) => (
                <MenuItem key={screen.$id} value={screen.$id}>
                  {screen.displayName ?? screen.$id}
                </MenuItem>
              ))}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label="Slug"
              fullWidth
              value={slugValue}
              onChange={(e) => setSlugInput(e.target.value)}
              error={slugConflict || unpublishedAncestor}
              helperText={
                slugConflict
                  ? 'Another screen already uses this path'
                  : unpublishedAncestor
                    ? 'A parent screen has no slug yet — publish the parent first'
                    : composedPath
                      ? `Served at ${Aglyn.screenRoutePathToUrl(composedPath)}`
                      : publishedPath
                        ? `Currently published at ${Aglyn.screenRoutePathToUrl(publishedPath)}`
                        : 'Not published'
              }
            />
            <Button
              size="small"
              variant="outlined"
              onClick={handlePublish}
              disabled={
                slugConflict ||
                unpublishedAncestor ||
                (!normalizedSlug && !publishedPath)
              }
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
          <Typography variant="subtitle2">{'SEO'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'Search and social metadata for this screen. Saved separately ' +
              'from the canvas.'}
          </Typography>
          <TextField
            size="small"
            label="Search title"
            value={seoTitle ?? (screenResult?.data as any)?.seo?.title ?? ''}
            onChange={(e) => setSeoTitle(e.target.value)}
            helperText="Shown as the tab/search result title (≤60 chars works best)"
          />
          <TextField
            size="small"
            label="Search description"
            multiline
            minRows={2}
            value={
              seoDescription ??
              (screenResult?.data as any)?.seo?.description ??
              ''
            }
            onChange={(e) => setSeoDescription(e.target.value)}
            helperText="Search snippet / social share text (≤160 chars works best)"
          />
          <Button
            size="small"
            variant="outlined"
            onClick={handleSeoSave}
            disabled={seoTitle == null && seoDescription == null}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Save SEO'}
          </Button>
          <Typography variant="subtitle2">{'Password protection'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {(screenResult?.data as any)?.protection?.passwordHash
              ? 'This screen is password-protected. Enter a new password to ' +
                'change it, or save empty to remove protection.'
              : 'Visitors must enter this password to view the published ' +
                'screen. Leave empty for public.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              type="password"
              label="Password"
              value={protectPassword ?? ''}
              onChange={(e) => setProtectPassword(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={handleProtectionSave}
              disabled={protectPassword == null}
            >
              {'Save'}
            </Button>
          </Stack>
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
    </BesignerMediaPickerProvider>
    </BindingPickerProvider>
    </AiAssistProvider>
    </ReusableComponentsProvider>
    </Aglyn.ScreenLinkContext.Provider>
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
