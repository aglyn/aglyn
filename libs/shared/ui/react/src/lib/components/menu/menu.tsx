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

import React, { HTMLProps, Children, MouseEvent, useState, forwardRef, cloneElement } from 'react'
import MuiMenu, { MenuProps as MuiMenuProps } from '@material-ui/core/Menu'
import MuiMenuItem, { MenuItemProps as MuiMenuItemProps } from '@material-ui/core/MenuItem'
import { createStyles, withStyles, WithStyles } from '@material-ui/core/styles'
import clsx from 'clsx'


const ITEM_HEIGHT = 48

type State = {
  anchorEl: null | HTMLElement
  mouseX: null | number
  mouseY: null | number
}
const initialState: State = {
  anchorEl: null,
  mouseX: null,
  mouseY: null,
}

const styles = createStyles<'root' | string, MenuProps>({
  root: { cursor: (props) => (props.context ? 'context-menu' : undefined) },
})

/* eslint-disable-next-line */
export interface MenuProps extends HTMLProps<HTMLDivElement> {
  items: Array<MuiMenuItemProps>
  context?: boolean
  MenuProps?: Partial<MuiMenuProps>
}

export const Menu = withStyles(styles, { name: 'Menu' })(
  forwardRef<any, MenuProps & WithStyles<typeof styles>>(function Menu(props, ref) {
    const { classes, children, items, context, className, MenuProps, ...rest } = props

    const [state, setState] = useState<State>(initialState)
    const handleClick = (event: MouseEvent<HTMLElement>) => {
      if (context) {
        event.preventDefault()
      }
      setState({
        anchorEl: event.currentTarget,
        mouseX: event.clientX - 2,
        mouseY: event.clientY - 4,
      })
    }
    const handleClose = () => setState(initialState)
    const open = Boolean(state.anchorEl || state.mouseY)
    const child = Children.only(children)
    const cloned = cloneElement(child as any, { onClick: handleClick })

    return (
      <div
        ref={ref}
        className={clsx(classes.root, className)}
        onContextMenu={handleClick}
        {...(context ? { onContextMenu: handleClick } : {})}
        {...rest}
      >
        {cloned}
        <MuiMenu
          PaperProps={
            context
              ? undefined
              : {
                style: {
                  maxHeight: ITEM_HEIGHT * 4.5,
                  minWidth: '20ch',
                },
              }
          }
          anchorEl={context ? undefined : state.anchorEl}
          anchorOrigin={
            context
              ? undefined
              : {
                vertical: 'bottom',
                horizontal: 'right',
              }
          }
          anchorPosition={
            !context || !state.mouseY
              ? undefined
              : {
                top: state.mouseY,
                left: state.mouseX,
              }
          }
          anchorReference={context ? 'anchorPosition' : undefined}
          getContentAnchorEl={null}
          open={open}
          transformOrigin={
            context
              ? undefined
              : {
                vertical: 'top',
                horizontal: 'right',
              }
          }
          onClose={handleClose}
          {...MenuProps}
        >
          {items.map((item: any, key) => (
            <MuiMenuItem
              key={key}
              {...item}
              // onClick={(e) => {
              //   handleClose()
              //   item.onClick && item.onClick(e)
              // }}
            />
          ))}
        </MuiMenu>
      </div>
    )
  }),
)

Menu.displayName = 'Menu'
Menu.defaultProps = {
  items: [],
}

export default Menu
