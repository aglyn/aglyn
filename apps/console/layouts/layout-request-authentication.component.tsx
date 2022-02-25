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

import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {BackgroundImageComponent, type BackgroundImageComponentProps} from '@aglyn/shared-ui-jsx'


export interface LayoutRequestAuthenticationProps extends Partial<BackgroundImageComponentProps> {

}

function LayoutRequestAuthenticationComponent(props: LayoutRequestAuthenticationProps) {
  const {children, sx, ...rest} = props


  return (
    <BackgroundImageComponent
      url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
      sx={mergeSxProps({
        minHeight: '100vh',
        bgcolor: 'primary.dark',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: [2, 3],
        color: 'common.white',
      }, sx)}
      {...rest}
    >

      {children}

    </BackgroundImageComponent>
  )
}
LayoutRequestAuthenticationComponent.displayName = 'LayoutRequestAuthenticationComponent'

export {LayoutRequestAuthenticationComponent}
export default LayoutRequestAuthenticationComponent
