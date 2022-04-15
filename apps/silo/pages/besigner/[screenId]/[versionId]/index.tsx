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
import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {LOADING_OVERLAY_ELEMENT} from '@aglyn/shared-ui-jsx'
import dynamic from 'next/dynamic'
import {useEffect} from 'react'
import '../../../../constants/app-setup'


const AglynBesigner = dynamic<BesignerComponentProps>(
  () => import('@aglyn/core-feature-besigner').then((mod) => mod.BesignerComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)

export interface BesignerProps extends BesignerComponentProps {}


function BesignerComponent(props: BesignerProps) {
  const {sx, ...rest} = props


  useEffect(() => {
    if (HAS_BROWSER()) {
      console.log('page:/besigner app', getApp())
    }
  }, [])

  return (
    <AglynBesigner
      sx={mergeSxProps({flexGrow: 1, position: 'unset'}, sx)}
      {...rest}
    />
  )
}

BesignerComponent.displayName = 'BesignerComponent'

export {BesignerComponent}
export default BesignerComponent
