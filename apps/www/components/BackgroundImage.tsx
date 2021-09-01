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

import { styled } from '@aglyn/shared/ui/themes'
import { HTMLAttributes } from 'react'


export interface BackgroundImageProps extends HTMLAttributes<HTMLDivElement> {
  url: string
  parallax?: boolean
}

const BackgroundImage = styled(({url, parallax, ...rest}: BackgroundImageProps)=>(
  <div
    style={{
      backgroundImage: `url(${url})`,
      backgroundAttachment: parallax ? 'fixed' : undefined
    }}
    {...rest}
  />
), {
  name: 'BackgroundImage',
  slot: 'Root',
})<BackgroundImageProps>(({
  backgroundColor: 'inherit',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'bottom center',
  backgroundSize: 'cover',
  backgroundImage: null
}))

BackgroundImage.displayName = 'BackgroundImage'

export default BackgroundImage
