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

import {OverrideableComponentProps} from '@aglyn/shared-data-types'
import {styled} from '@aglyn/shared-feature-themes'
import {forwardRef, HTMLAttributes} from 'react'


const BackgroundImageRoot = styled('div', {
  name: 'AglynBackgroundImage',
})({
  backgroundColor: 'inherit',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'bottom center',
  backgroundSize: 'cover',
  backgroundImage: null,
})

type BaseProps = HTMLAttributes<HTMLDivElement>

export interface BackgroundImageProps extends BaseProps, OverrideableComponentProps {
  url: string
  parallax?: boolean
}

const BackgroundImage = forwardRef<any, BackgroundImageProps>(
  function RefRenderFn(props, ref) {
    const {url, parallax, style, ...rest} = props
    return (
      <BackgroundImageRoot
        ref={ref}
        {...rest}
        style={{
          ...style,
          backgroundImage: `url(${url})`,
          backgroundAttachment: parallax ? 'fixed' : undefined,
        }}
      />
    )
  },
)

BackgroundImage.displayName = 'BackgroundImage'

export {BackgroundImage}
export default BackgroundImage
