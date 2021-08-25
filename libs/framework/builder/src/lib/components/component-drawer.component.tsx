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

import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import { forwardRef, Fragment, MouseEvent, useCallback } from 'react'
import IconButton from '@material-ui/core/IconButton'
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
import { _isStrT } from '@aglyn/shared/util/helpers'
import Button from '@material-ui/core/Button'
import Box from '@material-ui/core/Box'
import FormControl from '@material-ui/core/FormControl'
import Typography from '@material-ui/core/Typography'
import { ElementDrawerOptions } from '../contexts/element-drawer.context'


export const styles = (theme: Theme) =>
  createStyles({
    title: {},
    label: {},
    icon: {},
    root: {
      '& $title': {fontSize: theme.typography.pxToRem(20)},
      '&>$paper': {
        margin: '0 auto',
        height: '100%',
        maxHeight: '100vh',
        [theme.breakpoints.up('sm')]: {height: theme.breakpoints.values.sm},
      },
    },
    paper: {
      width: 480,
      height: 480,
      margin: '0 auto',
    },
    content: {
      backgroundColor: theme.palette.background.default,
      // padding: theme.spacing(2, 2, 2, 2),
      overflow: 'auto',
    },
    closeButton: {marginRight: theme.spacing(2)},
    deleteButton: {color: theme.palette.error.main},
    gridList: {
      padding: theme.spacing(2, 2, 2, 2),
      overflowX: 'hidden',
    },
    gridListItem: {},
    card: {
      color: theme.palette.text.primary,
      '& $label': {textTransform: 'uppercase'},
      '& $icon': {color: theme.palette.text.secondary},
    },
    cardContent: {
      width: '100%',
      height: '100%',
      display: 'flex',
      textAlign: 'center',
      flexDirection: 'column',
      justifyContent: 'space-evenly',
    },
    actionArea: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
    },

    equalHeight: {
      height: 0,
      position: 'relative',
      paddingTop: `${(3 / 4) * 100}%`, // 16:9
    },
  })

export interface ElementDrawerComponentProps extends Partial<NavbarDrawerProps> {
  options?: ElementDrawerOptions
  elements?: { id: string, title: string, icon: unknown }[]
  onCancel?: { bivarianceHack<T>(event: MouseEvent<T>, reason: 'canceled'): void }['bivarianceHack']
  onConfirm?: { bivarianceHack<T>(event: null | MouseEvent<T>, data: unknown): void }['bivarianceHack']
  onDelete?: { bivarianceHack<T>(event: MouseEvent<T>, data: unknown): void }['bivarianceHack']
}

const ComponentDrawerComponent = forwardRef<any, ElementDrawerComponentProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const {
      classes,
      className,
      options,
      onConfirm,
      onClose,
      onCancel,
      onDelete,
      elements,
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

    const items = (elements ?? []).map((element) => ({
      id: element?.id,
      title: element?.title,
      icon: element?.icon,
    }))

    const appBarLeft = (
      <Fragment>
        <IconButton
          children={<SvgPathIcon iconId="close" />}
          className={classes.closeButton}
          color="inherit"
          edge="start"
          onClick={handleDrawerCancel}
        />
        <Typography children={title} className={classes.title} color="inherit" variant="h6" />
      </Fragment>
    )

    const appBarRight = {
      'edit-element-traits': (
        <Button color="inherit" onClick={handleDrawerCancel} children="Cancel" />
      ),
    }

    const renderItemContent = useCallback(
      (item) => {
        return (
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
        )
      },
      [handleItemClick],
    )

    const views = {
      'browse-site-components': (
        <GridList
          GridContainerProps={{spacing: 2}}
          GridItemProps={{xs: 6, sm: 4}}
          ListWrapperProps={{className: classes.gridList}}
          classes={{itemContent: classes.cardContent}}
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
              className={classes.deleteButton}
              component={Box}
              onClick={handleDeleteButtonClick}
              mt={2}
              fullWidth
            >
              Delete Element
            </Button>
          </FormControl>
        </Box>
      ),
    }

    return (
      <NavbarDrawer
        ref={ref}
        className={clsx(classes.root, className)}
        AppBarProps={{color: 'primary'}}
        anchor="bottom"
        appBarLeft={appBarLeft}
        appBarRight={appBarRight[type]}
        classes={{
          paper: classes.paper,
          content: classes.content,
        }}
        variant="temporary"
        onClose={handleDrawerCancel}
        {...rest}
      >
        {views[type]}
      </NavbarDrawer>
    )
  },
)

ComponentDrawerComponent.displayName = 'ComponentDrawerComponent'
ComponentDrawerComponent.defaultProps = {}

export default withStyles(styles, {name: 'ComponentDrawerComponent'})(ComponentDrawerComponent)
