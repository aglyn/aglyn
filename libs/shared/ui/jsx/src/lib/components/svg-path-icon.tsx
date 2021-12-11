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

import { GetIconDataOptions, getIconPathData, IconId as MdiIconId } from '@aglyn/shared-data-mdi'
import { _isArr, _isStrT } from '@aglyn/shared-util-guards'
import MuiSvgIcon, { SvgIconProps as MuiSvgIconProps } from '@mui/material/SvgIcon'
import { createSvgIcon } from '@mui/material/utils'
import { forwardRef, useMemo } from 'react'
import { SvgPath, SvgPathData } from './svg-path'


export { createSvgIcon }

export type IconId = MdiIconId
export type Path = SvgPathData | JSX.Element

/**
 * Create a memoized component to be exported
 * @param {string} displayName
 * @param path
 * @param passProps
 */
export function createSvgPathIcon(
  displayName: string,
  path: SvgPathIconProps['paths'],
  passProps?: SvgPathIconProps,
) {

  const CreateSvgPathIcon = forwardRef<any, SvgPathIconProps>(function RefRenderFn(props, ref) {
    return <SvgPathIcon ref={ref} paths={path} {...passProps} {...props} />
  })
  CreateSvgPathIcon.displayName = `CreateSvgPathIcon(${displayName})`
  return CreateSvgPathIcon
}

export interface SvgPathIconProps extends Partial<Omit<MuiSvgIconProps, 'path'>> {
  iconIds?: IconId | (IconId[])
  paths?: Path | (Path[])
  mdiIconOptions?: GetIconDataOptions
}

export const SvgPathIcon = forwardRef<any, SvgPathIconProps>(function RefRenderFn(props, ref) {
  const {iconIds, paths: pathsProp, children, mdiIconOptions, ...rest} = props

  const iconIdsPaths = useMemo(() => {
    const iconIdArray: IconId[] = _isStrT(iconIds) || _isArr(iconIds)
      ? _isStrT(iconIds) ? [iconIds] : iconIds
      : null
    return (iconIdArray || (!pathsProp && !children))
      ? getIconPathData(iconIdArray ?? [null], mdiIconOptions).map((iconPath, index) => (
        <SvgPath key={index} d={iconPath as string} />
      ))
      : null
  }, [iconIds, pathsProp, mdiIconOptions])

  const pathsPaths = useMemo(() => {
    const pathsArray = _isStrT(pathsProp) || _isArr(pathsProp)
      ? _isStrT(pathsProp) ? [pathsProp] : pathsProp
      : null
    return pathsArray ? pathsArray.map((elementOrPathData, index) => (
      _isStrT(elementOrPathData)
        ? <SvgPath key={index} d={elementOrPathData} />
        : elementOrPathData
    )) : null
  }, [pathsProp])

  return (
    <MuiSvgIcon ref={ref} {...rest}>
      {iconIdsPaths}
      {pathsPaths}
      {children}
    </MuiSvgIcon>
  )
})

SvgPathIcon.displayName = 'SvgPathIcon'

export default SvgPathIcon
