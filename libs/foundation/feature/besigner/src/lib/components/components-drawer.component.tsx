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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import type { AnyProps } from '@aglyn/shared-data-types'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  NavigationDrawerComponent,
  type NavigationDrawerProps,
  SrOnlyComponent,
} from '@aglyn/shared-ui-jsx'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { Button, IconButton, Typography } from '@mui/material'
import { forwardRef, type MouseEvent, useCallback, useState } from 'react'
import type { ElementDrawerOptions } from '../contexts/element-drawer-context'
import ComponentsGridListComponent, {
  type ComponentsGridListProps,
} from './components-grid-list.component'

export interface ComponentsDrawerOptionsProps extends ElementDrawerOptions {
  type?: 'browse-site-components' | 'edit-element-traits'
  formSchema?: FormSchema
  selectedElementProps?: AnyProps
}

export interface ComponentsDrawerProps extends Partial<NavigationDrawerProps> {
  options?: ComponentsDrawerOptionsProps
  items?: ComponentsGridListProps['items']
  onItemSelect?: ComponentsGridListProps['onItemSelect']
  onDelete?: { bivarianceHack<T>(event: MouseEvent<T>, data: unknown): void }['bivarianceHack']
  onClose?: {
    bivarianceHack(
      event: any,
      reason: 'backdropClick' | 'escapeKeyDown' | 'cancelIconClick' | 'cancelButtonClick'
    ): void
  }['bivarianceHack']
}

const ComponentsDrawerComponent = forwardRef<any, ComponentsDrawerProps>(function RefRenderFn(
  props,
  ref
) {
  const { options, onItemSelect, onClose, onDelete, items, sx, ...rest } = props

  const { title } = { ...options }
  const [columns, setColumns] = useState(4)
  const handleColumnChange = useCallback(
    (columns: number) => (e) => {
      setColumns(columns)
    },
    []
  )
  const handleDrawerClose = useCallback(
    (e, reason) => {
      onClose?.call(null, e, reason)
    },
    [onClose]
  )
  const handleDrawerCancelButton = useCallback(
    (e) => {
      handleDrawerClose.call(null, e, 'cancelButtonClick')
    },
    [handleDrawerClose]
  )
  const handleDrawerCancelIcon = useCallback(
    (e) => {
      handleDrawerClose.call(null, e, 'cancelIconClick')
    },
    [handleDrawerClose]
  )
  const handleOnItemSelect = useCallback(
    (...args) => {
      onItemSelect?.call(null, ...args)
    },
    [onItemSelect]
  )

  const appBarLeft = (
    <>
      <IconButton color="inherit" edge="start" onClick={handleDrawerCancelIcon} sx={{ mr: 2 }}>
        <MdiIcon path={ICON_VARIANT_CLOSE.path} />
        <SrOnlyComponent>close drawer</SrOnlyComponent>
      </IconButton>
      <Typography
        color="inherit"
        variant="h6"
        sx={{
          fontSize: (theme) => theme.typography.pxToRem(20),
        }}
      >
        {title}
      </Typography>
    </>
  )

  const appBarRight = (
    <Button color="inherit" onClick={handleDrawerCancelButton} sx={{ mr: -1.2 }}>
      Cancel
    </Button>
  )

  return (
    <NavigationDrawerComponent
      ref={ref}
      anchor="bottom"
      variant="temporary"
      appBarLeft={appBarLeft}
      appBarRight={appBarRight}
      onClose={handleDrawerClose}
      AppBarProps={{ color: 'inherit' }}
      sx={mergeSxProps(
        {
          '& .AglynNavigationDrawer-content': {
            backgroundColor: 'background.default',
            overflow: 'auto',
          },
          '& > .MuiDrawer-paper': {
            margin: '0 auto',
            maxHeight: '100vh',
            height: {
              xs: '100%',
              sm: '50%',
            },
          },
          '& .MuiDrawer-paper': {
            margin: '0 auto',
            maxHeight: { sm: '100%' },
            height: { xs: '100%', sm: '720px' },
            maxWidth: { sm: '100%' },
            width: (theme) => ({
              xs: '100%',
              sm: theme.breakpoints.values.sm,
            }),
          },
        },
        sx
      )}
      {...rest}
    >
      <ComponentsGridListComponent onItemSelect={handleOnItemSelect} items={items} />
    </NavigationDrawerComponent>
  )
})

ComponentsDrawerComponent.displayName = 'ComponentsDrawerComponent'
ComponentsDrawerComponent.aglyn = true
ComponentsDrawerComponent.defaultProps = {
  items: [],
}

export { ComponentsDrawerComponent }
export default ComponentsDrawerComponent
