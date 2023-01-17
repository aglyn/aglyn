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

import mergeSxProps from '@aglyn/shared-ui-theme/util/merge-sx-props'
import { SvgIcon, SvgIconProps } from '@mui/material'
import useId from '@mui/utils/useId'
import { Children, cloneElement, forwardRef, type ReactElement } from 'react'
import { type MdiIcon2Props } from './mdi-icon2'

export interface StackProps extends SvgIconProps {
  children: ReactElement<MdiIcon2Props>[] | ReactElement<MdiIcon2Props>
  title?: string | null
  description?: string | null
  size?: number | string | null
  horizontal?: boolean | null
  vertical?: boolean | null
  rotate?: number | null
  spin?: boolean | number | null
}

const MdiIcon2Stack = forwardRef<SVGSVGElement, StackProps>((props, ref) => {
  const {
    title = null,
    description = null,
    size = null,
    color = 'currentColor',
    horizontal = null,
    vertical = null,
    rotate = null,
    spin = null,
    children,
    sx,
    id: idProp,
    ...rest
  } = props
  const id = useId(idProp)
  let anySpin = spin === null ? false : spin
  const labelledById = `stack_labelledby_${id}`
  const describedById = `stack_describedby_${id}`
  const ariaLabelledby = description
    ? `${labelledById} ${describedById}`
    : labelledById

  const mappedChildren = Children.map(children, (child) => {
    const res = {
      size: child.props.size,
      color: color === null ? child.props.color : color,
      horizontal: horizontal === null ? child.props.horizontal : horizontal,
      vertical: vertical === null ? child.props.vertical : vertical,
      rotate: rotate === null ? child.props.rotate : rotate,
      spin: spin === null ? child.props.spin : spin,
      inStack: true,
    } as Partial<MdiIcon2Props>

    if (anySpin !== true) {
      anySpin = (spin === null ? child.props.spin : spin) === true
    }
    if (typeof size === 'number' && typeof child.props.size === 'number') {
      res.size = child.props.size / size
    }

    return cloneElement(child, res)
  })

  return (
    <SvgIcon
      ref={ref}
      sx={mergeSxProps(
        sx,
        size !== null && {
          width: typeof size === 'string' ? size : `${size * 1.5}rem`,
        },
        anySpin && {
          '@keyframes spin': {
            from: {
              transform: 'rotate(0deg)',
            },
            to: {
              transform: 'rotate(360deg)',
            },
          },
          '@keyframes spin-inverse': {
            from: {
              transform: 'rotate(0deg)',
            },
            to: {
              transform: 'rotate(-360deg)',
            },
          },
        },
      )}
      role={!title ? 'presentation' : undefined}
      aria-labelledby={!title ? undefined : ariaLabelledby}
      {...rest}
    >
      {title && <title id={labelledById}>{title}</title>}
      {description && <desc id={describedById}>{description}</desc>}

      {mappedChildren}
    </SvgIcon>
  )
})

MdiIcon2Stack.displayName = 'MdiIcon2Stack'
MdiIcon2Stack.defaultProps = {
  size: null,
  horizontal: null,
  vertical: null,
  rotate: null,
  spin: null,
}

export default MdiIcon2Stack
