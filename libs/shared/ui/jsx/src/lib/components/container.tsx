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

import { styled } from '@aglyn/shared-ui-theme'
import { _isEqualitySameType } from '@aglyn/shared-util-tools'
import {
  Container as MuiContainer,
  type ContainerProps as MuiContainerProps,
} from '@mui/material'
// eslint-disable-next-line no-restricted-imports
import type { Spacing } from '@mui/system/createTheme/createSpacing'

export interface ContainerProps extends MuiContainerProps {
  gutterMode?: 'margin' | 'padding'
  gutterY?: Partial<Parameters<Spacing>> | boolean
  dense?: boolean
}

const isBoolean = (value: unknown) => {
  return typeof value === 'boolean'
}

export const Container = styled(MuiContainer, {
  name: 'AglynContainer',
  shouldForwardProp: (propName) =>
    !_isEqualitySameType(propName, null, 'gutterMode', 'gutterY', 'dense'),
})<ContainerProps>(({ disableGutters, gutterMode, gutterY, theme, dense }) => {
  const mode = gutterMode === 'margin' ? 'margin' : 'padding'
  const base = dense
    ? {
        [`${mode}Left`]: theme.spacing(1),
        [`${mode}Right`]: theme.spacing(1),
        [theme.breakpoints.up('md')]: {
          [`${mode}Left`]: theme.spacing(2),
          [`${mode}Right`]: theme.spacing(2),
        },
      }
    : {}
  if (disableGutters) return base

  if (isBoolean(gutterY) && gutterY) {
    return {
      ...base,
      [`${mode}Top`]: theme.spacing(2),
      [`${mode}Bottom`]: theme.spacing(2),
      [theme.breakpoints.up('sm')]: {
        [`${mode}Top`]: theme.spacing(3),
        [`${mode}Bottom`]: theme.spacing(3),
      },
    }
  } else if (!isBoolean(gutterY) && gutterY) {
    const param = (
      Array.isArray(gutterY) ? gutterY : [gutterY]
    ) as Parameters<Spacing>
    const space = theme.spacing(...param)
    return {
      ...base,
      [`${mode}Top`]: space,
      [`${mode}Bottom`]: space,
    }
  }
  return base
})
Container.displayName = 'Container'
Container.aglyn = true

export default Container
