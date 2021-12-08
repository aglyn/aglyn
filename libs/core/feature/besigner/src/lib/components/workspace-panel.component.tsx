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

import clsx from 'clsx'
import { DEFAULT_LEFT_DRAWER_WIDTH } from '../constants'
import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import { _isEqualitySameType } from '@aglyn/shared-util-guards'
import MuiDrawer, { DrawerProps as MuiDrawerProps } from '@mui/material/Drawer'
import { forwardRef, HTMLAttributes } from 'react'


const classKeys = generateComponentClassKeys('AglynWorkspacePanel',[
  'drawer',
  'open',
  'anchorLeft',
  'anchorRight',
  'anchorTop',
  'anchorBottom',
])

interface WorkspacePanelProps extends HTMLAttributes<HTMLDivElement> {
  size?: string | number
}

const WorkspacePanel = styled('div', {
  name: 'AglynWorkspacePanel',
  shouldForwardProp(propName: any) {
    return !_isEqualitySameType(propName, 'size')
  },
})<WorkspacePanelProps>(({ theme, size }) => {
  const calcSize = (size || DEFAULT_LEFT_DRAWER_WIDTH)

  return ({
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
      }
    },
    [`& .${classKeys.drawer}`]: {
      flexShrink: 0,
      [`& .MuiDrawer-paper`]: {
        boxSizing: 'border-box',
        position: 'unset',
      },
    }
  })
})

export interface WorkspacePanelComponentProps extends WorkspacePanelProps {
  DrawerProps?: MuiDrawerProps
  open?: boolean
  anchor?: MuiDrawerProps['anchor']
}

const WorkspacePanelComponent = forwardRef<any, WorkspacePanelComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      className: classNameProp,
      DrawerProps,
      size,
      open: openProp,
      anchor,
      ...rest
    } = props
    const open = Boolean(openProp)
    const {className: drawerClassName, open: _, ...drawerProps} = {...DrawerProps}
    const className = clsx({
      [classKeys.open]: open,
      [classKeys.anchorLeft]: anchor === 'left',
      [classKeys.anchorRight]: anchor === 'right',
      [classKeys.anchorTop]: anchor === 'top',
      [classKeys.anchorBottom]: anchor === 'bottom',
    }, classNameProp)

    return (
      <WorkspacePanel
        ref={ref}
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
  }
)

WorkspacePanelComponent.displayName = 'WorkspacePanelComponent'
WorkspacePanelComponent.defaultProps = {
  anchor: 'left',
}

export { WorkspacePanelComponent }
export default WorkspacePanelComponent
