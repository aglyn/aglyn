/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'

import MuiSvgIcon, { SvgIconProps as MuiSvgIconProps } from '@material-ui/core/SvgIcon'

import { getIcon, IconKeys } from '@aglyn/shared/data/mdi'

import { SvgPathData, svgPathElement } from '../svg-path/svg-path'
import { _isStr } from '@aglyn/shared/util/helpers'

export type IconId = IconKeys
export type Path = SvgPathData | React.ReactElement

/* eslint-disable-next-line */
export interface SvgPathIconProps extends MuiSvgIconProps {
  iconId?: IconKeys
  path?: Path
}

export const SvgPathIcon = React.forwardRef<any, SvgPathIconProps>(function RefRenderFn(props, ref) {
  const { iconId, path, children, ...rest } = props
  const pathElem = React.useMemo(() => {
    const data = iconId || !path ? getMdiIconPathData(iconId) : _isStr(path) ? path : null
    return !_isStr(data) ? path : svgPathElement(data as SvgPathData)
  }, [iconId, path])

  return (
    <MuiSvgIcon ref={ref} {...rest}>
      {pathElem}
      {children}
    </MuiSvgIcon>
  )
})

SvgPathIcon.displayName = 'SvgPathIcon'

export default SvgPathIcon

export function createSvgPathIcon(displayName: string, path: SvgPathIconProps['path'], passProps?: SvgPathIconProps) {
  const CreateSvgPathIcon = React.forwardRef<any, SvgPathIconProps>(function RefRenderFn(props, ref) {
    return <SvgPathIcon ref={ref} path={path} {...passProps} {...props} />
  })
  CreateSvgPathIcon.displayName = `CreateSvgPathIcon(${displayName})`
  return React.memo(CreateSvgPathIcon)
}

export function svgPathIcon(iconId: IconKeys)
export function svgPathIcon(props: SvgPathIconProps)
export function svgPathIcon(propsOrId: SvgPathIconProps | IconKeys) {
  const passProps = _isStr(propsOrId) ? { iconId: propsOrId } : propsOrId
  return createSvgPathIcon(`SvgPathIconWithId(${passProps.iconId})`, null, passProps)
}

/**
 * Helper utility to fetch icon path data from mdi-icons module
 * @param iconId
 */
export function getMdiIconPathData(iconId: IconKeys, failover?: any): string | null {
  return getIcon(iconId, failover)?.path
}
export function useMdiIconPathData(iconId: IconKeys): string | null {
  const data = getMdiIconPathData(iconId)
  return React.useMemo(() => data, [data])
}
