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
import {
  NavigationDrawerComponent,
  type NavigationDrawerProps,
  SrOnly,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { styled, sx, Theme } from '@aglyn/shared-ui-theme'
import { Button, IconButton, Typography } from '@mui/material'
import { forwardRef, type SyntheticEvent, useCallback } from 'react'

const StyledDrawer = styled(NavigationDrawerComponent)(
  sx<Theme>({
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
  }),
)

export interface CloseableDrawerProps extends Partial<NavigationDrawerProps> {
  drawerTitle?: JSX.Node
  disableCloseButton?: boolean
  onClose?: {
    bivarianceHack(
      event: {},
      reason: 'backdropClick' | 'escapeKeyDown' | 'cancelClick',
    ): void
  }['bivarianceHack']
  action?: JSX.Node
  onActionClick?: {
    bivarianceHack(event: SyntheticEvent, reason: 'actionButtonClick'): void
  }['bivarianceHack']
}

const CloseableDrawerComponent = forwardRef<any, CloseableDrawerProps>(
  (props, ref) => {
    const {
      disableCloseButton,
      onClose,
      action,
      onActionClick,
      children,
      drawerTitle,
      ...rest
    } = props

    const handleClose = useCallback(
      (e, reason) => {
        onClose?.call(null, e, reason)
      },
      [onClose],
    )
    const handleCancelIconClick = useCallback(
      (e) => {
        handleClose.call(null, e, 'cancelClick')
      },
      [handleClose],
    )
    const handleActionClick = useCallback(
      (e) => {
        onActionClick.call(null, e, 'actionButtonClick')
      },
      [onActionClick],
    )

    const appBarLeft = (
      <>
        {disableCloseButton ? null : (
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleCancelIconClick}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
        )}

        <Typography
          color="inherit"
          variant="h6"
          sx={{
            fontSize: (theme) => theme.typography.pxToRem(20),
          }}
        >
          {drawerTitle}
        </Typography>
      </>
    )

    const appBarRight = action ? (
      <Button color="inherit" onClick={handleActionClick} sx={{ mr: -1.2 }}>
        {action}
      </Button>
    ) : null

    return (
      <StyledDrawer
        ref={ref}
        anchor="bottom"
        variant="temporary"
        appBarLeft={appBarLeft}
        appBarRight={appBarRight}
        onClose={handleClose}
        AppBarProps={{ color: 'surface' }}
        {...rest}
      >
        {children}
      </StyledDrawer>
    )
  },
)

CloseableDrawerComponent.displayName = 'CloseableDrawerComponent'
CloseableDrawerComponent.aglyn = true
CloseableDrawerComponent.defaultProps = {}

export { CloseableDrawerComponent }
export default CloseableDrawerComponent
