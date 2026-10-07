/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { _isEqualitySameType } from '@aglyn/shared-util-tools'
import { type BoxProps as MuiBoxProps } from '@mui/material/Box'
import MuiDrawer, {
  type DrawerProps as MuiDrawerProps,
} from '@mui/material/Drawer'
import MuiSwipeableDrawer from '@mui/material/SwipeableDrawer'
import clsx from 'clsx'
import { createContext, forwardRef, useContext } from 'react'
import { DEFAULT_LEFT_DRAWER_WIDTH } from '../constants/shared'

const classKeys = generateComponentClassKeys('AglynWorkspacePanel', [
  'drawer',
  'open',
  'anchorLeft',
  'anchorRight',
  'anchorTop',
  'anchorBottom',
])

interface WorkspacePanelProps extends MuiBoxProps {
  size?: string | number
}

const WorkspacePanel = styled('div', {
  name: 'AglynWorkspacePanel',
  shouldForwardProp(propName: any) {
    return !_isEqualitySameType(propName, null, 'size')
  },
})<WorkspacePanelProps>(({ theme, size }) => {
  const calcSize = size || DEFAULT_LEFT_DRAWER_WIDTH

  return {
    zIndex: theme.zIndex.appBar,
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }),
    [`&.${classKeys.open}`]: {
      transition: theme.transitions.create('margin', {
        easing: theme.transitions.easing.easeOut,
        duration: theme.transitions.duration.enteringScreen,
      }),
    },

    [`&.${classKeys.anchorLeft}`]: {
      marginLeft: -calcSize,
      [`&.${classKeys.open}`]: {
        marginLeft: 0,
      },
    },
    [`&.${classKeys.anchorRight}`]: {
      marginRight: -calcSize,
      [`&.${classKeys.open}`]: {
        marginRight: 0,
      },
    },
    [`&.${classKeys.anchorTop}`]: {
      marginTop: -calcSize,
      [`&.${classKeys.open}`]: {
        marginTop: 0,
      },
    },
    [`&.${classKeys.anchorBottom}`]: {
      marginBottom: -calcSize,
      [`&.${classKeys.open}`]: {
        marginBottom: 0,
      },
    },

    [`&.${classKeys.anchorTop}, &.${classKeys.anchorBottom}`]: {
      [`& .${classKeys.drawer}`]: {
        height: calcSize,
        width: '100%',
        [`& .MuiDrawer-paper`]: {
          height: calcSize,
          width: '100%',
        },
      },
    },
    [`&.${classKeys.anchorLeft}, &.${classKeys.anchorRight}`]: {
      [`& .${classKeys.drawer}`]: {
        width: calcSize,
        height: '100%',
        [`& .MuiDrawer-paper`]: {
          width: calcSize,
          height: '100%',
        },
      },
    },
    [`& .${classKeys.drawer}`]: {
      flexShrink: 0,
      [`& .MuiDrawer-paper`]: {
        boxSizing: 'border-box',
        position: 'unset',
      },
    },
  }
})

export interface WorkspacePanelComponentProps extends WorkspacePanelProps {
  DrawerProps?: MuiDrawerProps
  open?: boolean
  anchor?: MuiDrawerProps['anchor']
  /**
   * Overlay the workspace instead of sitting beside it. A screen too narrow
   * for a docked panel AND a usable canvas gets the panel as a temporary
   * drawer: it covers the canvas while open and gives all of it back when
   * dismissed, rather than squeezing the canvas to nothing.
   */
  temporary?: boolean
  /** Where the temporary drawer comes from; `anchor` when unset. */
  temporaryAnchor?: MuiDrawerProps['anchor']
  /** The temporary drawer asks to close (backdrop tap, swipe, Escape). */
  onClose?: () => void
  /** The temporary drawer asks to open. */
  onOpen?: () => void
}

/**
 * True while a drag is in flight. A temporary (overlay) panel hides for the
 * length of it: the drop targets are on the canvas it covers.
 */
export const WorkspacePanelDragContext = createContext(false)

export const WorkspacePanelComponent = forwardRef<
  any,
  WorkspacePanelComponentProps
>((props, ref) => {
  const {
    children,
    className: classNameProp,
    DrawerProps,
    size,
    open: openProp,
    anchor = 'left',
    id,
    temporary,
    temporaryAnchor,
    onClose,
    onOpen,
    ...rest
  } = props
  const dragging = useContext(WorkspacePanelDragContext)
  const open = Boolean(openProp)
  const {
    className: drawerClassName,
    open: _,
    ...drawerProps
  } = { ...DrawerProps }
  const className = clsx(
    {
      [classKeys.open]: open,
      [classKeys.anchorLeft]: anchor === 'left',
      [classKeys.anchorRight]: anchor === 'right',
      [classKeys.anchorTop]: anchor === 'top',
      [classKeys.anchorBottom]: anchor === 'bottom',
    },
    classNameProp,
  )

  if (temporary) {
    const sheetAnchor = temporaryAnchor ?? anchor
    const sheet = sheetAnchor === 'top' || sheetAnchor === 'bottom'
    const {
      component,
      'aria-label': ariaLabel,
    } = rest as { component?: string; 'aria-label'?: string }
    const { onClose: _onDrawerClose, ...sheetProps } = drawerProps
    return (
      <MuiSwipeableDrawer
        {...sheetProps}
        open={open}
        anchor={sheetAnchor}
        onClose={() => onClose?.()}
        onOpen={() => onOpen?.()}
        // The toolbar opens these; an edge swipe would fight the canvas
        // scrolling under the same finger. Swiping one closed still works.
        disableSwipeToOpen
        className={clsx(classKeys.drawer, drawerClassName)}
        // Hidden, not closed: closing would unmount the card being dragged
        // and end the drag with it.
        sx={dragging ? { visibility: 'hidden' } : undefined}
        slotProps={{
          paper: {
            ref,
            id,
            component,
            'aria-label': ariaLabel,
            sx: sheet
              ? {
                  height: '75dvh',
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                }
              : { width: size || DEFAULT_LEFT_DRAWER_WIDTH, maxWidth: '88vw' },
          } as object,
        }}
      >
        {children}
      </MuiSwipeableDrawer>
    )
  }

  return (
    <WorkspacePanel
      ref={ref}
      id={id}
      size={size}
      className={className}
      {...rest}
    >
      <MuiDrawer
        variant="persistent"
        open={open}
        anchor={anchor}
        className={clsx(classKeys.drawer, drawerClassName)}
        {...drawerProps}
      >
        {children}
      </MuiDrawer>
    </WorkspacePanel>
  )
})

WorkspacePanelComponent.displayName = 'WorkspacePanelComponent'
WorkspacePanelComponent.aglyn = true

export default WorkspacePanelComponent
