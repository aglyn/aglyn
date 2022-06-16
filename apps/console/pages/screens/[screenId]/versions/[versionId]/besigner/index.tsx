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

import {getApp} from '@aglyn/core-data-framework'
import type {BesignerComponentProps} from '@aglyn/core-feature-besigner'
import {useBesignerAppContext} from '@aglyn/core-feature-besigner'
import {
  useAglynCanvasElementsDenormalized,
  useAglynCanvasElementsNormalized,
} from '@aglyn/core-feature-renderer'
// import '@aglyn/core-feature-singleton'
import {HAS_BROWSER} from '@aglyn/shared-data-enums'
import {LOADING_OVERLAY_ELEMENT, useLoading} from '@aglyn/shared-ui-jsx'
import {useNextPageTitle} from '@aglyn/shared-ui-next'
import {useSnackbar} from '@aglyn/shared-ui-snackstack'
import {encode} from '@msgpack/msgpack'
import {Button, Stack, Typography} from '@mui/material'
import {doc} from 'firebase/firestore'
import dynamic from 'next/dynamic'
import {useRouter} from 'next/router'
import {useCallback, useEffect} from 'react'
import {useFirestore, useFirestoreDocDataOnce} from 'reactfire'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import ConsoleLayout from '../../../../../../components/layouts/console.layout'
import '../../../../../../constants/app-setup'


const AglynBesigner = dynamic<BesignerComponentProps>(
  () => import('@aglyn/core-feature-besigner').then((mod) => mod.BesignerComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)


function InnerBesigner(props: {screen}) {
  const {screen} = props
  const elements = screen?.elements
  const denormalized = useAglynCanvasElementsDenormalized()
  const normalized = useAglynCanvasElementsNormalized()
  const app = useBesignerAppContext()
  const {queueLoading} = useLoading()
  const handleClick = useCallback(async () => {
    const dequeueLoading = queueLoading()
    // const elements = app?.canvas?.denormalizedElements
    console.log('elements denormalized pre-encode', denormalized)
    const encodedDenormal = encode(denormalized)
    console.log('elements denormalized encoded', encodedDenormal)
    console.log('elements normalized pre-encode', normalized)
    const encodedNormal = encode(normalized)
    console.log('elements normalized encoded', encodedNormal)
    dequeueLoading()
  }, [denormalized, normalized, queueLoading])


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
  useNextPageTitle({screen: 'Besigner'})
  const {query} = useRouter()
  const screenId = `${query.screenId}`
  const versionId = `${query.versionId}`
  const firestore = useFirestore()
  const screenRef = doc(firestore, 'screens', screenId, 'versions', versionId)
  const {status, data: screen, error} = useFirestoreDocDataOnce(screenRef, {idField: '$id'})
  const hasError = status === 'error'
  const notFound = status === 'success' && !screen
  const elements = screen?.elements
  const {enqueueSnackbar, closeSnackbar} = useSnackbar()

  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('page:/besigner app', getApp())
    }
  }, [])

  console.log('Besigner,', props.tenant, props)
  console.log('Besigner data,', status, screen)

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
  }, [closeSnackbar, enqueueSnackbar, hasError, error, notFound])

  return (
    <>
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
