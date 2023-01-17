/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { CSSObject, styled } from '@aglyn/shared-ui-theme'
import { _isEqualitySameType } from '@aglyn/shared-util-guards'
import { Box, type BoxProps as MuiBoxProps } from '@mui/material'

interface OverrideProps {
  url: string
  parallax?: boolean
  bgPosition?: CSSObject['backgroundPosition']
  bgRepeat?: CSSObject['backgroundRepeat']
  bgSize?: CSSObject['backgroundSize']
}

export type BackgroundImageComponentProps = MuiBoxProps<any, OverrideProps>

const BackgroundImageComponent = styled(Box, {
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
  ({ url, parallax, bgRepeat, bgPosition, bgSize }) => ({
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
BackgroundImageComponent.defaultProps = {
  bgPosition: 'bottom center',
  bgRepeat: 'no-repeat',
  bgSize: 'cover',
}

export { BackgroundImageComponent }
export default BackgroundImageComponent
