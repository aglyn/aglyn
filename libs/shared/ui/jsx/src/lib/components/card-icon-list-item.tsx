/**
 * @license
 * Copyright 2022 Aglyn LLC
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
} from '@aglyn/shared-ui-theme'
import {
  Box,
  Card,
  CardActionArea,
  type CardProps as MuiCardProps,
  Typography,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef, type MouseEvent, useCallback } from 'react'
import type { GridListItemData } from './grid-list'

const cardClasses = generateComponentClassKeys('AglynCardIconListItem', [
  'actionArea',
  'selected',
  'content',
  'wrapper',
])

export interface CardIconListItemProps extends Partial<MuiCardProps> {
  item: GridListItemData
  preview?: JSX.Node
  label?: JSX.Node
  selected?: boolean
  onActionClick?: {
    bivarianceHack<T>(event: MouseEvent<T>, selection: unknown): void
  }['bivarianceHack']
}

export const CardIconListItem = forwardRef<any, CardIconListItemProps>(
  function RefRenderFn(props, ref) {
    const {
      className,
      children,
      selected,
      item,
      label,
      onActionClick,
      preview,
      sx,
      ...rest
    } = props
    const isSelected = Boolean(selected)
    const handleClick = useCallback(
      (e) => {
        onActionClick && onActionClick(e, item)
      },
      [item, onActionClick],
    )
    return (
      <Card
        ref={ref}
        className={clsx(
          {
            [cardClasses.selected]: isSelected,
          },
          className,
        )}
        sx={mergeSxProps(
          {
            [`&.${cardClasses.selected}`]: {
              [`& .${cardClasses.actionArea}`]: {
                backgroundColor: 'secondary.main',
                color: 'secondary.contrastText',
              },
            },
          },
          sx,
        )}
        {...rest}
      >
        <CardActionArea
          disabled={isSelected}
          onClick={handleClick}
          className={cardClasses.actionArea}
          sx={{
            height: 0,
            position: 'relative',
            paddingTop: `${(3 / 4) * 100}%`, // 16:9
          }}
        >
          <Box
            className={cardClasses.wrapper}
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
            }}
          >
            <Box
              className={cardClasses.content}
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                textAlign: 'center',
                flexDirection: 'column',
                justifyContent: 'space-evenly',
                padding: 0.5,
              }}
            >
              <span>
                {children}
                {preview}
              </span>
              {label && (
                <Typography
                  component="span"
                  display="block"
                  variant="subtitle2"
                  sx={{
                    lineHeight: 1.43,
                    fontSize: (theme) => theme.typography.pxToRem(10),
                    textTransform: 'uppercase',
                  }}
                >
                  {label}
                </Typography>
              )}
            </Box>
          </Box>
        </CardActionArea>
      </Card>
    )
  },
)

CardIconListItem.displayName = 'CardIconListItem'
CardIconListItem.aglyn = true
CardIconListItem.defaultProps = {}

export default CardIconListItem
