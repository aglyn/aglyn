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

import { getApp, setCanvasElements } from '@aglyn/foundation-data-core'
import {
  AddControlsComponent,
  DevicePreviewControlsComponent,
  HistoryControlsComponent,
  PanelControlsComponent,
  useBesignerAppContext,
  withBesignerContext,
  WorkspaceEditorComponentProps,
} from '@aglyn/besigner-feature-app'
import { useAglynCanvasElementsNormalized } from '@aglyn/foundation-feature-renderer'
// import '@aglyn/foundation-feature-singleton'
import { HAS_BROWSER, ICON_VARIANT_LEFT } from '@aglyn/shared-data-enums'
import { useScreenVersion } from '@aglyn/foundation-data-tenants'
import {
  AppLink,
  LOADING_OVERLAY_ELEMENT,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { decode, encode } from '@msgpack/msgpack'
import { Button, Stack, Typography } from '@mui/material'
import { Bytes, Timestamp } from 'firebase/firestore'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useCallback, useEffect } from 'react'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import ConsoleLayout from '../../../../../../components/layouts/console.layout'
import SecondaryAppBarComponent from '../../../../../../components/secondary-app-bar.component'
import '../../../../../../constants/app-setup'
import { buildRoute, Route } from '../../../../../../constants/route-links'

const WorkspaceEditorComponent = dynamic<WorkspaceEditorComponentProps>(
  () =>
    import('@aglyn/besigner-feature-app').then(
      (mod) => mod.WorkspaceEditorComponent,
    ),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)

function Besigner(props) {
  const { query } = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const app = useBesignerAppContext()
  const screenId = `${query.screenId}`
  const versionId = `${query.versionId}`
  const detailUrl = buildRoute(Route.SCREEN_DETAILS, { screenId, versionId })
  const normalized = useAglynCanvasElementsNormalized()
  const [{ status, data: screen, error }, updateScreen] = useScreenVersion<any>(
    {
      screenId,
      versionId,
    },
  )
  const elements = screen?.elements
  const hasError = status === 'error'
  const notFound = status === 'success' && !screen

  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('page:/besigner app', getApp())
    }
  }, [])

  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('Besigner props.tenant,', props.tenant, props)
      console.log('Besigner status screen,', status, screen)
    }
  }, [props, screen, status])

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

  useEffect(() => {
    if (elements && elements instanceof Bytes) {
      const decoded: any = decode(elements.toUint8Array())
      console.log('decoded update', decoded)
      setCanvasElements(app, { elements: decoded, type: 'normal' })
    }
  }, [app, elements])

  const handleClick = useCallback(async () => {
    const dequeueLoading = queueLoading()
    const encodedNormal = Bytes.fromUint8Array(encode(normalized))
    const timestamp = Timestamp.now()
    await updateScreen(
      {
        elements: encodedNormal,
        updatedAt: timestamp,
      },
      { merge: true },
    ).catch((e) => {
      enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    })
    dequeueLoading()
  }, [updateScreen, enqueueSnackbar, normalized, queueLoading])

  return (
    <>
      <NextPageTitle screen={'Besigner'} />

      {error || notFound ? (
        <Stack alignItems="center" justifyContent="center">
          <Typography>{'Not found'}</Typography>
        </Stack>
      ) : status === 'loading' ? (
        LOADING_OVERLAY_ELEMENT
      ) : (
        <>
          <SecondaryAppBarComponent
            tabBarTitle={
              <Stack
                direction="row"
                spacing={{ sm: 0.15, md: 0.5 }}
                alignItems="center"
                typography={'subtitle2'}
                lineHeight={'normal'}
                sx={{ color: 'tertiary.light' }}
                component={AppLink}
                componentVariant={'text'}
                underline="none"
                href={detailUrl}
              >
                <MdiIcon path={ICON_VARIANT_LEFT.path} fontSize={'small'} />
                <span>{'Details'}</span>
              </Stack>
            }
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              width={1}
              spacing={1}
            >
              <AddControlsComponent />
              <HistoryControlsComponent sx={{ flexGrow: 1 }} />
              <DevicePreviewControlsComponent />
              {/*<InteractControlsComponent />*/}
              <PanelControlsComponent />
              <Button onClick={handleClick}>Save</Button>
            </Stack>
          </SecondaryAppBarComponent>
          <WorkspaceEditorComponent />
        </>
      )}
    </>
  )
}

Besigner.displayName = 'Page:Besigner'
Besigner.layouts = [AuthenticatedLayout, ConsoleLayout]
Besigner.layoutProps = {
  ConsoleLayout: {
    title: 'Besigner',
    appBarSuffix: 'Besigner',
  },
}

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
