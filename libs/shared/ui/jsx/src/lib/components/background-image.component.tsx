/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { styled } from '@aglyn/shared-ui-theme'
import { _isEqualitySameType } from '@aglyn/shared-util-tools'
import { Box as MuiBox, type BoxProps as MuiBoxProps } from '@mui/material'
import type { CSSProperties } from 'react'

interface OverrideProps {
  url: string
  parallax?: boolean
  bgPosition?: CSSProperties['backgroundPosition']
  bgRepeat?: CSSProperties['backgroundRepeat']
  bgSize?: CSSProperties['backgroundSize']
}

export type BackgroundImageComponentProps = MuiBoxProps<any, OverrideProps>

// Base on MuiBox (not 'div') so that the polymorphic `component` prop is
// handled natively by Box. styled('div') passes `component` straight to the
// DOM as an unknown attribute and never changes the rendered element type;
// styled(Box) converts `component` into an element-type change before
// rendering. MuiBox also owns sx/ownerState filtering, so we only need to
// block the background-image-specific custom props here.
export const BackgroundImageComponent = styled(MuiBox, {
  name: 'BackgroundImage',
  shouldForwardProp(propName) {
    return !_isEqualitySameType(
      propName,
      null,
      'url',
      'parallax',
      'bgPosition',
      'bgSize',
      'bgRepeat',
    )
  },
})<BackgroundImageComponentProps>(
  ({
    url,
    parallax,
    bgRepeat = 'no-repeat',
    bgPosition = 'bottom center',
    bgSize = 'cover',
  }) => ({
    backgroundColor: 'inherit',
    backgroundRepeat: bgRepeat,
    backgroundPosition: bgPosition,
    backgroundSize: bgSize,
    backgroundImage: `url(${url})`,
    backgroundAttachment: parallax ? 'fixed' : undefined,
  }),
)

BackgroundImageComponent.displayName = 'BackgroundImageComponent'
BackgroundImageComponent.aglyn = true

export default BackgroundImageComponent
