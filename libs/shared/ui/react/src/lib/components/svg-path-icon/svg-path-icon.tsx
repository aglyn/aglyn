/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { forwardRef, useMemo, memo } from 'react'
import MuiSvgIcon, { SvgIconProps as MuiSvgIconProps } from '@material-ui/core/SvgIcon'
import { getIcon, Icon, IconKeys } from '@aglyn/shared/data/mdi'
import { _isStr } from '@aglyn/shared/util/helpers'
import { SvgPathData, svgPathElement } from './svg-path'


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
    }
  )
  CreateSvgPathIcon.displayName = `CreateSvgPathIcon(${displayName})`
  return memo(CreateSvgPathIcon)
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

const SvgPathIcon = forwardRef<any, SvgPathIconProps>(
  function RefRenderFn(props, ref) {
    const {iconId, path, children, ...rest} = props
    const pathElem = useMemo(() => {
      const data = iconId || !path ? getMdiIconPathData(iconId) : _isStr(path) ? path : null
      return !_isStr(data) ? path : svgPathElement(data as SvgPathData)
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
