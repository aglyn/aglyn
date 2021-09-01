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

import MuiGrid, { GridProps as MuiGridProps } from '@material-ui/core/Grid'
import React, { forwardRef } from 'react'

/* eslint-disable-next-line */
export interface GridItemsProps extends MuiGridProps {
  items: MuiGridProps[]
}

export const GridItems = forwardRef<any, GridItemsProps>(
  function RefRenderFn(props, ref) {
    const {items, ...rest} = props

    return (
      <MuiGrid ref={ref} container {...rest}>
        {items.map((item, key) => (
          <MuiGrid key={item?.id ?? item?.key ?? key} item {...item} />
        ))}
      </MuiGrid>
    )
  },
)

GridItems.displayName = 'GridItems'
GridItems.defaultProps = {
  items: [],
}

export default GridItems
