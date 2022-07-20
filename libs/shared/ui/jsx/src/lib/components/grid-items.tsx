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

import type { ReplaceKey } from '@aglyn/shared-data-types'
import { Grid as MuiGrid, type GridProps as MuiGridProps } from '@mui/material'
import { forwardRef } from 'react'

/* eslint-disable-next-line */
export interface GridItemsProps
  extends MuiGridProps,
    ReplaceKey<JSX.OverrideableComponentProps, 'component', 'itemComponent'> {
  items: MuiGridProps[]
}

export const GridItems = forwardRef<any, GridItemsProps>((props, ref) => {
  const { items, itemComponent: ItemComponent, ...rest } = props

  return (
    <MuiGrid ref={ref} container {...rest}>
      {items.map((item, key) => (
        <ItemComponent item key={item?.key ?? item?.id ?? key} {...item} />
      ))}
    </MuiGrid>
  )
})

GridItems.displayName = 'GridItems'
GridItems.aglyn = true
GridItems.defaultProps = {
  items: [],
  itemComponent: MuiGrid,
}

export default GridItems
