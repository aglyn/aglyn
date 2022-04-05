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
import {HAS_BROWSER} from '@aglyn/shared-data-enums'
import {LoadingOverlayComponent} from '@aglyn/shared-ui-jsx'
import {useSnackbar} from '@aglyn/shared-ui-snackstack'
import {Stack, Typography} from '@mui/material'
import {doc} from 'firebase/firestore'
import dynamic from 'next/dynamic'
import {useRouter} from 'next/router'
import {useEffect} from 'react'
import {useFirestore, useFirestoreDocDataOnce} from 'reactfire'
import '../../../../../../constants/app-setup'
import LayoutConsoleComponent from '../../../../../../layouts/layout-console.component'


const AglynBesigner = dynamic<BesignerComponentProps>(
  () => import('@aglyn/core-feature-besigner').then((mod) => mod.BesignerComponent),
  {ssr: false, loading: () => <LoadingOverlayComponent open />},
)

function Besigner(props) {
  const {query: {screenId, versionId}} = useRouter()
  const firestore = useFirestore()
  const screenRef = doc(firestore, 'screen', `${screenId}`, 'version', `${versionId}`)
  const {status, data: screen, hasEmitted} = useFirestoreDocDataOnce(screenRef, {idField: '$id'})
  const elements = screen?.elements || {}
  const {enqueueSnackbar, closeSnackbar} = useSnackbar()

  console.log('Besigner,', props.tenant, props)
  console.log('Besigner data,', status, screen)


  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('page:/besigner app', getApp())
    }
  }, [])

  useEffect(() => {
    if (status === 'error' || (status === 'success' && !screen)) {
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [closeSnackbar, enqueueSnackbar, status, screen])

  return status === 'error' ? (
    <Stack
      alignItems="center"
      justifyContent="center"
    >
      <Typography>
        {'Not found'}
      </Typography>
    </Stack>
  ) : status === 'loading' ? (
    <LoadingOverlayComponent open />
  ) : (
    <AglynBesigner
      sx={{flexGrow: 1, position: 'unset'}}
      canvasElements={{elements: elements}}
    />
  )
}

Besigner.displayName = 'Page:Besigner'
Besigner.layoutComponent = LayoutConsoleComponent
Besigner.layoutProps = {
  LayoutConsoleComponent: {
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
