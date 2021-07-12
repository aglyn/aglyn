/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import {
  forwardRef,
  useCallback,
  Fragment,
  MouseEventHandler,
  SyntheticEvent,
  MouseEvent,
} from 'react'
import IconButton from '@material-ui/core/IconButton'
import {
  GridList,
  CardIconListItem,
  NavbarDrawer,
  NavbarDrawerProps,
  SvgPathIcon,
  componentMapper,
  FormRenderer,
  GridFormTemplate,
} from '@aglyn/shared/ui/react'
import { _isStr } from '@aglyn/shared/util/helpers'
import Button from '@material-ui/core/Button'
import Box from '@material-ui/core/Box'
import FormControl from '@material-ui/core/FormControl'
import Typography from '@material-ui/core/Typography'
import Website from '@aglyn/website/core'
import { ElementDrawerOptions } from '../contexts/element-drawer.context'


export const styles = (theme: Theme) => createStyles({
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
  options: ElementDrawerOptions
  onCancel: MouseEventHandler<unknown>
  onConfirm: {
    bivarianceHack<T>(event: MouseEvent<T>, selection: unknown): void;
  }['bivarianceHack']
}

const ElementDrawerComponent = forwardRef<any, ElementDrawerComponentProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const {
      classes,
      className,
      options,
      onConfirm,
      onClose,
      ...rest
    } = props

    const {title} = options
    console.log('props', props)


    const drawerState: any = {type: 'browse-site-components'}
    const selectedElementProps: any = {}
    const propsSchema: any = {}
    const handleElementSave = useCallback(() => {

    }, [])
    const handleDrawerClose = useCallback((e) => {
      onClose(e, null)
    }, [onClose])
    const handleDeleteButtonClick = useCallback(() => {

    }, [])
    const handleItemClick = useCallback((e, item) => {
      console.log('handleItemClick', item)
      onConfirm(e, item)
    }, [onConfirm])
    const components = Website.App.getComponents({moduleId: 'react'})
    const items = components.map(i => ({
      id: i?.$id,
      title: i?.metadata?.title,
      icon: i?.metadata?.icon,
    }))

    const renderItemContent = useCallback((item) => {
      return (
        <CardIconListItem
          item={item}
          label={item.title}
          onActionClick={handleItemClick}
          preview={
            (_isStr(item.icon) ? (
              <Box
                fontSize={'4.17em'}
                component={SvgPathIcon}
                {...{iconId: item.icon}}
              />
            ) : (
              <Fragment>
                {item.icon}
              </Fragment>
            )) as unknown as any
          }
        />
      )
    }, [handleItemClick])

    return (
      <NavbarDrawer
        ref={ref}
        className={clsx(classes.root, className)}
        AppBarProps={{color: 'primary'}}
        anchor="bottom"
        appBarLeft={(
          <Fragment>
            <IconButton
              children={<SvgPathIcon iconId="close" />}
              className={classes.closeButton}
              color="inherit"
              edge="start"
              onClick={handleDrawerClose}
            />
            <Typography
              children={title}
              className={classes.title}
              color="inherit"
              variant="h6"
            />
          </Fragment>
        )}
        appBarRight={
          {
            'edit-element-traits': (
              <Button
                color="inherit"
                onClick={handleDrawerClose}
                children="Cancel"
              />
            ),
          }[drawerState?.type]
        }
        classes={{
          paper: classes.paper,
          content: classes.content,
        }}
        variant="temporary"
        onClose={handleDrawerClose}
        {...rest}
      >
        {
          {
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
          }[drawerState?.type]
        }
      </NavbarDrawer>
    )
  },
)

ElementDrawerComponent.displayName = 'ElementDrawerComponent'
ElementDrawerComponent.defaultProps = {}

export default withStyles(styles, {name: 'ElementDrawerComponent'})(ElementDrawerComponent)
