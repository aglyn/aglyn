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

import {type AglynComponentElementTemplate} from '@aglyn/core-data-framework'
import {IconVariant} from '@aglyn/shared-data-brand'
import {type AnyProps} from '@aglyn/shared-data-types'
import {styled} from '@aglyn/shared-feature-themes'
import {
  CardIconListItem,
  type FormSchema,
  GridList as JsxGridList,
  NavigationDrawer as JsxNavbarDrawer,
  type NavigationDrawerProps,
  SrOnlyComponent,
} from '@aglyn/shared-ui-jsx'
import {mdiClose, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import {forwardRef, type MouseEvent, useCallback} from 'react'
import {type ElementDrawerOptions} from '../contexts/element-drawer-context'


const ComponentsDrawer = styled(JsxNavbarDrawer, {
  name: 'AglynComponentsDrawer',
})<NavigationDrawerProps>(({theme}) => ({
  '& .AglynNavigationDrawer-content': {
    backgroundColor: theme.palette.background.default,
    overflow: 'auto',
  },
  '& > .MuiDrawer-paper': {
    margin: '0 auto',
    height: '100%',
    maxHeight: '100vh',
    [theme.breakpoints.up('sm')]: {
      height: theme.breakpoints.values.sm,
    },
  },
  '& .MuiDrawer-paper': {
    height: 480,
    width: 480,
    margin: '0 auto',
  },
}))


const ComponentsDrawerGridList = styled(JsxGridList, {
  name: 'AglynComponentsDrawerGridList',
})(({theme}) => ({
  overflowX: 'hidden',
  '& .AglynGridList-gridContainer': {
    padding: theme.spacing(0, 2),
    marginTop: theme.spacing(0),
    marginLeft: theme.spacing(-2),
  },
  '& .AglynGridList-itemContent': {
    width: '100%',
    height: '100%',
    display: 'flex',
    textAlign: 'center',
    flexDirection: 'column',
    justifyContent: 'space-evenly',
  },
}))


const AppBarTitle = styled(Typography, {
  name: 'AglynAppBarTitle',
})(({theme}) => ({
  fontSize: theme.typography.pxToRem(20),
}))


const ItemIcon = styled(MdiIcon, {
  name: 'AglynItemIcon',
})(({theme}) => ({
  fontSize: theme.typography.pxToRem(64),
  padding: theme.spacing(1.5),
  borderRadius: '50%',
  backgroundColor: theme.palette.background.default,
  border: `1px solid ${theme.palette.divider}`,
  color: theme.palette.quaternary.main,
  overflow: 'visible',
}))


export interface ComponentsDrawerOptionsProps extends ElementDrawerOptions {
  type?: 'browse-site-components' | 'edit-element-traits'
  propsSchema?: FormSchema
  selectedElementProps?: AnyProps
}

export interface ComponentsDrawerComponentProps extends Partial<NavigationDrawerProps> {
  options?: ComponentsDrawerOptionsProps
  items?: AglynComponentElementTemplate[]
  onCancel?: {bivarianceHack<T>(event: MouseEvent<T>, reason: 'canceled'): void}['bivarianceHack']
  onConfirm?: {
    bivarianceHack<T>(event: null | MouseEvent<T>, data: unknown): void
  }['bivarianceHack']
  onDelete?: {bivarianceHack<T>(event: MouseEvent<T>, data: unknown): void}['bivarianceHack']
}

export const ComponentsDrawerComponent = forwardRef<any, ComponentsDrawerComponentProps>(
  function RefRenderFn(props, ref) {
    const {options, onConfirm, onClose, onCancel, onDelete, items, ...rest} = props

    const {title} = {...options}
    const handleDrawerClose = useCallback(
      (e, reason) => {
        onClose?.call(null, e, reason)
      },
      [onClose],
    )
    const handleDrawerCancel = useCallback(
      (e) => {
        onCancel?.call(null, e, 'canceled')
      },
      [onCancel],
    )
    const handleItemClick = useCallback(
      (e, item) => {
        onConfirm?.call(null, e, {type: 'selection', data: item})
      },
      [onConfirm],
    )

    const appBarLeft = (
      <>
        <IconButton color="inherit" edge="start" onClick={handleDrawerCancel} sx={{mr: 2}}>
          <MdiIcon path={mdiClose.path} />
          <SrOnlyComponent>close drawer</SrOnlyComponent>
        </IconButton>
        <AppBarTitle color="inherit" variant="h6">
          {title}
        </AppBarTitle>
      </>
    )

    const appBarRight = (
      <Button color="inherit" onClick={handleDrawerCancel} sx={{mr: -1.2}}>
        Cancel
      </Button>
    )

    const renderItemContent = useCallback(
      (item) => (
        <CardIconListItem
          item={item}
          label={item.label}
          onActionClick={handleItemClick}
          preview={
            <>
              <ItemIcon
                color="primary"
                path={item.iconPath || IconVariant.ENTITY_BLOCK}
                sx={{color: item.iconColor}}
              />
            </>
          }
        />
      ),
      [handleItemClick],
    )

    return (
      <ComponentsDrawer
        ref={ref}
        anchor="bottom"
        variant="temporary"
        appBarLeft={appBarLeft}
        appBarRight={appBarRight}
        onClose={handleDrawerCancel}
        AppBarProps={{color: 'inherit'}}
        {...rest}
      >
        <ComponentsDrawerGridList
          GridContainerProps={{spacing: 2}}
          GridItemProps={{xs: 6, sm: 4}}
          renderItemContent={renderItemContent}
          items={items}
        />
      </ComponentsDrawer>
    )
  },
)

ComponentsDrawerComponent.displayName = 'ComponentsDrawerComponent'
ComponentsDrawerComponent.defaultProps = {
  items: [],
}

export default ComponentsDrawerComponent
