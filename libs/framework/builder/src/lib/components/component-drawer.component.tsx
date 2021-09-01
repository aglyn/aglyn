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

import {
  CardIconListItem,
  componentMapper,
  FormRenderer,
  GridFormTemplate,
  GridList,
  NavbarDrawer,
  NavbarDrawerProps,
  SvgPathIcon,
} from '@aglyn/shared/ui/react'
import { styled } from '@aglyn/shared/ui/themes'
import { _isStrT } from '@aglyn/shared/util/helpers'
import Box from '@material-ui/core/Box'
import Button from '@material-ui/core/Button'
import FormControl from '@material-ui/core/FormControl'
import IconButton from '@material-ui/core/IconButton'
import Typography from '@material-ui/core/Typography'
import { forwardRef, Fragment, MouseEvent, useCallback } from 'react'
import { ElementDrawerOptions } from '../contexts/element-drawer-context'


const StyledGridList = styled(GridList, {
  name: 'GridList',
})(({theme}) => ({
  padding: theme.spacing(2, 2, 2, 2),
  overflowX: 'hidden',
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
})(({theme}) => ({
  '& .MuiDrawer-content': {
    backgroundColor: theme.palette.background.default,
    // padding: theme.spacing(2, 2, 2, 2),
    overflow: 'auto',
  },
  '& .MuiDrawer-paper': {
    margin: '0 auto',
    height: '100%',
    maxHeight: '100vh',
    [theme.breakpoints.up('sm')]: {height: theme.breakpoints.values.sm},
  },
  '& > .MuiDrawer-paper': {
    width: theme.breakpoints.values.sm,
    height: 480,
    margin: '0 auto',
  },
}))

export interface ElementDrawerComponentProps extends Partial<NavbarDrawerProps> {
  options?: ElementDrawerOptions
  elementComponents?: { id: string, title: string, icon: unknown }[]
  onCancel?: { bivarianceHack<T>(event: MouseEvent<T>, reason: 'canceled'): void }['bivarianceHack']
  onConfirm?: { bivarianceHack<T>(event: null | MouseEvent<T>, data: unknown): void }['bivarianceHack']
  onDelete?: { bivarianceHack<T>(event: MouseEvent<T>, data: unknown): void }['bivarianceHack']
}

export const ComponentDrawerComponent = forwardRef<any, ElementDrawerComponentProps>(
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

    const {title, type = 'browse-site-components'} = {...options}

    const selectedElementProps: any = {}
    const propsSchema: any = {}
    const handleElementSave = useCallback((values) => {
      onConfirm?.call(null, null, {type: 'save', data: values})
    }, [onConfirm])
    const handleDrawerClose = useCallback((e, reason) => {
      onClose?.call(null, e, reason)
    }, [onClose])
    const handleDrawerCancel = useCallback((e) => {
      onCancel?.call(null, e, 'canceled')
    }, [onCancel])
    const handleDeleteButtonClick = useCallback((e) => {
      onDelete?.call(null, e, {type: 'delete'})
    }, [onDelete])
    const handleItemClick = useCallback((e, item) => {
      onConfirm?.call(null, e, {type: 'selection', data: item})
    }, [onConfirm])

    const items = (elementComponents ?? []).map((element) => ({
      id: element?.id,
      title: element?.title,
      icon: element?.icon,
    }))

    const appBarLeft = (
      <Fragment>
        <IconButton
          children={<SvgPathIcon iconId="close"/>}
          color="inherit"
          edge="start"
          onClick={handleDrawerCancel}
          sx={{mr: 2}}
        />
        <Typography
          children={title}
          color="inherit"
          variant="h6"
          sx={{fontSize: (theme) => theme.typography.pxToRem(20)}}
        />
      </Fragment>
    )

    const appBarRight = {
      'edit-element-traits': (
        <Button color="inherit" onClick={handleDrawerCancel} children="Cancel"/>
      ),
    }

    const renderItemContent = useCallback((item) => (
      <CardIconListItem
        item={item}
        label={item.title}
        onActionClick={handleItemClick}
        preview={
          (_isStrT(item.icon) ? (
            <Box fontSize={'4.17em'} component={SvgPathIcon} {...{iconId: item.icon}} />
          ) : (
            <Fragment>{item.icon}</Fragment>
          )) as unknown as any
        }
      />
    ), [handleItemClick])

    const views = {
      'browse-site-components': (
        <StyledGridList
          GridContainerProps={{spacing: 2}}
          GridItemProps={{xs: 6, sm: 4}}
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
            <Button
              onClick={handleDeleteButtonClick}
              sx={{mt: 2, color: 'error.main'}}
              fullWidth
            >
              Delete Element
            </Button>
          </FormControl>
        </Box>
      ),
    }

    return (
      <StyledNavbarDrawer
        ref={ref}
        AppBarProps={{color: 'primary'}}
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
  },
)

ComponentDrawerComponent.displayName = 'ComponentDrawerComponent'
ComponentDrawerComponent.defaultProps = {
  elementComponents: [],
}

export default ComponentDrawerComponent
