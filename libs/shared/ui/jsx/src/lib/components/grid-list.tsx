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

import { AnyProps, EmptyObj, MapKey, PKey } from '@aglyn/shared-data-types'
import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import Card from '@mui/material/Card'
import Grid, { GridProps as MuiGridProps } from '@mui/material/Grid'
import clsx from 'clsx'
import { forwardRef, HTMLAttributes, HTMLProps, memo, ReactNode, useCallback, useMemo } from 'react'
import { VirtuosoGrid, VirtuosoGridHandle, VirtuosoGridProps } from 'react-virtuoso'


const classKey = generateComponentClassKeys('AglynGridList', [
  'itemWrapper',
  'itemContent',
  'gridContainer',
  'gridItem',
])

const ItemContent = styled(Card, {
  name: 'AglynGridListItemContent',
})({
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
const ItemDisplacement = styled('div', {
  name: 'AglynGridListItemDisplacement',
})({
  height: 0,
  position: 'relative',
  paddingTop: `${(3 / 4) * 100}%`, // 4:3
})
const ItemWrapper = styled(forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function RefRenderFn(props, ref) {
    const {children, className, ...rest} = props
    return (
      <ItemDisplacement ref={ref} className={clsx(classKey.itemWrapper, className)} {...rest}>
        <ItemContent className={classKey.itemContent}>
          {children}
        </ItemContent>
      </ItemDisplacement>
    )
  },
), {
  name: 'AglynItemWrapper',
})({})

export type GridListItemData<P = any> = { id: MapKey } & P

/* eslint-disable-next-line */
export interface GridListProps extends Partial<VirtuosoGridProps> {
  items?: GridListItemData[]
  renderItemContent?: (
    item: GridListProps['items'][number],
    index: number,
    items: GridListProps['items'],
  ) => ReactNode
  GridContainerProps?: MuiGridProps
  GridItemProps?: MuiGridProps
  ListWrapperProps?: HTMLProps<HTMLDivElement>
}

export const GridList = forwardRef<VirtuosoGridHandle, GridListProps>(
  function RefRenderFn(props, ref) {
    const {
      items,
      renderItemContent,
      ListWrapperProps,
      GridContainerProps,
      GridItemProps,
      components,
      ...rest
    } = props

    const computeItemKey = useCallback((index: number) => {
      return items[index].id
    }, [items])

    const GridContainer = useMemo(() => forwardRef<any, MuiGridProps>(
      function RefRenderFn({className, ...props}, ref) {
        const {className: gridClassName, ...restGridProps} = GridContainerProps
        return (
          <div {...ListWrapperProps}>
            <Grid
              ref={ref}
              className={clsx(classKey.gridContainer, gridClassName, className)}
              container
              {...restGridProps}
              {...props}
            />
          </div>
        )
      }
    ), [ListWrapperProps, GridContainerProps])

    const GridItem = useMemo(() => {
      const Component = forwardRef<any, MuiGridProps>(
        function RefRenderFn(itemProps, ref) {
          const {className: gridClassName, ...restGridProps} = GridItemProps
          const {className, ...rest} = itemProps
          return (
            <Grid
              ref={ref}
              className={clsx(classKey.gridItem, gridClassName, className)}
              item
              {...restGridProps}
              {...rest}
            />
          )
        }
      )
      Component.displayName = 'GridItem'
      return Component
    }, [GridItemProps])

    const handleItemContent = useCallback((index) => {
      return (
        <ItemWrapper>
          {renderItemContent(items[index], index, items)}
        </ItemWrapper>
      )
    }, [items, renderItemContent])

    return (
      <VirtuosoGrid
        ref={ref}
        computeItemKey={computeItemKey}
        itemContent={handleItemContent}
        totalCount={items.length}
        components={{
          Item: GridItem,
          List: GridContainer,
          ...components,
        }}
        {...rest}
      />
    )
  }
)

GridList.displayName = 'GridList'
GridList.defaultProps = {
  renderItemContent: (item) => item,
}

export default GridList
