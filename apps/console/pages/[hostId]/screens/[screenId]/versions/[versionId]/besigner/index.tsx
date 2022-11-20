/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn'
import '@aglyn/aglyn-plugin-mui'
import {
  PropertiesDialogComponent,
  useAddElementDrawerCallback,
  useAglynCanvasHistoryControls,
  withBesignerContext,
  type WorkspaceEditorComponentProps,
} from '@aglyn/besigner-feature-app'
import { useAglynCanvasElementsNormalized } from '@aglyn/core-feature-renderer'
// import '@aglyn/foundation-feature-singleton'
import {
  HAS_BROWSER,
  ICON_VARIANT_APP_SETTINGS,
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { iJSON } from '@aglyn/shared-data-types'
import {
  AppLink,
  LOADING_OVERLAY_ELEMENT,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useScreenVersion } from '@aglyn/tenant-feature-instance'
import { json as codeMirrorJson } from '@codemirror/lang-json'
import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  type DialogProps,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { githubDark } from '@uiw/codemirror-theme-github'
import CodeEditor from '@uiw/react-codemirror'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useState } from 'react'
import BesignerAppBarComponent from '../../../../../../../components/besigner-app-bar.component'
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import '../../../../../../../constants/app-setup'
import { buildRoute, Route } from '../../../../../../../constants/route-links'

