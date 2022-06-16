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

import {getApp, setCanvasElements} from '@aglyn/core-data-framework'
import type {BesignerComponentProps} from '@aglyn/core-feature-besigner'
import {useBesignerAppContext} from '@aglyn/core-feature-besigner'
import {useAglynCanvasElementsNormalized} from '@aglyn/core-feature-renderer'
// import '@aglyn/core-feature-singleton'
import {HAS_BROWSER, ICON_VARIANT_LEFT} from '@aglyn/shared-data-enums'
import {
  AppLink,
  LOADING_OVERLAY_ELEMENT,
  useIsomorphicLayoutEffect,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {NextPageTitle} from '@aglyn/shared-ui-next'
import {useSnackbar} from '@aglyn/shared-ui-snackstack'
import {decode, encode} from '@msgpack/msgpack'
import {Button, Stack, Typography} from '@mui/material'
import {Bytes, doc, setDoc} from 'firebase/firestore'
import dynamic from 'next/dynamic'
import {useRouter} from 'next/router'
import {useCallback, useEffect} from 'react'
import {useFirestore, useFirestoreDocDataOnce} from 'reactfire'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import ConsoleLayout from '../../../../../../components/layouts/console.layout'
import SecondaryAppBarComponent from '../../../../../../components/secondary-app-bar.component'
import '../../../../../../constants/app-setup'
import {buildRoute, Route} from '../../../../../../constants/route-links'


const AglynBesigner = dynamic<BesignerComponentProps>(
  () => import('@aglyn/core-feature-besigner').then((mod) => mod.BesignerComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)


function InnerBesigner(props: any) {
  const {screen, screenRef} = props
  const elements = screen?.elements
  const app = useBesignerAppContext()
  const {enqueueSnackbar} = useSnackbar()
  const {queueLoading} = useLoading()
  const normalized = useAglynCanvasElementsNormalized()

  useIsomorphicLayoutEffect(() => {
    if (elements && elements instanceof Bytes) {
      const decoded: any = decode(elements.toUint8Array())
      console.log('decoded update', decoded)
      setCanvasElements(app, {elements: decoded, type: 'normal'})
    }
  }, [app, elements])

  const handleClick = useCallback(async () => {
    const dequeueLoading = queueLoading()
    const encodedNormal = Bytes.fromUint8Array(encode(normalized))
    await setDoc(
      screenRef,
      {elements: encodedNormal},
      {merge: true},
    ).catch((e) => {
      enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    })
    dequeueLoading()
  }, [enqueueSnackbar, normalized, queueLoading, screenRef])

  return (
    <>
      <Button
        onClick={handleClick}
      >
        Save
      </Button>
    </>
  )
}
function Besigner(props) {
  const {query} = useRouter()
  const screenId = `${query.screenId}`
  const versionId = `${query.versionId}`
  const detailUrl = buildRoute(Route.SCREEN_DETAILS, {screenId, versionId})
  const firestore = useFirestore()
  const screenRef = doc(firestore, 'screens', screenId, 'versions', versionId)
  const {status, data: screen, error} = useFirestoreDocDataOnce(screenRef, {idField: '$id'})
  const hasError = status === 'error'
  const notFound = status === 'success' && !screen
  const {enqueueSnackbar} = useSnackbar()

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
      <NextPageTitle screen={'Besigner'} />
      <SecondaryAppBarComponent
        tabBarTitle={
          <Stack
            direction="row"
            spacing={{sm: 0.15, md: 0.5}}
            alignItems="center"
            typography={'subtitle2'}
            lineHeight={'normal'}
            sx={{color: 'tertiary.light'}}
            component={AppLink}
            componentVariant={'text'}
            underline="none"
            href={detailUrl}
          >
            <MdiIcon
              path={ICON_VARIANT_LEFT.path}
              fontSize={'small'}
            />
            <span>{'Details'}</span>
          </Stack>
        }
        // navTabItems={[
        //   {
        //     key: 'go-back',
        //     icon: {
        //       path: ICON_VARIANT_LEFT.path,
        //     },
        //     href: detailUrl,
        //     label: 'Details',
        //   },
        // ]}
        // activeTab={activeTab}
      />
      {error || notFound ? (
        <Stack
          alignItems="center"
          justifyContent="center"
        >
          <Typography>
            {'Not found'}
          </Typography>
        </Stack>
      ) : status === 'loading' ? (
        LOADING_OVERLAY_ELEMENT
      ) : (
        <AglynBesigner sx={{flexGrow: 1, position: 'unset'}}>
          <InnerBesigner
            screen={screen}
            screenRef={screenRef}
          />
        </AglynBesigner>
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

export default Besigner


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
