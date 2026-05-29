/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { SvgIcon, type SvgIconProps } from '@mui/material'
import { type CSSProperties, forwardRef } from 'react'
import useId from '../../hooks/use-id'

export interface MdIconProps extends SvgIconProps {
  path: string
  title?: string | null
  description?: string | null
  size?: number | string | null
  horizontal?: boolean
  vertical?: boolean
  rotate?: number
  spin?: boolean | number
  style?: CSSProperties
  inStack?: boolean
}

export const MdIcon = forwardRef<SVGSVGElement, MdIconProps>((props, ref) => {
  const {
    path,
    id: idProp,
    title = null,
    description = null,
    size = null,
    color = 'currentColor',
    horizontal = false,
    vertical = false,
    rotate = 0,
    spin = false,
    style = {} as CSSProperties,
    inStack = false,
    ...rest
  } = props
  const id = useId(idProp)
  const pathStyle: any = {}
  const transform = []
  if (size !== null) {
    if (inStack) {
      transform.push(`scale(${size})`)
    } else {
      style.width = typeof size === 'string' ? size : `${size * 1.5}rem`
      style.height = style.width
    }
  }
  if (horizontal) {
    transform.push('scaleX(-1)')
  }
  if (vertical) {
    transform.push('scaleY(-1)')
  }
  if (rotate !== 0) {
    transform.push(`rotate(${rotate}deg)`)
  }
  if (color !== null) {
    pathStyle.fill = color
  }
  const pathElement = (
    <path d={path} style={pathStyle} {...((inStack ? rest : {}) as any)} />
  )
  let transformElement = pathElement
  if (transform.length > 0) {
    style.transform = transform.join(' ')
    style.transformOrigin = 'center'
    if (inStack) {
      transformElement = (
        <g style={style}>
          {pathElement}
          <rect width="24" height="24" fill="transparent" />
        </g>
      )
    }
  }
  let spinElement = transformElement
  const spinSec = spin === true || typeof spin !== 'number' ? 2 : spin
  let inverse = !inStack && (horizontal || vertical)
  if (spinSec < 0) {
    inverse = !inverse
  }
  if (spin) {
    spinElement = (
      <g
        style={{
          animation: `spin${inverse ? '-inverse' : ''} linear ${Math.abs(
            spinSec,
          )}s infinite`,
          transformOrigin: 'center',
        }}
      >
        {transformElement}
        {!(horizontal || vertical || rotate !== 0) && (
          <rect width="24" height="24" fill="transparent" />
        )}
      </g>
    )
  }
  if (inStack) {
    return spinElement
  }
  let ariaLabelledby
  const labelledById = `icon_labelledby_${id}`
  const describedById = `icon_describedby_${id}`
  let role
  if (title) {
    ariaLabelledby = description
      ? `${labelledById} ${describedById}`
      : labelledById
  } else {
    role = 'presentation'
    if (description) {
      throw new Error('title attribute required when description is set')
    }
  }
  return (
    <SvgIcon
      ref={ref}
      viewBox="0 0 24 24"
      style={style}
      role={role}
      aria-labelledby={ariaLabelledby}
      {...rest}
    >
      {title && <title id={labelledById}>{title}</title>}
      {description && <desc id={describedById}>{description}</desc>}
      {!inStack &&
        spin &&
        (inverse ? (
          <style>
            {
              '@keyframes spin-inverse { from { transform: rotate(0deg) } to { transform: rotate(-360deg) } }'
            }
          </style>
        ) : (
          <style>
            {
              '@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }'
            }
          </style>
        ))}
      {spinElement}
    </SvgIcon>
  )
})

MdIcon.displayName = 'MdIcon'

export default MdIcon
