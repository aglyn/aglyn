/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn'
import type { AglynNodePresetSchema } from '@aglyn/aglyn'
import {
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { GridList, type GridListProps, Menu } from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { arrayFromLength } from '@aglyn/shared-util-tools'
import { Box, Button, ButtonBase, Tooltip, Typography } from '@mui/material'
import {
  forwardRef,
  type MouseEvent,
  useCallback,
  useMemo,
  useState,
} from 'react'
import ElementCardComponent from './element-card.component'

const endIcon = (value: number, active: number) =>
  value !== active
    ? undefined
    : {
        path: ICON_VARIANT_SYMBOL_CONFIRMED.path,
      }

export interface ComponentsGridListProps extends Partial<GridListProps> {
  items?: AglynNodePresetSchema[]
  onActionClick?: {
    bivarianceHack<T>(
      event: null | MouseEvent<T>,
      data: { type: string; data: AglynNodePresetSchema },
    ): void
  }['bivarianceHack']
  maxColumns?: number
}

export const ComponentsGridListComponent = forwardRef<
  any,
  ComponentsGridListProps
>((props, ref) => {
  const { onActionClick, items = [], sx, maxColumns = 4, ...rest } = props

  const [columns, setColumns] = useState(maxColumns)
  const handleColumnChange = useCallback(
    (columns: number) => (e) => {
      setColumns(columns)
    },
    [],
  )
  const handleOnActionClick = useCallback(
    (e, item) => {
      onActionClick?.call(null, e, { type: 'selection', data: item?.data })
    },
    [onActionClick],
  )

  const columnOptions = useMemo(() => {
    return arrayFromLength(maxColumns).map((_, index) => ({
      value: index + 1,
      children: `${index + 1} columns`,
      onClick: handleColumnChange(index + 1),
      endIcon: endIcon(index + 1, columns),
      selected: columns === index + 1,
    }))
  }, [handleColumnChange, columns, maxColumns])

  const renderItemContent = useCallback(
    (item: Aglyn.PresetSchema<any>) => {
      return (
        <ElementCardComponent
          component={ButtonBase}
          onClick={(e) => handleOnActionClick(e, item)}
          label={
            // Component cards show name + short description (AGL-93
            // drawer polish, per the component-builder mockup).
            (item as any)?.description ? (
              <>
                {item?.label}
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ lineHeight: 1.25, mt: 0.25 }}
                >
                  {(item as any).description}
                </Typography>
              </>
            ) : (
              item?.label
            )
          }
          icon={item?.icon as any}
          item={{ id: item?.$id, ...item } as any}
        />
      )
    },
    [handleOnActionClick],
  )

  return (
    <GridList
      ref={ref}
      GridContainerProps={{
        spacing: 1,
        children: (
          <Box sx={{ mb: 2 }}>
            <Menu
              id="aglyn:component-drawer-columns-changer"
              items={columnOptions}
              // MenuProps={{variant: 'selectedMenu'}}
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              <Tooltip title={'Columns'}>
                <Button
                  aria-label="columns"
                  aria-haspopup="menu"
                  aria-controls={'aglyn:component-drawer-columns-changer'}
                  endIcon={
                    <MdiIcon
                      fontSize="inherit"
                      path={ICON_VARIANT_MENU_DOWN.path}
                    />
                  }
                  sx={{
                    borderColor: 'divider',
                    '& .MuiButton-endIcon': { ml: 0.15 },
                    '& .MuiButton-startIcon': { mr: 0.85 },
                  }}
                >
                  {columns} Columns
                </Button>
              </Tooltip>
            </Menu>
          </Box>
        ),
      }}
      GridItemProps={{
        size: {
          xs: 6,
          sm: Math.floor(12 / columns),
        },
      }}
      renderItemContent={renderItemContent}
      items={items}
      sx={mergeSxProps(
        {
          overflowX: 'hidden',
          '& .AglynGridList-itemContent': {
            width: '100%',
            height: '100%',
            display: 'flex',
            textAlign: 'center',
            flexDirection: 'column',
            justifyContent: 'space-evenly',
          },
        },
        sx,
      )}
      {...rest}
    />
  )
})

ComponentsGridListComponent.displayName = 'ComponentsGridListComponent'
ComponentsGridListComponent.aglyn = true

export default ComponentsGridListComponent
