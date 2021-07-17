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

import { createStyles, WithStyles, withStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import { forwardRef, useCallback } from 'react'
import AppBar, { AppBarProps } from '@material-ui/core/AppBar'
import Toolbar from '@material-ui/core/Toolbar'
import IconButton from '@material-ui/core/IconButton'
import Fab from '@material-ui/core/Fab'
import { SvgPathIcon } from '@aglyn/shared/ui/react'
import { useElementDrawerContext } from '../contexts/element-drawer.context'

export const styles = createStyles({
  root: {
    top: 'auto',
    bottom: 0,
  },
  grow: {
    flexGrow: 1,
  },
  fabButton: {
    position: 'absolute',
    zIndex: 1,
    top: -30,
    left: 0,
    right: 0,
    margin: '0 auto',
  },
})

export interface AppBarComponentProps extends Partial<AppBarProps> {}

const AppBarComponent = forwardRef<any, AppBarComponentProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const { classes, className, ...rest } = props

    const { elementDrawer } = useElementDrawerContext()
    const handleFabClick = useCallback(async () => {
      const choice = await elementDrawer({ title: 'Add New Elements' })
        .then((res) => {
          console.log('res', res)
          return res
        })
        .catch((error) => {
          if (error instanceof Error) {
          }
          console.log('errror', error)
        })

      console.warn('async choice', choice)
    }, [elementDrawer])

    return (
      <AppBar
        ref={ref}
        className={clsx(classes.root, className)}
        position="fixed"
        color="primary"
        {...rest}
      >
        <Toolbar>
          <IconButton edge="start" color="inherit" aria-label="open drawer">
            <SvgPathIcon iconId={'menu'} />
          </IconButton>
          <Fab
            color="secondary"
            aria-label="add"
            className={classes.fabButton}
            onClick={handleFabClick}
          >
            <SvgPathIcon iconId={'plus'} />
          </Fab>
          <div className={classes.grow} />
          <IconButton color="inherit">
            <SvgPathIcon iconId={'search'} />
          </IconButton>
          <IconButton edge="end" color="inherit">
            <SvgPathIcon iconId={'more'} />
          </IconButton>
        </Toolbar>
      </AppBar>
    )
  }
)

AppBarComponent.displayName = 'AppBarComponent'
AppBarComponent.defaultProps = {}

export default withStyles(styles, { name: 'AppBarComponent' })(AppBarComponent)
