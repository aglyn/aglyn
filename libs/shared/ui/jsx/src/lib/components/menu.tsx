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

import { MdiIcon, type MdiIconProps } from './mdi-icon/mdi-icon'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  Box,
  type BoxProps as MuiBoxProps,
  Divider,
  type DividerProps,
  ListItemIcon,
  type ListItemIconProps as MuiListItemIconProps,
  ListItemText,
  type ListItemTextProps as MuiListItemTextProps,
  ListSubheader as MuiListSubheader,
  type ListSubheaderProps as MuiListSubheaderProps,
  Menu as MuiMenu,
  MenuItem as MuiMenuItem,
  type MenuItemProps as MuiMenuItemProps,
  type MenuProps as MuiMenuProps,
  Typography,
  type TypographyProps as MuiTypographyProps,
} from '@mui/material'
import {
  Children,
  cloneElement,
  forwardRef,
  type MouseEvent,
  type MouseEventHandler,
  type ReactElement,
  useCallback,
  useState,
} from 'react'

const ITEM_HEIGHT = 48
const defaultState: { anchorEl: Element; mouseX: number; mouseY: number } = {
  anchorEl: null,
  mouseX: null,
  mouseY: null,
}

type ItemTypes = 'item' | 'divider' | 'subheader' | undefined | never
type ItemTypeProps = MuiMenuItemProps & {
  type?: 'item'
  icon?: MdiIconProps
  endIcon?: MdiIconProps
  ListItemTextProps?: Partial<MuiListItemTextProps>
  ListItemIconProps?: Partial<MuiListItemIconProps>
  EndIconTypographyProps?: Partial<MuiTypographyProps>
}
type DividerTypeProps = DividerProps & { type: 'divider' }
type SubheaderTypeProps = MuiListSubheaderProps & { type: 'subheader' }

export type MenuItemProps<T extends ItemTypes = ItemTypes> =
  JSX.OverrideableComponentProps &
    Conditional<
      T,
      'divider',
      DividerTypeProps,
      Conditional<
        T,
        'subheader',
        SubheaderTypeProps,
        Conditional<T, 'item' | undefined | never, ItemTypeProps, ItemTypeProps>
      >
    >

/* eslint-disable-next-line */
export interface MenuProps extends MuiBoxProps {
  items: MenuItemProps[]
  context?: boolean
  dense?: boolean
  MenuProps?: Partial<MuiMenuProps>
  children: ReactElement
  horizontalOrigin?: MuiMenuProps['anchorOrigin']['horizontal']
}

