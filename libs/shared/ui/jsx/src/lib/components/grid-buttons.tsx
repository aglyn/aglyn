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

import type { GridProps as MuiGridProps } from '@mui/material'
import { Button, ButtonProps as MuiButtonProps } from '@mui/material'
import { type ElementType, forwardRef } from 'react'
import GridItems from './grid-items'

/* eslint-disable-next-line */
export interface GridButtonsProps<P = MuiButtonProps> extends MuiGridProps {
  items: (P & { GridItemProps?: MuiGridProps })[]
  ItemComponent?: ElementType<P>
}

export const GridButtons = forwardRef<any, GridButtonsProps<any>>(
  (props, ref) => {
    const { items, ItemComponent = Button, ...rest } = props
    return (
      <GridItems
        ref={ref}
        items={items.map(({ GridItemProps, ...item }) => ({
          children: <ItemComponent {...item} />,
          ...GridItemProps,
        }))}
        {...rest}
      />
    )
  },
)

GridButtons.displayName = 'GridButtons'
GridButtons.aglyn = true
GridButtons.defaultProps = {
  items: [],
  ItemComponent: Button,
}

export default GridButtons
