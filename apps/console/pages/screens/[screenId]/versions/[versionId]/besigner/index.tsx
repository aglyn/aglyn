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

import {LOADING_OVERLAY_ELEMENT} from '@aglyn/shared-ui-jsx'
import {useNextPageTitle} from '@aglyn/shared-ui-next'
import {useSnackbar} from '@aglyn/shared-ui-snackstack'
import {Stack, Typography} from '@mui/material'
import {doc} from 'firebase/firestore'
import {useRouter} from 'next/router'
import {useEffect} from 'react'
import {useFirestore, useFirestoreDocDataOnce} from 'reactfire'
import BesignerIframeComponent from '../../../../../../components/besigner-iframe.component'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import ConsoleLayout from '../../../../../../components/layouts/console.layout'


function Besigner(props) {
  useNextPageTitle({screen: 'Besigner'})
  const {query} = useRouter()
  const screenId = `${query.screenId}`
  const versionId = `${query.versionId}`
  const firestore = useFirestore()
  const screenRef = doc(firestore, 'screens', screenId, 'versions', versionId)
  const {status, data: screen} = useFirestoreDocDataOnce(screenRef, {idField: '$id'})
  const elements = screen?.elements
  const {enqueueSnackbar, closeSnackbar} = useSnackbar()

  console.log('Besigner,', props.tenant, props)
  console.log('Besigner data,', status, screen)

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
    LOADING_OVERLAY_ELEMENT
  ) : (
    <BesignerIframeComponent
      screenId={screenId}
      versionId={versionId}
    />
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
