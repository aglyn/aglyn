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

import { forwardRef, MouseEvent, ReactNode, useCallback } from 'react'
import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import Card, { CardProps as MuiCardProps } from '@material-ui/core/Card'
import CardActionArea from '@material-ui/core/CardActionArea'
import Typography from '@material-ui/core/Typography'
import { Item } from './grid-list'


export const cardIconListItemStyles = (theme: Theme) => createStyles({
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

export interface CardIconListItemProps extends Partial<Omit<MuiCardProps, 'classes'>> {
  item: Item
  preview: ReactNode
  label: ReactNode
  selected?: boolean
  onActionClick?: {
    bivarianceHack<T>(event: MouseEvent<T>, selection: unknown): void;
  }['bivarianceHack']
}

const CardIconListItem = forwardRef<any, CardIconListItemProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const {
      classes,
      className,
      selected,
      item,
      label,
      onActionClick,
      preview,
      ...restProps
    } = props
    const isSelected = Boolean(selected)
    const elemClassName = clsx(classes.root, {
      [classes.selected]: isSelected
    }, className)
    const handleClick = useCallback((e) => {
      onActionClick && onActionClick(e, item)
    }, [item, onActionClick])
    return (
      <Card ref={ref} className={elemClassName} {...restProps}>
        <CardActionArea
          className={classes.actionArea}
          disabled={isSelected}
          onClick={handleClick}
        >
          <div className={classes.wrapper}>
            <div className={classes.content}>
              <span>{preview}</span>
              {label && (
                <Typography
                  className={classes.label}
                  component="span"
                  display="block"
                  variant="subtitle2"
                >
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

CardIconListItem.displayName = 'CardIconListItem'
CardIconListItem.defaultProps = {}

export default withStyles(cardIconListItemStyles, {name: 'CardIconListItem'})(CardIconListItem)
