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

import { Typography, type TypographyProps } from '@mui/material'
import { type ElementType, forwardRef } from 'react'
import EllipsisPulseComponent from './ellipsis-pulse.component'

export type LoadingTextProps<C extends ElementType> = TypographyProps<
  C,
  { component?: C }
> & {}

const LoadingTextComponent = forwardRef(function RefRenderFn<
  C extends ElementType,
>(props: LoadingTextProps<C>, ref) {
  const { children, ...rest } = props

  return (
    <Typography ref={ref} {...rest}>
      {children}
      <EllipsisPulseComponent />
    </Typography>
  )
})
LoadingTextComponent.displayName = 'LoadingTextComponent'
LoadingTextComponent.aglyn = true
LoadingTextComponent.defaultProps = {}

export { LoadingTextComponent }
export default LoadingTextComponent
