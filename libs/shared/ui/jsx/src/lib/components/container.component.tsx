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
// eslint-disable-next-line no-restricted-imports
import type {Spacing} from '@mui/system/createTheme/createSpacing'


export interface ContainerProps extends MuiContainerProps {
  gutterMode?: 'margin' | 'padding'
  gutterY?: Parameters<Spacing> | boolean
}

const isBoolean = (value: unknown) => {
  return typeof value === 'boolean'
}

const ContainerComponent = styled(Container, {
  name: 'AglynContainer',
  shouldForwardProp: (propName) => !_isEqualitySameType(
    propName,
    'gutterMode',
    'gutterY',
  ),
})<ContainerProps>(({
  disableGutters,
  gutterMode,
  gutterY,
  theme,
}) => {
  if (disableGutters) return {}

  const mode = gutterMode === 'margin' ? 'margin' : 'padding'

  if (isBoolean(gutterY) && gutterY) {
    return ({
      [`${mode}Top`]: theme.spacing(2),
      [`${mode}Bottom`]: theme.spacing(2),
      [theme.breakpoints.up('md')]: {
        [`${mode}Top`]: theme.spacing(3),
        [`${mode}Bottom`]: theme.spacing(3),
      },
    })
  }
  else if (!isBoolean(gutterY) && gutterY) {
    const space = theme.spacing(
      ...(Array.isArray(gutterY) ? gutterY : [gutterY]) as Parameters<Spacing>
    )
    return ({
      [`${mode}Top`]: space,
      [`${mode}Bottom`]: space,
    })
  }
  return {}
})
ContainerComponent.displayName = 'AglynContainerComponent'

export {ContainerComponent}
export default ContainerComponent
