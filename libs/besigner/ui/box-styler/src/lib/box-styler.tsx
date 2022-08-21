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

import '@aglyn/shared-data-jsx'
import {
  alpha,
  generateComponentClassKeys,
  styled,
} from '@aglyn/shared-ui-theme'
import clsx from 'clsx'
import { forwardRef } from 'react'

export const classKeys = generateComponentClassKeys('BoxStyler', [
  'box',
  'margin',
  'padding',
  'row',
  'node',
])

const Wrapper = styled('div')(({ theme }) => {
  return {
    fontSize: '0.72rem',

    [`.${classKeys.box}`]: {
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 1,
      // flexGrow: 0.2,
      // flexShrink: 0.18,

      [`&.${classKeys.margin}, &.${classKeys.padding}`]: {
        // flexGrow: 0.1,
        flexShrink: 0.36,
      },
      [`&.${classKeys.node}`]: {
        // flexGrow: 0.1,
        flexShrink: 0.52,
      },
      [`> *`]: {
        width: '100%',
        textAlign: 'center',
      },
    },
    [`.${classKeys.box}:not(.${classKeys.row})`]: {
      justifyContent: 'space-around',
    },
    [`.${classKeys.row}`]: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    [`.${classKeys.margin}`]: {
      height: 184,
      minWidth: 258,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: theme.palette.warning.dark,
      backgroundColor: alpha(theme.palette.surface.main, 0.96),
      color: theme.palette.surface.contrastText,
    },
    [`.${classKeys.padding}`]: {
      height: 104,
      minWidth: 168,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: theme.palette.success.dark,
      backgroundColor: alpha(theme.palette.surface.main, 0.96),
      color: theme.palette.surface.contrastText,
    },
    [`.${classKeys.node}`]: {
      minHeight: 24,
      minWidth: 78,
      maxWidth: 168,
      borderStyle: 'solid',
      borderWidth: 1,
      borderColor: theme.palette.info.dark,
      backgroundColor: alpha(theme.palette.surface.dark, 0.87),
      color: theme.palette.surface.contrastText,
      // background: [
      //   'linear-gradient(',
      //   '65deg, ',
      //   `${alpha(theme.palette.tertiary.main, 0.59)}, `,
      //   `${alpha(theme.palette.secondary.main, 0.59)}`,
      //   ') border-box',
      // ].join(''),
    },
  }
})

const Property = styled('div')(({ theme }) => {
  return {}
})

type BoxStylerWrapperProps = JSX.ComponentProps<typeof Wrapper>

export interface BoxStylerProps extends BoxStylerWrapperProps {}

const BoxStyler = forwardRef<any, BoxStylerProps>((props, ref) => {
  const { ...rest } = props

  return (
    <Wrapper ref={ref} {...rest}>
      <div className={clsx(classKeys.box, classKeys.margin)}>
        <Property>6</Property>
        <div className={clsx(classKeys.box, classKeys.row)}>
          <Property>3</Property>
          <div className={clsx(classKeys.box, classKeys.padding)}>
            <Property>5</Property>
            <div className={clsx(classKeys.box, classKeys.row)}>
              <Property>1</Property>
              <div className={clsx(classKeys.box, classKeys.node)}>
                140 x 31
              </div>
              <Property>1</Property>
            </div>
            <Property>5</Property>
          </div>
          <Property>3</Property>
        </div>
        <Property>6</Property>
      </div>
    </Wrapper>
  )
})
BoxStyler.displayName = 'BoxStyler'
BoxStyler.defaultProps = {}
BoxStyler.aglyn = true
export { BoxStyler }
export default BoxStyler