export const Menu = forwardRef<any, MenuProps>((props, ref) => {
  const {
    children,
    items = [],
    context,
    className,
    sx,
    dense,
    MenuProps,
    horizontalOrigin,
    ...rest
  } = props

  const [state, setState] = useState(defaultState)
  const child = Children.only(children) as ReactElement<any>
  const onChildClick = (child.props as any)?.onClick?.bind(null) as MouseEventHandler
  const handleClose = () => setState(defaultState)
  const handleClick = useCallback(
    (event: MouseEvent<any>) => {
      if (onChildClick) {
        onChildClick.call(null, event)
      }
      if (context) {
        event.preventDefault()
      }
      setState({
        anchorEl: event.currentTarget,
        mouseX: event.clientX - 2,
        mouseY: event.clientY - 4,
      })
    },
    [context, onChildClick],
  )
  const open = Boolean(state.anchorEl || state.mouseY)
  const cloned = cloneElement(child, {
    onClick: handleClick,
    'aria-expanded': open ? 'true' : 'false',
  })

  // MUI v9: PaperProps → slotProps.paper. Accept both for backward compat.
  const { PaperProps: legacyPaperProps, slotProps: menuSlotProps, ...menuProps } = MenuProps || ({} as any)
  const resolvedPaperProps = legacyPaperProps ?? menuSlotProps?.paper ?? {}
  const { sx: paperSx, ...paperProps } = resolvedPaperProps
  const arrowPlacement =
    horizontalOrigin === 'right'
      ? { right: 14 }
      : horizontalOrigin === 'center'
        ? { right: 'auto', left: 'auto' }
        : { left: 14 }

  return (
    <Box
      ref={ref}
      component={'div'}
      onContextMenu={context && handleClick}
      sx={mergeSxProps(context && { cursor: 'context-menu' }, sx)}
      {...rest}
    >
      {cloned}
      <MuiMenu
        anchorEl={context ? undefined : state.anchorEl}
        anchorReference={context ? 'anchorPosition' : undefined}
        anchorPosition={
          !context || !state.mouseY
            ? undefined
            : {
                top: state.mouseY,
                left: state.mouseX,
              }
        }
        anchorOrigin={
          context
            ? undefined
            : {
                vertical: 'bottom',
                horizontal: horizontalOrigin || 'left',
              }
        }
        transformOrigin={
          context
            ? undefined
            : {
                vertical: 'top',
                horizontal: horizontalOrigin || 'left',
              }
        }
        slotProps={{
          paper: context
            ? undefined
            : {
                elevation: 0,
                sx: mergeSxProps(
                  {
                    maxHeight: ITEM_HEIGHT * 4.5,
                    width: '30ch',
                    filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                    backgroundColor: 'surface.main',
                    marginTop: 0.5,
                    '&:before': {
                      content: '""',
                      display: 'block',
                      position: 'absolute',
                      top: 0,
                      width: 10,
                      height: 10,
                      bgcolor: 'surface.main',
                      transform: 'translateY(-50%) rotate(45deg)',
                      zIndex: 0,
                      ...arrowPlacement,
                    },
                  },
                  paperSx,
                ),
                ...paperProps,
              },
        }}
        // getContentAnchorEl={null}
        open={open}
        onClose={handleClose}
        {...menuProps}
      >
        {items.map(
          (
            {
              onClick,
              children,
              type,
              icon,
              endIcon,
              ListItemTextProps,
              ListItemIconProps,
              EndIconTypographyProps,
              key: keyProp,
              ...item
            }: any,
            i,
          ) => {
            const key = keyProp ?? item.id ?? i

            switch (type) {
              case 'subheader':
                return (
                  <MuiListSubheader
                    key={key}
                    onClick={onClick}
                    {...(item as any)}
                  >
                    {children}
                  </MuiListSubheader>
                )
              case 'divider':
                return (
                  <Divider key={key} onClick={onClick} {...(item as any)}>
                    {children}
                  </Divider>
                )
              case 'item':
              default:
                return (
                  <MuiMenuItem
                    dense={dense}
                    key={key}
                    onClick={(e) => {
                      handleClose()
                      onClick && onClick(e)
                    }}
                    {...item}
                  >
                    {!icon?.path || !icon ? null : (
                      <ListItemIcon {...ListItemIconProps}>
                        {!icon?.path ? (
                          icon
                        ) : (
                          <MdiIcon fontSize="small" {...icon} />
                        )}
                      </ListItemIcon>
                    )}
                    <ListItemText {...ListItemTextProps}>
                      {children}
                    </ListItemText>
                    {!endIcon?.path || !endIcon ? null : (
                      <Typography
                        variant="body2"
                        {...EndIconTypographyProps}
                        sx={[{
                          color: "text.secondary"
                        }, ...(Array.isArray(EndIconTypographyProps?.sx) ? EndIconTypographyProps.sx : [EndIconTypographyProps?.sx])]}>
                        {!endIcon?.path ? (
                          endIcon
                        ) : (
                          <MdiIcon fontSize="small" {...endIcon} />
                        )}
                      </Typography>
                    )}
                  </MuiMenuItem>
                );
            }
          },
        )}
      </MuiMenu>
    </Box>
  );
})

Menu.displayName = 'Menu'
Menu.aglyn = true

export default Menu
