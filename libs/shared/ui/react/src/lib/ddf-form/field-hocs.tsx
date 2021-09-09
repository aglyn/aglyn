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

import { styled } from '@aglyn/shared/ui/themes'
import { getDisplayName } from '@aglyn/shared/util/tools'
import MuiGrid, { GridProps as MuiGridProps } from '@mui/material/Grid'
import {
  ComponentType,
  forwardRef,
  ForwardRefExoticComponent,
  PropsWithoutRef,
  RefAttributes,
} from 'react'


const FieldGridItem = styled(MuiGrid)({position: 'relative'}, {name: 'FieldGridItem'})

export type WithGridItemProps = {
  FormFieldGridProps?: MuiGridProps
}

export function withGridItem<P>(WrappedComponent: ComponentType<P>): ForwardRefExoticComponent<PropsWithoutRef<P & WithGridItemProps> & RefAttributes<any>> {
  const WithFieldGrid = forwardRef<any, P & WithGridItemProps>(
    function RefRenderFn(props, ref) {
      const {FormFieldGridProps, ...rest} = props

      return (
        <FieldGridItem ref={ref} xs={12} item {...FormFieldGridProps}>
          <WrappedComponent {...rest as P}/>
        </FieldGridItem>
      )
    },
  )
  WithFieldGrid.displayName = `WithFieldGrid(${getDisplayName(WrappedComponent)})`
  return WithFieldGrid
}
