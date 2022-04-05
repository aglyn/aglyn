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

import {BRAND, CURRENT_YEAR} from '@aglyn/shared-data-enums'
import {Typography, type TypographyProps} from '@mui/material'
import {forwardRef} from 'react'


export interface CopyrightProps extends TypographyProps<any, any> {}

const CopyrightComponent = forwardRef<any, CopyrightProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props
    return (
      <Typography
        ref={ref}
        variant="subtitle2"
        {...rest}
      >
        {CURRENT_YEAR} &copy; {BRAND.ORG_NAME_LEGAL}
        {children}
      </Typography>
    )
  },
)
CopyrightComponent.displayName = 'CopyrightComponent'
CopyrightComponent.aglyn = true

export {CopyrightComponent}
export default CopyrightComponent
