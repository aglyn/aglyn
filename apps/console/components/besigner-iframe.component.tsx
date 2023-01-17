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
import { AGLYN_SILOED_HOST } from '@aglyn/shared-data-enums'
import { mergeSxProps, styled, type SxProps } from '@aglyn/shared-ui-theme'
import { type IframeHTMLAttributes, useMemo } from 'react'

const BesignerFrame = styled('iframe', {
  name: 'AglynBesignerFrame',
})({
  flexGrow: 1,
  position: 'unset',
  border: 'none',
})

export interface BesignerProps extends IframeHTMLAttributes<HTMLIFrameElement> {
  screenId: Aglyn.ScreenUid
  versionId: Aglyn.VersionUid
  sx?: SxProps
}

function BesignerIframeComponent(props: BesignerProps) {
  const { sx, screenId, versionId, ...rest } = props

  const host = useMemo(() => {
    if (
      AGLYN_SILOED_HOST.startsWith('//') ||
      AGLYN_SILOED_HOST.startsWith('http')
    ) {
      return AGLYN_SILOED_HOST
    }
    return `//${AGLYN_SILOED_HOST}`
  }, [])

  return (
    <BesignerFrame
      sx={mergeSxProps(sx)}
      src={`${host}/besigner/${screenId}/${versionId}`}
      {...rest}
    />
  )
}

BesignerIframeComponent.displayName = 'BesignerIframeComponent'

export { BesignerIframeComponent }
export default BesignerIframeComponent
