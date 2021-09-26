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

import { AglynComponent } from '@aglyn/data-framework'
import {
  CardIconListItem,
  componentMapper,
  FormRenderer,
  GridFormTemplate,
  GridList,
  NavbarDrawer,
  NavbarDrawerProps,
  SvgPathIcon,
} from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-feature-themes'
import { _isStrT } from '@aglyn/shared-util-guards'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { forwardRef, Fragment, MouseEvent, useCallback, useMemo } from 'react'
import { ElementDrawerOptions } from '../contexts/element-drawer-context'

const StyledGridList = styled(GridList, {
  name: 'GridList',
})(({ theme }) => ({
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

const StyledNavbarDrawer = styled(NavbarDrawer, {
  name: 'NavbarDrawer',
})(({ theme }) => ({
  '& .AglynNavbarDrawer-content': {
    backgroundColor: theme.palette.background.default,
    overflow: 'auto',
  },
  '& > .AglynNavbarDrawer-paper': {
    margin: '0 auto',
    height: '100%',
    maxHeight: '100vh',
    [theme.breakpoints.up('sm')]: { height: theme.breakpoints.values.sm },
  },
  '& .AglynNavbarDrawer-paper': {
    height: 480,
    width: 480,
    margin: '0 auto',
  },
}))

export interface ComponentsDrawerComponentProps extends Partial<NavbarDrawerProps> {
  options?: ElementDrawerOptions
  elementComponents?: AglynComponent[]
  onCancel?: { bivarianceHack<T>(event: MouseEvent<T>, reason: 'canceled'): void }['bivarianceHack']
  onConfirm?: {
    bivarianceHack<T>(event: null | MouseEvent<T>, data: unknown): void
  }['bivarianceHack']
  onDelete?: { bivarianceHack<T>(event: MouseEvent<T>, data: unknown): void }['bivarianceHack']
}

export const BuilderComponentsDrawerComponent = forwardRef<any, ComponentsDrawerComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      className,
      options,
      onConfirm,
      onClose,
      onCancel,
      onDelete,
      elementComponents,
      ...rest
    } = props

    const { title, type = 'browse-site-components' } = { ...options }

    const selectedElementProps: any = {}
    const propsSchema: any = {}
    const handleElementSave = useCallback(
      (values) => {
        onConfirm?.call(null, null, { type: 'save', data: values })
      },
      [onConfirm]
    )
    const handleDrawerClose = useCallback(
      (e, reason) => {
        onClose?.call(null, e, reason)
      },
      [onClose]
    )
    const handleDrawerCancel = useCallback(
      (e) => {
        onCancel?.call(null, e, 'canceled')
      },
      [onCancel]
    )
    const handleDeleteButtonClick = useCallback(
      (e) => {
        onDelete?.call(null, e, { type: 'delete' })
      },
      [onDelete]
    )
    const handleItemClick = useCallback(
      (e, item) => {
        onConfirm?.call(null, e, { type: 'selection', data: item })
      },
      [onConfirm]
    )

    const items = useMemo(
      () =>
        (elementComponents ?? []).map((component) => ({
          id: component?.$id,
          title: component?.options?.title || component?.options?.displayName || 'No title',
          icon: component?.options?.icon,
        })),
      [elementComponents]
    )

    const appBarLeft = (
      <Fragment>
        <IconButton
          children={<SvgPathIcon iconId="close" />}
          color="inherit"
          edge="start"
          onClick={handleDrawerCancel}
          sx={{ mr: 2 }}
        />
        <Typography
          children={title}
          color="inherit"
          variant="h6"
          sx={{ fontSize: (theme) => theme.typography.pxToRem(20) }}
        />
      </Fragment>
    )

    const appBarRight = {
      'edit-element-traits': (
        <Button color="inherit" onClick={handleDrawerCancel} children="Cancel" />
      ),
    }

    const renderItemContent = useCallback(
      (item) => (
        <CardIconListItem
          item={item}
          label={item.title}
          onActionClick={handleItemClick}
          preview={
            <Fragment>
              {_isStrT(item.icon) || !item.icon ? (
                <Box fontSize={'4.17em'} component={SvgPathIcon} iconId={item.icon} />
              ) : (
                item.icon
              )}
            </Fragment>
          }
        />
      ),
      [handleItemClick]
    )

    const views = {
      'browse-site-components': (
        <StyledGridList
          GridContainerProps={{ spacing: 2 }}
          GridItemProps={{ xs: 6, sm: 4 }}
          renderItemContent={renderItemContent}
          items={items}
        />
      ),
      'edit-element-traits': (
        <Box px={[2, 3]} py={4} width={1}>
          <FormRenderer
            FormTemplate={GridFormTemplate}
            componentMapper={componentMapper}
            initialValues={selectedElementProps}
            onCancel={handleDrawerClose}
            onSubmit={handleElementSave}
            schema={propsSchema}
          />

          <FormControl margin="none" fullWidth>
            <Button onClick={handleDeleteButtonClick} sx={{ mt: 2, color: 'error.main' }} fullWidth>
              Delete Element
            </Button>
          </FormControl>
        </Box>
      ),
    }

    return (
      <StyledNavbarDrawer
        ref={ref}
        AppBarProps={{ color: 'primary' }}
        anchor="bottom"
        appBarLeft={appBarLeft}
        appBarRight={appBarRight[type]}
        variant="temporary"
        onClose={handleDrawerCancel}
        {...rest}
      >
        {views[type]}
      </StyledNavbarDrawer>
    )
  }
)

BuilderComponentsDrawerComponent.displayName = 'BuilderComponentsDrawerComponent'
BuilderComponentsDrawerComponent.defaultProps = {
  elementComponents: [],
}

export default BuilderComponentsDrawerComponent
