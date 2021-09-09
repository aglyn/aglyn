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

import { getIcon, Icon, IconKeys } from '@aglyn/shared/data/mdi'
import { _isStrT } from '@aglyn/shared/util/guards'
import MuiSvgIcon, { SvgIconProps as MuiSvgIconProps } from '@mui/material/SvgIcon'
import { createSvgIcon } from '@mui/material/utils'
import { forwardRef, useMemo } from 'react'
import { SvgPathData, svgPathElement } from './svg-path'


export { createSvgIcon }


export type IconId = IconKeys
export type Path = SvgPathData | JSX.Element

/**
 * Create a memoized component to be exported
 * @param {string} displayName
 * @param path
 * @param passProps
 */
export function createSvgPathIcon(displayName: string, path: SvgPathIconProps['path'], passProps?: SvgPathIconProps) {
  const CreateSvgPathIcon = forwardRef<any, SvgPathIconProps>(
    function RefRenderFn(props, ref) {
      return (
        <SvgPathIcon
          ref={ref}
          path={path}
          {...passProps}
          {...props}
        />
      )
    },
  )
  CreateSvgPathIcon.displayName = `CreateSvgPathIcon(${displayName})`
  return CreateSvgPathIcon
}

/**
 * Helper utility to fetch icon path data from mdi-icons module
 * @param iconId
 * @param failover
 */
export function getMdiIconPathData(iconId: IconKeys, failover?: Icon): string {
  return getIcon(iconId, failover)?.['path']
}

export interface SvgPathIconProps extends Partial<Omit<MuiSvgIconProps, 'path'>> {
  iconId?: IconKeys
  path?: Path
}

export const SvgPathIcon = forwardRef<any, SvgPathIconProps>(
  function RefRenderFn(props, ref) {
    const {iconId, path, children, ...rest} = props
    const pathElem = useMemo(() => {
      const data = iconId || !path ? getMdiIconPathData(iconId) : _isStrT(path) ? path : null
      return !_isStrT(data) ? path : svgPathElement(data as SvgPathData)
    }, [iconId, path])

    return (
      <MuiSvgIcon ref={ref} {...rest}>
        {pathElem}
        {children}
      </MuiSvgIcon>
    )
  },
)

SvgPathIcon.displayName = 'SvgPathIcon'

export default SvgPathIcon
