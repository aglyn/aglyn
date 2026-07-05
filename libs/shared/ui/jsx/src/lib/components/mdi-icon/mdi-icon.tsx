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

import { DEFAULT_ICON } from '@aglyn/shared-data-mdi'
import {
  SvgIcon as MuiSvgIcon,
  type SvgIconProps as MuiSvgIconProps,
} from '@mui/material'
// import { motion } from 'framer-motion'
import { type ElementType, forwardRef, useMemo } from 'react'

export type MdiIconProps<D extends ElementType = any, P = JSX.EmptyObj> = {
  path?: string
  children?: (d: string) => JSX.Children
} & Omit<MuiSvgIconProps<D, P>, 'children' | 'path'>

export const MdiIcon = forwardRef<any, MdiIconProps>((props, ref) => {
  const { path, children, ...rest } = props

  const d = useMemo<string>(() => {
    return (typeof path === 'string' && path) || DEFAULT_ICON.path
  }, [path])

  return (
    <MuiSvgIcon
      ref={ref}
      children={typeof children === 'function' ? children(d) : <path d={d} />}
      color="inherit"
      fontSize="inherit"
      {...rest}
    />
  )
})

MdiIcon.displayName = 'MdiIcon'
MdiIcon.aglyn = true

export default MdiIcon
