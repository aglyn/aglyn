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

import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { _isArr, _isEqualitySameType } from '@aglyn/shared-util-tools'
import Box, { BoxProps } from '@mui/material/Box'
import { teal } from '@mui/material/colors'

import clsx from 'clsx'
import React from 'react'

const rulerClassKey = generateComponentClassKeys('AglynRuler', [
  'vertical',
  'horizontal',
])

export interface RulerComponentProps extends BoxProps {
  variant?: 'vertical' | 'horizontal'
}

export const RulerComponent = styled(
  ({ variant, className, ...props }: RulerComponentProps) => (
    <Box
      className={clsx(
        {
          [rulerClassKey.horizontal]: variant === 'horizontal',
          [rulerClassKey.vertical]:
            variant === 'vertical' || variant !== 'horizontal',
        },
        className,
      )}
      {...props}
    />
  ),
  {
    name: 'RulerComponent',
  },
)<RulerComponentProps>(({ theme }) => ({
  position: 'absolute',
  boxShadow: theme.shadows[3],
  borderBottom: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.paper,
  backgroundPosition: '0 0, 0px 10px, 0 12px',
  backgroundSize: '50px 50px, 10px 50px, 5px 50px',
  backgroundImage: [0, 0, 0]
    .map(
      () =>
        `linear-gradient(to left, ${theme.palette.divider} 1px, transparent 1px)`,
    )
    .join(),
  backgroundRepeat: 'repeat-x',
  [`&.${rulerClassKey.horizontal}`]: {
    top: 0,
    left: 16,
    width: '100%',
    height: 15,
  },
  [`&.${rulerClassKey.vertical}`]: {
    top: 0,
    left: 16,
    width: '100%',
    height: 15,
    transform: 'rotateZ(90deg) rotateX(180deg)',
    transformOrigin: '0% 100%',
  },
}))
RulerComponent.displayName = 'RulerComponent'
RulerComponent.aglyn = true

const guideClassKey = generateComponentClassKeys('AglynGuide', [
  'vertical',
  'horizontal',
])

export interface GuideComponentProps extends BoxProps {
  offset?: number /* The amount of pixels to displace from the ruler */
  variant?: 'vertical' | 'horizontal'
}

const GuideComponent = styled(
  ({ variant, className, ...props }: GuideComponentProps) => (
    <Box
      className={clsx(
        {
          [guideClassKey.horizontal]: variant === 'horizontal',
          [guideClassKey.vertical]: variant !== 'horizontal',
        },
        className,
      )}
      {...props}
    />
  ),
  {
    name: 'GuideContainer',
    shouldForwardProp(propName) {
      return !_isEqualitySameType(propName, null, 'offset')
    },
  },
)<GuideComponentProps>(({ offset }) => ({
  position: 'absolute',
  '&:after': {
    display: 'block',
    content: '" "',
    position: 'absolute',
    backgroundColor: teal['A200'],
  },
  [`&.${guideClassKey.horizontal}`]: {
    width: 11,
    height: '100%',
    top: offset ?? 0,
    cursor: 'ew-resize',
    '&:after': {
      height: 1,
      width: '100%',
      top: 5,
      left: 0,
    },
  },
  [`&.${guideClassKey.vertical}`]: {
    cursor: 'ns-resize',
    height: 11,
    width: '100%',
    left: offset ?? 0,
    '&:after': {
      width: 1,
      height: '100%',
      left: 5,
      top: 0,
    },
  },
}))
GuideComponent.displayName = 'GuideComponent'
GuideComponent.aglyn = true

const RulerGuidesContainer = styled(Box, { name: 'RulerGuidesContainer' })(
  ({ theme }) => ({
    zIndex: theme.zIndex.speedDial,
    // pointerEvents: 'none',
    position: 'relative',
    // left: 0, right: 0, top: 0,
    // width: '100%', height: '100%',
  }),
)

export interface RulerGuidesProps extends BoxProps {
  guides?: GuideComponentProps[]
  RulerComponentProps?: {
    vertical?: RulerComponentProps
    horizontal?: RulerComponentProps
  }
}

export const RulerGuidesComponent = React.forwardRef<any, RulerGuidesProps>(
  function RefRenderFn(props, ref) {
    const { children, guides, RulerComponentProps, ...rest } = props

    return (
      <RulerGuidesContainer ref={ref} {...rest}>
        {children}
        <RulerComponent
          variant="horizontal"
          {...RulerComponentProps?.horizontal}
        />
        <RulerComponent variant="vertical" {...RulerComponentProps?.vertical} />
        {_isArr(guides) &&
          guides.map(({ ...guide }, i) => (
            <GuideComponent key={guide.key ?? guide.id ?? i} {...guide} />
          ))}
      </RulerGuidesContainer>
    )
  },
)

RulerGuidesComponent.displayName = 'RulerGuidesComponent'
RulerGuidesComponent.aglyn = true

export default RulerGuidesComponent
