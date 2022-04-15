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

import type {ScreenUid, VersionUid} from '@aglyn/core-data-framework'
import {mergeSxProps, styled, type SxProps} from '@aglyn/shared-feature-themes'
import {type IframeHTMLAttributes} from 'react'


const host = process.env.AGLYN_SILOED_HOST

const BesignerFrame = styled('iframe', {
  name: 'AglynBesignerFrame',
})(({
  flexGrow: 1,
  position: 'unset',
  border: 'none',
}))

export interface BesignerProps extends IframeHTMLAttributes<HTMLIFrameElement> {
  screenId: ScreenUid
  versionId: VersionUid
  sx?: SxProps
}

function BesignerIframeComponent(props: BesignerProps) {
  const {sx, screenId, versionId, ...rest} = props

  return (
    <BesignerFrame
      sx={mergeSxProps(sx)}
      src={`//${host}/besigner/${screenId}/${versionId}`}
      {...rest}
    />
  )
}

BesignerIframeComponent.displayName = 'BesignerIframeComponent'

export {BesignerIframeComponent}
export default BesignerIframeComponent
