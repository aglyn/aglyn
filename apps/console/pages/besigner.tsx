/**
 * @license
 * Copyright 2021 Aglyn LLC
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
import {IS_BROWSER} from '@aglyn/shared-data-brand'
import {AppLoaderOverlayView} from '@aglyn/shared-ui-jsx'
import dynamic from 'next/dynamic'
import {useEffect} from 'react'


const AglynBesigner = dynamic(
  () => import('@aglyn/core-feature-besigner').then((mod) => mod.BesignerComponent),
  {ssr: false, loading: () => <AppLoaderOverlayView open />},
)

function Besigner(props) {

  useEffect(() => {
    if (IS_BROWSER) {
      console.log('page:/besigner app', getApp())
    }
  }, [])

  return <AglynBesigner />
}

Besigner.displayName = 'Page-Besigner'

export default Besigner
