/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import {
  generateComponentClassKeys,
  mergeSxProps,
  styled,
  type SxProps,
} from '@aglyn/shared-ui-theme'
import {
  Box,
  type BoxProps,
  Card,
  Grid,
  type GridProps as MuiGridProps,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef, useCallback, useMemo } from 'react'
import {
  VirtuosoGrid,
  type VirtuosoGridHandle,
  type VirtuosoGridProps,
} from 'react-virtuoso'
import Container, { type ContainerProps } from './container'

const classKey = generateComponentClassKeys('AglynGridList', [
  'itemWrapper',
  'itemContent',
  'gridContainer',
  'gridItem',
])

const ItemWrapper = styled(
  forwardRef<any, BoxProps>((props, ref) => {
    const { children, className, sx, ...rest } = props
    return (
      <Box
        ref={ref}
        className={clsx(classKey.itemWrapper, className)}
        sx={mergeSxProps(
          {
            height: 0,
            position: 'relative',
            paddingTop: `${(3 / 4) * 100}%`, // 4:3
          },
          sx,
        )}
        {...rest}
      >
        <Card
          className={classKey.itemContent}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            textAlign: 'center',
            flexDirection: 'column',
            justifyContent: 'space-evenly',
          }}
        >
          {children}
        </Card>
      </Box>
    )
  }),
  {
    name: 'AglynItemWrapper',
  },
)({})

export type VirtualizedGridProps = VirtuosoGridProps<any> & {
  sx?: SxProps
  as?: any
}
const VirtualizedGrid = styled(VirtuosoGrid, {
  name: 'AglynVirtualizedGrid',
})<VirtualizedGridProps>({})

export type GridListItemData<P = any> = { id: MapKey } & P

/* eslint-disable-next-line */
export interface GridListProps extends Partial<VirtualizedGridProps> {
  items?: GridListItemData[]
  renderItemContent?: (
    item: GridListProps['items'][number],
    index: number,
    items: GridListProps['items'],
  ) => JSX.Node
  GridContainerProps?: MuiGridProps
  GridItemProps?: MuiGridProps
  ListWrapperProps?: ContainerProps
  sx?: SxProps
}

export const GridList = forwardRef<VirtuosoGridHandle, GridListProps>(
  function RefRenderFn(props, ref) {
    const {
      items = [],
      renderItemContent = (item) => item,
      ListWrapperProps = {},
      GridContainerProps = {},
      GridItemProps = {},
      components,
      ...rest
    } = props

    const computeItemKey = useCallback(
      (index: number) => {
        const item = items[index]
        return item?.key ?? item?.id ?? items.indexOf(item)
      },
      [items],
    )

    const GridContainer = useMemo(
      () =>
        forwardRef<any, MuiGridProps>(function RefRenderFn(
          { className, ...props },
          ref,
        ) {
          const {
            className: gridClassName,
            children,
            ...restGridProps
          } = GridContainerProps
          return (
            <Container gutterY {...ListWrapperProps}>
              {children}
              <Grid
                ref={ref}
                className={clsx(
                  classKey.gridContainer,
                  gridClassName,
                  className,
                )}
                container
                {...restGridProps}
                {...props}
              />
            </Container>
          )
        }),
      [ListWrapperProps, GridContainerProps],
    )

    const GridItem = useMemo(() => {
      const Component = forwardRef<any, MuiGridProps>(
        function RefRenderFn(itemProps, ref) {
          const { className: gridClassName, ...restGridProps } = GridItemProps
          const { className, ...rest } = itemProps
          return (<Grid ref={ref} className={clsx(classKey.gridItem, gridClassName, className)} />);
        },
      )
      Component.displayName = 'Component'
      Component.aglyn = true
      return Component
    }, [GridItemProps])

    const handleItemContent = useCallback(
      (index: number) => {
        return (
          <ItemWrapper>
            {renderItemContent(items[index], index, items)}
          </ItemWrapper>
        )
      },
      [items, renderItemContent],
    )

    return (
      <VirtualizedGrid
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
  },
)

GridList.displayName = 'GridList'
GridList.aglyn = true

export default GridList
