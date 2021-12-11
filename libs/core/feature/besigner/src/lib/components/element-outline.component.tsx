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

import { OverridableStringUnion } from '@aglyn/shared-data-types'
import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import { useDynamicEffect } from '@aglyn/shared-ui-jsx'
import { getElementClientRectBounding, VirtualElement } from '@aglyn/shared-util-dom'
import { _isFnT } from '@aglyn/shared-util-guards'
import Box, { BoxProps } from '@mui/material/Box'
import clsx from 'clsx'
import { forwardRef, memo, useState } from 'react'

export interface ElementOutlineComponentPropsVariantOverrides {}

const classKeys = generateComponentClassKeys('AglynElementOutline', [
  'hovered',
  'selected'
])

const ElementOutline = styled(Box, {
  name: 'AglynElementOutline',
})(({ theme }) => ({
  pointerEvents: 'none',
  position: 'absolute',
  overflow: 'hidden',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  // marginLeft: -2, marginTop: -3,
  outlineWidth: 2,
  transition: theme.transitions.create(['width', 'height'], {
    duration: theme.transitions.duration.short,
    easing: theme.transitions.easing.easeInOut,
  }),
  [`&.${classKeys.hovered}`]: {
    outlineOffset: -1,
    outlineStyle: 'dashed',
    outlineColor: theme.palette.quaternary.main,
  },
  [`&.${classKeys.selected}`]: {
    outlineOffset: 1,
    outlineColor: theme.palette.secondary.light,
    outlineStyle: 'solid',
  },
}))

export interface AglynElementOutlineProps extends BoxProps {
  variant?: OverridableStringUnion<
    'hovered' | 'selected',
    ElementOutlineComponentPropsVariantOverrides
  >
  anchorEl?: null | VirtualElement | (() => VirtualElement)
}

const ElementOutlineComponentRaw = forwardRef<any, AglynElementOutlineProps>(
  function RefRenderFn(props, ref) {
    const { className: classNameProp, variant, anchorEl, ...rest } = props
    const className = clsx({
      [classKeys[variant]]: Boolean(classKeys[variant]),
    }, classNameProp)

    const [{ width, height }, setDimensions] = useState(() => ({
      width: 0,
      height: 0,
    }))

    useDynamicEffect(() => {
      const element = _isFnT(anchorEl) ? anchorEl() : anchorEl
      const rect = element && getElementClientRectBounding(element)
      setDimensions({
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      })
    }, [anchorEl])

    return (
      <ElementOutline
        ref={ref}
        className={className}
        style={{width, height}}
        {...rest}
      />
    )
  }
)

ElementOutlineComponentRaw.displayName = 'ElementOutlineComponent'
ElementOutlineComponentRaw.defaultProps = {
  variant: 'hovered',
}

export const ElementOutlineComponent = memo(ElementOutlineComponentRaw)
export default ElementOutlineComponent
