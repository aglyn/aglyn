/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React, { forwardRef, useMemo, useCallback, HTMLProps, ReactNode, MouseEventHandler } from 'react'

import {
  createStyles,
  WithStyles,
  withStyles,
  styled,
  Theme,
  emphasize,
  decomposeColor,
  recomposeColor,
} from '@material-ui/core/styles'
import Grid, { GridProps as MuiGridProps } from '@material-ui/core/Grid'
import Card, { CardProps } from '@material-ui/core/Card'
import CardActionArea from '@material-ui/core/CardActionArea'
import Typography from '@material-ui/core/Typography'

import clsx from 'clsx'
import { VirtuosoGrid, VirtuosoGridProps, VirtuosoGridHandle } from 'react-virtuoso'

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

const itemStyles = (theme: Theme) =>
  createStyles({
    selected: {},
    root: {
      '&$selected $actionArea': {
        backgroundColor: theme.palette.action.selected,
        // backgroundColor: emphasize(theme.palette.action.selected, 0.12),
        // color: theme.palette.getContrastText(emphasize(theme.palette.action.selected, 0.12))
      },
    },
    actionArea: {
      height: 0,
      position: 'relative',
      paddingTop: `${(3 / 4) * 100}%`, // 16:9
    },
    wrapper: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
    },
    content: {
      width: '100%',
      height: '100%',
      display: 'flex',
      textAlign: 'center',
      flexDirection: 'column',
      justifyContent: 'space-evenly',
      padding: theme.spacing(0.5),
    },
    label: {
      ...theme.typography.subtitle2,
      lineHeight: 1.43,
      letterSpacing: theme.typography.subtitle2.letterSpacing,
      fontSize: theme.typography.pxToRem(10),
      textTransform: 'uppercase',
    },
  })

export type ItemProps = Omit<HTMLProps<HTMLDivElement>, 'onClick'> & {
  item: Item
  preview: ReactNode
  label: ReactNode
  selected?: boolean
  onActionClick?: (event: MouseEventHandler<HTMLDivElement>, item: Item) => void
}

export const CardIconListItem = withStyles(itemStyles, { name: 'IconListItem' })(
  forwardRef<any, ItemProps & WithStyles<typeof itemStyles>>(
    function RefRenderFn(props, ref) {
      const { classes, className, selected, item, label, onActionClick, preview, ...restProps } = props
      const isSelected = Boolean(selected)
      const elemClassName = clsx(classes.root, { [classes.selected]: isSelected }, className)
      const handleClick = useCallback((e) => {
        onActionClick && onActionClick(e, item)
      }, [item, onActionClick])
      return (
        <Card ref={ref as any} className={elemClassName} {...restProps}>
          <CardActionArea className={classes.actionArea} disabled={isSelected} onClick={handleClick}>
            <div className={classes.wrapper}>
              <div className={classes.content}>
                <span>{preview}</span>
                {label && (
                  <Typography className={classes.label} component="span" display="block" variant="subtitle2">
                    {label}
                  </Typography>
                )}
              </div>
            </div>
          </CardActionArea>
        </Card>
      )
    }
  )
)

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

const styles = createStyles({
  root: {},
  listRoot: {},
  itemWrapper: {},
  itemContent: {},
})

export type Item = {
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

export const GridList = withStyles(styles, { name: 'GridList' })(
  forwardRef<VirtuosoGridHandle, GridListProps & WithStyles<typeof styles>>(
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

      const GridContainer = useMemo(
        () =>
          forwardRef<any, MuiGridProps>(function RefRenderFn(props, ref) {
            return (
              <div {...ListWrapperProps} className={clsx(classes.listRoot, ListWrapperProps?.className)}>
                <Grid ref={ref} container {...GridContainerProps} {...props} />
              </div>
            )
          }),
        [ListWrapperProps, GridContainerProps, classes]
      )

      const GridItem = useMemo(
        () =>
          forwardRef<any, MuiGridProps>(function RefRenderFn(itemProps, ref) {
            return <Grid ref={ref} item {...GridItemProps} {...itemProps} />
          }),
        [GridItemProps]
      )

      const MemoizedItemContent = useMemo(
        () =>
          forwardRef<any, MuiGridProps>(function RefRenderFn(props, ref) {
            const { children, ...restProps } = props
            return (
              <ItemWrapper ref={ref} className={classes.itemWrapper} {...restProps}>
                <ItemContent className={classes.itemContent}>{children}</ItemContent>
              </ItemWrapper>
            )
          }),
        [classes]
      )

      const itemContent = useCallback(
        (index) => <MemoizedItemContent>{renderItemContent(items[index], index, items)}</MemoizedItemContent>,
        [renderItemContent]
      )

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
    }
  )
)

GridList.displayName = 'GridList'
GridList.defaultProps = {
  renderItemContent: (item) => item
}

export default GridList
