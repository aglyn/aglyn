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

import { DEFAULT_ICON, type Icon } from '@aglyn/shared-data-mdi'
import {
  SvgIcon as MuiSvgIcon,
  type SvgIconProps as MuiSvgIconProps,
} from '@mui/material'
// import { motion } from 'framer-motion'
import {
  type ElementType,
  type ForwardRefExoticComponent,
  forwardRef,
  type RefAttributes,
  useMemo,
} from 'react'

/**
 * What `path` takes: the SVG path string, or a generated icon from
 * `@aglyn/shared-data-mdi` (`mdiCheck` is `{ id, name, path, … }`, not a
 * string), whose own `path` is drawn. Before AGL-4047 an icon object fell
 * through to DEFAULT_ICON, the "?" diamond.
 */
export type MdiIconPath = string | Pick<Icon, 'path'>

export type MdiIconProps<D extends ElementType = any, P = JSX.EmptyObj> = {
  path?: MdiIconPath
  children?: (d: string) => JSX.Children
} & Omit<MuiSvgIconProps<D, P>, 'children' | 'path'>

/**
 * The SvgIcon props with the default `D = any` carry a string index
 * signature, and `forwardRef`'s `PropsWithoutRef` (an `Omit`) flattens a type
 * with one down to that signature alone, dropping `path` and `children`. The
 * component was therefore typed `{ [key: string]: any }`, and `path={mdiX}`
 * typechecked. Typing the component with the props as declared keeps those
 * two checked (AGL-4047).
 */
type MdiIconComponent = ForwardRefExoticComponent<
  MdiIconProps & RefAttributes<any>
>

/** The path string to draw for `path`, or DEFAULT_ICON's when there is none. */
function resolveMdiIconPath(path: MdiIconPath | null | undefined): string {
  const d = typeof path === 'string' ? path : path?.path
  return (typeof d === 'string' && d) || DEFAULT_ICON.path
}

export const MdiIcon = forwardRef<any, MdiIconProps>((props, ref) => {
  const { path, children, ...rest } = props

  const d = useMemo<string>(() => resolveMdiIconPath(path), [path])

  return (
    <MuiSvgIcon
      ref={ref}
      children={typeof children === 'function' ? children(d) : <path d={d} />}
      color="inherit"
      fontSize="inherit"
      {...rest}
    />
  )
}) as MdiIconComponent

MdiIcon.displayName = 'MdiIcon'
MdiIcon.aglyn = true

export default MdiIcon
