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

import {styled} from '@aglyn/shared-feature-themes'
import {_isEqualitySameType} from '@aglyn/shared-util-guards'
import {Container, type ContainerProps as MuiContainerProps} from '@mui/material'


export interface ContainerProps extends MuiContainerProps {
  gutterY?: boolean,
  gutterMode?: 'margin' | 'padding'
  gutterBottom?: number
  gutterTop?: number
}

const ContainerComponent = styled(Container, {
  name: 'AglynContainer',
  shouldForwardProp: (propName) => (
    !_isEqualitySameType(propName, 'gutterY', 'gutterMode', 'gutterBottom', 'gutterTop')
  ),
})<ContainerProps>(({
  theme,
  gutterY,
  gutterMode,
  gutterTop,
  gutterBottom,
}) => {
  if (gutterY) {
    const mode = gutterMode === 'margin' ? 'margin' : 'padding'
    return ({
      [`${mode}Top`]: theme.spacing(gutterTop ?? 2),
      [`${mode}Bottom`]: theme.spacing(gutterBottom ?? 2),
    })
  }
  return {}
})
ContainerComponent.displayName = 'ContainerComponent'

export {ContainerComponent}
export default ContainerComponent
