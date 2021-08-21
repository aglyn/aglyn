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

import { forwardRef, HTMLProps, ReactNode, useCallback, useMemo } from 'react'

import {
  createStyles,
  decomposeColor,
  recomposeColor,
  styled,
  withStyles,
  WithStyles,
} from '@material-ui/core/styles'
import Grid, { GridProps as MuiGridProps } from '@material-ui/core/Grid'
import Card from '@material-ui/core/Card'

import clsx from 'clsx'
import { VirtuosoGrid, VirtuosoGridHandle, VirtuosoGridProps } from 'react-virtuoso'


/**
 * TODO: Remove when upgraded to @material-ui/core v5+
 * Returns a number whose value is limited to the given range.
 * @param {number} value The value to be clamped
 * @param {number} min The lower boundary of the output range
 * @param {number} max The upper boundary of the output range
 * @returns {number} A number in the range [min, max]
 */
function clamp(value, min = 0, max = 1) {
  if (process.env.NODE_ENV !== 'production') {
    if (value < min || value > max) {
      console.error(`Material-UI: The value provided ${value} is out of range [${min}, ${max}].`)
    }
  }

  return Math.min(Math.max(min, value), max)
}
/**
 * TODO: Remove when upgraded to @material-ui/core v5+
 * Set the absolute transparency of a color.
 * Any existing alpha values are overwritten.
 * @param {string} color - CSS color, i.e. one of: #nnn, #nnnnnn, rgb(), rgba(), hsl(), hsla(), color()
 * @param {number} value - value to set the alpha channel to in the range 0 - 1
 * @returns {string} A CSS color string. Hex input values are returned as rgb
 */
export function alpha(color, value) {
  color = decomposeColor(color)
  value = clamp(value)

  if (color.type === 'rgb' || color.type === 'hsl') {
    color.type += 'a'
  }
  if (color.type === 'color') {
    color.values[3] = `/${value}`
  } else {
    color.values[3] = value
  }

  return recomposeColor(color)
}

const ItemWrapper = styled('div')({
  height: 0,
  position: 'relative',
  paddingTop: `${(3 / 4) * 100}%`, // 16:9
})
const ItemContent = styled(Card)({
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  textAlign: 'center',
  flexDirection: 'column',
  justifyContent: 'space-evenly',
})

export const gridListStyles = createStyles({
  root: {},
  listRoot: {},
  itemWrapper: {},
  itemContent: {},
})

export interface Item {
  id: string
  [prop: string]: any
}

/* eslint-disable-next-line */
export interface GridListProps extends Partial<VirtuosoGridProps> {
  items?: { id: string | number | symbol }[]
  renderItemContent?: (item: GridListProps['items'][number], index: number, items: GridListProps['items']) => ReactNode
  GridContainerProps?: MuiGridProps
  GridItemProps?: MuiGridProps
  ListWrapperProps?: HTMLProps<HTMLDivElement>
}

const GridListRaw = forwardRef<VirtuosoGridHandle, GridListProps & WithStyles<typeof gridListStyles>>(
  function RefRenderFn(props, ref) {
    const {
      classes,
      className,
      items,
      renderItemContent,
      ListWrapperProps,
      GridContainerProps,
      GridItemProps,
      ...rest
    } = props
    const computeItemKey = useCallback((index: number) => items[index].id as any, [items])

    const GridContainer = useMemo(() => forwardRef<any, MuiGridProps>(
      function RefRenderFn(props, ref) {
        return (
          <div {...ListWrapperProps} className={clsx(classes.listRoot, ListWrapperProps?.className)}>
            <Grid ref={ref} container {...GridContainerProps} {...props} />
          </div>
        )
      }
    ), [ListWrapperProps, GridContainerProps, classes])

    const GridItem = useMemo(() => forwardRef<any, MuiGridProps>(
      function RefRenderFn(itemProps, ref) {
        return <Grid ref={ref} item {...GridItemProps} {...itemProps} />
      }
    ), [GridItemProps])

    const MemoizedItemContent = useMemo(() => forwardRef<any, MuiGridProps>(
      function RefRenderFn(props, ref) {
        const {children, ...restProps} = props
        return (
          <ItemWrapper ref={ref} className={classes.itemWrapper} {...restProps}>
            <ItemContent className={classes.itemContent}>{children}</ItemContent>
          </ItemWrapper>
        )
      }
    ), [classes])

    const itemContent = useCallback((index) => (
      <MemoizedItemContent>
        {renderItemContent(items[index], index, items)}
      </MemoizedItemContent>
    ), [renderItemContent])

    return (
      <VirtuosoGrid
        ref={ref}
        className={clsx(classes.root, className)}
        computeItemKey={computeItemKey}
        itemContent={itemContent}
        totalCount={items.length}
        {...rest}
        components={{
          Item: GridItem,
          List: GridContainer,
          ...rest.components,
        }}
      />
    )
  },
)

GridListRaw.displayName = 'GridListRaw'
GridListRaw.defaultProps = {
  renderItemContent: (item) => item,
}

export const GridList = withStyles(gridListStyles, {name: 'GridList'})(GridListRaw)
GridList.displayName = 'GridList'

export default GridList
