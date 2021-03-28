import React, {forwardRef} from 'react'
import MuiGrid, { GridProps as MuiGridProps } from '@material-ui/core/Grid'

/* eslint-disable-next-line */
export interface GridItemsProps extends MuiGridProps {
  items: MuiGridProps[]
}

export const GridItems = forwardRef<any, GridItemsProps>(
  function RefRenderFn(props, ref) {
    const { items, ...rest } = props

    return (
      <MuiGrid ref={ref} container {...rest}>
        {items.map((item, key) => (
          <MuiGrid key={key} item {...item} />
        ))}
      </MuiGrid>
    )
  }
)

GridItems.displayName = 'GridItems'
GridItems.defaultProps = {
  items: []
}

export default GridItems
