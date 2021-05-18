/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React, { forwardRef } from 'react'
import Button, { ButtonProps as MuiButtonProps } from '@material-ui/core/Button'
import GridItems, { GridItemsProps } from '../grid-items/grid-items'

export type ButtonItem = MuiButtonProps & {
  GridItemProps: GridItemsProps['items'][number]
}

/* eslint-disable-next-line */
export interface GridButtonsProps extends Omit<GridItemsProps, 'items'> {
  items: ButtonItem[]
}

export const GridButtons = forwardRef<any, GridButtonsProps>(
  function RefRenderFn(props, ref) {
    const { items, ...rest } = props
    return (
      <GridItems
        ref={ref}
        items={items.map(({ GridItemProps, ...item }) => ({
          children: <Button {...item} />,
          ...GridItemProps,
        }))}
        {...rest}
      />
    )
  }
)

GridButtons.displayName = 'GridButtons'
GridButtons.defaultProps = {
  items: [],
}

export default GridButtons
