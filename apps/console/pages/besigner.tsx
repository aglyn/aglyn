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
import {getAdminTenant} from '@aglyn/core-data-tenancy'
import {HAS_BROWSER} from '@aglyn/shared-data-enums'
import {LoadingOverlayComponent} from '@aglyn/shared-ui-jsx'
import dynamic from 'next/dynamic'
import {useEffect} from 'react'
// import {useEffect} from 'react-hooks'
import '../constants/app-setup'


const AglynBesigner = dynamic(
  () => import('@aglyn/core-feature-besigner').then((mod) => mod.BesignerComponent),
  {ssr: false, loading: () => <LoadingOverlayComponent open />},
)

function Besigner(props) {

  console.log('Besigner,', props.tenant, props)


  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('page:/besigner app', getApp())
    }
  }, [])

  return <AglynBesigner />
}

Besigner.displayName = 'Page:Besigner'

export default Besigner


export const getServerSideProps = async (ctx) => {
  // await setAdminTenant({$id: '-atN0g5dZgoDp4rfMaO_', displayName: 'sample tenant', hosts: []})
  console.log('Page:Besigner getStaticProps START')
  const tenantId = '-atN0g5dZgoDp4rfMaO_'
  const tenant = await getAdminTenant(tenantId)
    .then((snapshot) => {
      if (snapshot.exists()) {
        console.log('getAdminTenant exists', tenantId, snapshot.val())
        console.log(snapshot.val())
        return snapshot.val()
      }
      else {
        console.log('getAdminTenant No data available', tenantId)
        return null
      }
    }).catch((error) => {
      console.error(`getAdminTenant error`, tenantId, error)
      return null
    })
  console.log('Page:Besigner getStaticProps AWAIT DONE', tenant)


  if (!tenant && ctx) {
    console.log('Page:Besigner WRITE START')
    // await setAdminTenant({$id: '-atN0g5dZgoDp4rfMaO_', displayName: 'test fake tenant'})
    // tenant = await getServerSideProps(null).then((data) => data.props.tenant)
    console.log('Page:Besigner WRITE DONE', tenant)
  }

  return {
    props: {
      tenant,
    },
  }
}