const WorkspaceEditorComponent = dynamic<WorkspaceEditorComponentProps>(
  () =>
    import('@aglyn/besigner-feature-app').then(
      (mod) => mod.WorkspaceEditorComponent,
    ),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const ViewportRootComponent = dynamic<WorkspaceEditorComponentProps>(
  () =>
    import('@aglyn/besigner-feature-app').then(
      (mod) => mod.ViewportRootComponent,
    ),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const ViewportCanvasComponent = dynamic<WorkspaceEditorComponentProps>(
  () =>
    import('@aglyn/besigner-feature-app').then(
      (mod) => mod.ViewportCanvasComponent,
    ),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)

interface JsonEditorDialogProps extends Omit<DialogProps, 'defaultValue'> {
  onSave?: {
    bivarianceHack(event: object, value: iJSON): void
  }['bivarianceHack']
  defaultValue?: iJSON
}

function JsonEditorModal(props: JsonEditorDialogProps) {
  const { onClose, onSave, defaultValue, ...rest } = props

  const [data, setData] = useState(defaultValue)
  const handleChange = useCallback((value) => {
    try {
      const json = JSON.parse(value)
      setData(json)
    } catch (e) {
      console.warn(e)
    }
  }, [])
  const handleSave = useCallback(
    (event) => {
      console.log('handleSave', data)
      onSave && onSave(event, data)
    },
    [onSave, data],
  )

  return (
    <>
      <Dialog maxWidth="lg" fullWidth onClose={onClose} {...rest}>
        <DialogTitle>Screen Raw JSON</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <Alert severity="warning">
              <AlertTitle>Warning: Advanced Feature Ahead!</AlertTitle>
              Using the raw json editor is highly discouraged and should only be
              used by individuals who understand the consequences. Changes may
              potentially result in undesired outcomes which are{' '}
              <strong>destructive and irreversible</strong>.
            </Alert>
          </DialogContentText>
          <br />
          <CodeEditor
            // initialState={{ json: JSON.stringify(data, null, 2) }}
            value={JSON.stringify(defaultValue, null, 2)}
            onChange={handleChange}
            theme={githubDark}
            extensions={[codeMirrorJson() /*linter,*/ /*lintGutter()*/]}
            height="50vh"
            basicSetup={{
              lintKeymap: true,
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose as any}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save JSON</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function Besigner(props) {
  const { query } = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const hostId = query.hostId as string
  const screenId = query.screenId as string
  const versionId = query.versionId as string
  const saveAvailable = true
  const [screenDialog, setScreenDialog] = useState(false)
  const handleAddElementClick = useAddElementDrawerCallback()
  const [undo, redo, canUndo, canRedo] = useAglynCanvasHistoryControls()
  const detailUrl = buildRoute(Route.SCREEN_DETAILS, {
    hostId,
    screenId,
    versionId,
  })
  const normalized = useAglynCanvasElementsNormalized()
  const [result, updateScreen] = useScreenVersion({
    hostId,
    screenId,
    versionId,
  })
  const { data, status, error } = result
  const nodes = data?.nodes
  const hasError = Boolean(error) || status === 'error'
  const notFound = status === 'success' && !data

  console.log('result', result)

  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('page:/besigner app', Aglyn)
    }
  }, [])

  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('Besigner props.tenant,', props.tenant, props)
      console.log('Besigner status screen,', status, data)
    }
  }, [props, data, status])

  useEffect(() => {
    if (hasError) {
      enqueueSnackbar(`Error: ${error?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    } else if (notFound) {
      enqueueSnackbar('404: Screen not found', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [enqueueSnackbar, hasError, error, notFound])

  const updateCanvasElements = useCallback((e, value: any) => {
    const nodes = Aglyn.screen.processNodesToDenormalized(value)
    Aglyn.screen.setNodes(nodes)
  }, [])

  useEffect(() => {
    if (nodes) {
      console.log('decoded update', nodes)
      updateCanvasElements(null, nodes)
    }
  }, [updateCanvasElements, nodes])

  const handleSave = useCallback(async () => {
    const dequeueLoading = queueLoading()
    const nodes = normalized
    const isNested = Array.isArray(nodes)
    const denormalized = !isNested
      ? Aglyn.screen.denormalizeNodes(
          [
            {
              $id: Aglyn.NODE_ROOT_ID,
              componentId: 'div',
              nodes: [
                { ...Aglyn.screen.nestNodes(nodes, nodes[Aglyn.NODE_ROOT_ID]) },
              ],
            },
          ],
          null,
        )
      : Aglyn.screen.denormalizeNodes(
          [
            {
              $id: Aglyn.NODE_ROOT_ID,
              componentId: 'div',
              nodes: [...nodes],
            },
          ],
          null,
        )

    console.log('denormalized', isNested, denormalized)
    console.log(
      'nested',
      Aglyn.screen.nestNodes(denormalized, denormalized[Aglyn.NODE_ROOT_ID]),
    )
    // dequeueLoading()

    // return
    await updateScreen({ nodes: denormalized }, { merge: true })
      .catch((e) => {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
          variant: 'error',
          allowDuplicate: true,
        })
      })
      .finally(() => {
        dequeueLoading()
      })
  }, [updateScreen, enqueueSnackbar, normalized, queueLoading])

  const [jsonOpen, setJsonOpen] = useState(false)
  const openJsonEditor = useCallback(() => setJsonOpen(true), [])
  const closeJsonEditor = useCallback(() => setJsonOpen(false), [])
  const handleJsonSave = useCallback(updateCanvasElements, [])

  return (
    <>
      <MainLayout
        title={'Besigner'}
        disableAppBarElevation
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
                icon: saveAvailable
                  ? undefined
                  : {
                      path: ICON_VARIANT_SYMBOL_CONFIRMED.path,
                    },
                children: saveAvailable ? 'Save' : 'Up to Date',
                onClick: handleSave,
                ListItemTextProps: { inset: Boolean(saveAvailable) },
              },
              {
                id: 'center-nav-file-close',
                children: 'Close',
                href: detailUrl,
                component: AppLink,
                componentVariant: 'naked',
                ListItemTextProps: { inset: true },
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
                  handleAddElementClick(Besigner.focus.state.lastSelected),
                disabled: true,
                ListItemTextProps: { inset: true },
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
                onClick: () => undo(),
                disabled: !canUndo,
                ListItemTextProps: { inset: true },
              },
              {
                id: 'center-nav-edit-redo',
                children: 'Redo',
                onClick: () => redo(),
                disabled: !canRedo,
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
          <Stack alignItems="center" justifyContent="center">
            <Typography>{'Not found'}</Typography>
          </Stack>
        ) : status === 'loading' ? (
          LOADING_OVERLAY_ELEMENT
        ) : (
          <>
            <BesignerAppBarComponent
              detailsUrl={detailUrl}
              onSave={handleSave}
              onPropertiesEdit={() => setScreenDialog(true)}
              saveAvailable
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
      {Aglyn.screen.state.nodes &&
        Aglyn.screen.state.nodes[Aglyn.NODE_ROOT_ID] && (
          <JsonEditorModal
            open={jsonOpen}
            onClose={closeJsonEditor}
            onSave={handleJsonSave}
            defaultValue={
              Aglyn.screen.nestNodes(
                Aglyn.screen.state.nodes,
                Aglyn.screen.state.nodes[Aglyn.NODE_ROOT_ID],
              ) as iJSON
            }
          />
        )}
    </>
  )
}

Besigner.displayName = 'Page:Besigner'
Besigner.layouts = [{ Component: AuthenticatedLayout }]

export default withBesignerContext(Besigner)

// export const getServerSideProps = async (ctx) => {
//   // await setAdminTenant({$id: '-atN0g5dZgoDp4rfMaO_', displayName: 'sample tenant', hosts: []})
//   console.log('Page:Besigner getStaticProps START')
//   const tenantId = '-atN0g5dZgoDp4rfMaO_'
//   const tenant = await getAdminTenant(tenantId)
//     .then((snapshot) => {
//       if (snapshot.exists()) {
//         console.log('getAdminTenant exists', tenantId, snapshot.val())
//         console.log(snapshot.val())
//         return snapshot.val()
//       }
//       else {
//         console.log('getAdminTenant No data available', tenantId)
//         return null
//       }
//     }).catch((error) => {
//       console.error(`getAdminTenant error`, tenantId, error)
//       return null
//     })
//   console.log('Page:Besigner getStaticProps AWAIT DONE', tenant)
//
//
//   if (!tenant && ctx) {
//     console.log('Page:Besigner WRITE START')
//     // await setAdminTenant({$id: '-atN0g5dZgoDp4rfMaO_', displayName: 'test fake tenant'})
//     // tenant = await getServerSideProps(null).then((data) => data.props.tenant)
//     console.log('Page:Besigner WRITE DONE', tenant)
//   }
//
//   return {
//     props: {
//       tenant,
//     },
//   }
// }
