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

import { generateUtilityClasses, styled } from '@aglyn/shared-feature-themes'
import clsx from 'clsx'
import { forwardRef, HTMLAttributes } from 'react'
import { HoverOptions } from '../contexts/hover-context'


export interface HoverComponentProps extends HTMLAttributes<HTMLDivElement> {
  options?: HoverOptions
  open?: boolean
  onClose?: (event?: Element) => void
  variant?: 'hovered' | 'selected'
}

const classKeys = generateUtilityClasses('HoverRoot', [
  'open',
  'hovered',
  'selected',
])

const HoverRoot = styled('div', {name: 'HoverRoot'})(({theme}) => ({
  pointerEvents: 'none',
  position: 'absolute',
  visibility: 'hidden',
  transition: theme.transitions.create(['visibility', 'width', 'height', 'left', 'right', 'top', 'bottom'], {
    duration: theme.transitions.duration.short,
    easing: theme.transitions.easing.easeInOut,
  }),
  [`&.${classKeys.open}`]: {
    visibility: 'visible',
  },
  [`&.${classKeys.hovered}`]: {
    outlineWidth: 2,
    outlineOffset: 0,
    outlineColor: theme.palette.secondary.light,
    outlineStyle: 'dashed',
  },
  [`&.${classKeys.selected}`]: {
    outlineWidth: 2,
    outlineOffset: -2,
    outlineColor: theme.palette.quaternary.main,
    outlineStyle: 'solid',
  },
}))

export const HoverComponent = forwardRef<any, HoverComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      open,
      options,
      onClose,
      children,
      variant,
      ...rest
    } = props
    const className = clsx({
      [classKeys.open]: Boolean(open),
      [classKeys.hovered]: Boolean(variant !== 'selected'),
      [classKeys.selected]: Boolean(variant === 'selected'),
    })
    return (
      <HoverRoot
        ref={ref}
        style={{...options.clientRect}}
        className={className}
        {...rest}
      >
        {children}
      </HoverRoot>
    )
  },
)

HoverComponent.displayName = 'HoverComponent'
HoverComponent.defaultProps = {
  options: {
    $id: '__root__',
    clientRect: {
      left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0,
    } as any,
  },
}

export default HoverComponent
