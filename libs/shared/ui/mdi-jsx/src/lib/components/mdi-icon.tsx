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

import {DEFAULT_ICON} from '@aglyn/shared-data-mdi'
import MuiSvgIcon, {type SvgIconProps as MuiSvgIconProps} from '@mui/material/SvgIcon'
import {forwardRef, type SVGAttributes} from 'react'


export interface MdiIconProps extends MuiSvgIconProps {
  path?: string
  PathProps?: SVGAttributes<SVGPathElement>
}

const MdiIcon = forwardRef<any, MdiIconProps>(
  function RefRenderFn(props, ref) {
    const {path, children, PathProps, ...rest} = props

    return (
      <MuiSvgIcon ref={ref} {...rest}>
        {children ? children : (
          <path d={path || DEFAULT_ICON.path} {...PathProps} />
        )}
      </MuiSvgIcon>
    )
  },
)

MdiIcon.displayName = 'MdiIcon'
MdiIcon.aglyn = true

export {MdiIcon}
export default MdiIcon
