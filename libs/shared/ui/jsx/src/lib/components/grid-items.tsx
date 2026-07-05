/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { Grid, type GridProps } from '@mui/material'
import { forwardRef } from 'react'

/* eslint-disable-next-line */
export interface GridItemsProps
  extends GridProps,
    ReplaceKey<JSX.OverrideableComponentProps, 'component', 'itemComponent'> {
  items: GridProps[]
}

export const GridItems = forwardRef<any, GridItemsProps>((props, ref) => {
  const { items = [], itemComponent: ItemComponent = Grid, ...rest } = props

  return (
    <Grid ref={ref} container {...rest}>
      {items.map(({ key: itemKey, id, ...item }: GridProps & { id?: unknown }, index: number) => (
        <ItemComponent key={itemKey ?? id ?? index} {...item} />
      ))}
    </Grid>
  )
})

GridItems.displayName = 'GridItems'
GridItems.aglyn = true

export default GridItems
