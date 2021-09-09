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

import { generateUtilityClasses, styled } from '@aglyn/shared/ui/themes'
import Card from '@mui/material/Card'
import Grid, { GridProps as MuiGridProps } from '@mui/material/Grid'
import clsx from 'clsx'
import { forwardRef, HTMLAttributes, HTMLProps, ReactNode, useCallback, useMemo } from 'react'
import { VirtuosoGrid, VirtuosoGridHandle, VirtuosoGridProps } from 'react-virtuoso'


const classKey = generateUtilityClasses('AglynGridList', [
  'itemWrapper',
  'itemContent',
  'gridContainer',
  'gridItem',
])

const ItemWrapper = styled('div', {
  name: 'ItemWrapper',
})({
  height: 0,
  position: 'relative',
  paddingTop: `${(3 / 4) * 100}%`, // 16:9
})
const ItemContent = styled(Card, {
  name: 'ItemContent',
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

export interface Item {
  id: string | number | symbol
  [prop: string]: any
}

/* eslint-disable-next-line */
export interface GridListProps extends Partial<VirtuosoGridProps> {
  items?: Item[]
  renderItemContent?: (item: GridListProps['items'][number], index: number, items: GridListProps['items']) => ReactNode
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
      ...rest
    } = props
    const computeItemKey = useCallback((index: number) => items[index].id as any, [items])

    const GridContainer = useMemo(() => forwardRef<any, MuiGridProps>(
      function RefRenderFn(props, ref) {
        const {className: gridClassName, ...restGridProps} = GridContainerProps
        const {className, ...rest} = props
        const elemClassName = clsx(classKey.gridContainer, gridClassName, className)
        return (
          <div {...ListWrapperProps}>
            <Grid
              ref={ref}
              container
              className={elemClassName}
              {...restGridProps}
              {...rest}
            />
          </div>
        )
      },
    ), [ListWrapperProps, GridContainerProps])

    const GridItem = useMemo(() => {
      const Component = forwardRef<any, MuiGridProps>(
        function RefRenderFn(itemProps, ref) {
          const {className: gridClassName, ...restGridProps} = GridItemProps
          const {className, ...rest} = itemProps
          const elemClassName = clsx(classKey.gridItem, gridClassName, className)
          return (
            <Grid
              ref={ref}
              item
              className={elemClassName}
              {...restGridProps}
              {...rest}
            />
          )
        },
      )
      Component.displayName = 'GridItem'
      return Component
    }, [GridItemProps])

    const MemoizedItemContent = useMemo(() => {
      const Component = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
        function RefRenderFn(props, ref) {
          const {children, className, ...rest} = props
          const elemClassName = clsx(classKey.itemWrapper, className)
          return (
            <ItemWrapper ref={ref} className={elemClassName} {...rest}>
              <ItemContent className={classKey.itemContent}>
                {children}
              </ItemContent>
            </ItemWrapper>
          )
        },
      )
      Component.displayName = 'MemoizedItemContent'
      return Component
    }, [classKey])

    const itemContent = useCallback((index) => (
      <MemoizedItemContent>
        {renderItemContent(items[index], index, items)}
      </MemoizedItemContent>
    ), [renderItemContent])

    return (
      <VirtuosoGrid
        ref={ref}
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

GridList.displayName = 'GridList'
GridList.defaultProps = {
  renderItemContent: (item) => item,
}

export default GridList
