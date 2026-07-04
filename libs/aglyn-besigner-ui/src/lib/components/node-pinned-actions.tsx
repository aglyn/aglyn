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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import {
  BesignerPanelTabFlag,
  setBesignerPanels,
} from '@aglyn/besigner-data-app'
import { isRootElementId } from '@aglyn/aglyn'
import {
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_DRAG,
  ICON_VARIANT_MODIFY_DUPLICATE,
  ICON_VARIANT_MODIFY_EDIT,
  ICON_VARIANT_MODIFY_MOVE_DOWN,
  ICON_VARIANT_MODIFY_MOVE_UP,
  ICON_VARIANT_SELECT_PARENT,
  ICON_VARIANT_SHOW_MORE,
} from '@aglyn/shared-data-enums'
import {
  MdiIcon,
  type MdiIconProps,
  SrOnly,
  type SrOnlyProps,
} from '@aglyn/shared-ui-jsx'
import {
  Button as MuiButton,
  ButtonGroup as MuiButtonGroup,
  type ButtonGroupProps,
  type ButtonProps,
  ClickAwayListener,
  Grow,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Tooltip as MuiTooltip,
  type TooltipProps,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { type ChangeEvent, forwardRef, useCallback, useState } from 'react'
import useBesignerAppContext from '../hooks/use-besigner-app-context'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'

export interface BadgeButtonProps extends ButtonProps {
  children?: SrOnlyProps['children']
  icon: MdiIconProps
  TooltipProps?: Partial<TooltipProps>
  tooltip?: TooltipProps['title']
  SrOnlyProps?: SrOnlyProps
}

export const BadgeButton = forwardRef<any, BadgeButtonProps>((props, ref) => {
  const { children, tooltip, TooltipProps, icon, SrOnlyProps, ...rest } = props

  return (
    <MuiTooltip title={tooltip} {...TooltipProps}>
      <MuiButton ref={ref} {...rest}>
        <MdiIcon fontSize="inherit" {...icon} />
        <SrOnly {...SrOnlyProps}>{children}</SrOnly>
      </MuiButton>
    </MuiTooltip>
  )
})
BadgeButton.displayName = 'AglynBadgeButton'

const MoveUpButton = observer(({ node }: { node: Aglyn.NodeSchema }) => {
  const handleMoveUp = useCallback(
    (e: ChangeEvent<unknown>) => {
      Aglyn.canvas.reorderNode(node, node?.index - 1)
    },
    [node],
  )

  return (
    <BadgeButton
      tooltip="Move up"
      children={'move up'}
      onClick={handleMoveUp}
      disabled={node?.index < 1}
      icon={{ path: ICON_VARIANT_MODIFY_MOVE_UP.path }}
      TooltipProps={{ disableInteractive: true }}
    />
  )
})
const MoveDownButton = observer(({ node }: { node: Aglyn.NodeSchema }) => {
  const handleMoveDown = useCallback(
    (e: ChangeEvent<unknown>) => {
      Aglyn.canvas.reorderNode(node, node?.index + 1)
    },
    [node],
  )

  return (
    <BadgeButton
      tooltip="Move down"
      children={'move down'}
      onClick={handleMoveDown}
      disabled={!(node?.index < node?.parent?.nodes?.length - 1)}
      icon={{ path: ICON_VARIANT_MODIFY_MOVE_DOWN.path }}
      TooltipProps={{ disableInteractive: true }}
    />
  )
})

export interface NodePinnedActionsProps extends ButtonGroupProps {
  $id: Aglyn.NodeId
}

export const NodePinnedActions = observer(
  forwardRef<any, NodePinnedActionsProps>((props, ref) => {
    const { $id, ...rest } = props

    const app = useBesignerAppContext()
    const node = Aglyn.canvas.getNode($id)
    const parent = node?.parent
    const handleProps = Besigner.handles.get($id)
    const [moreOpen, setMoreOpen] = useState(false)
    const [moreButton, moreButtonRef] = useState<HTMLButtonElement | null>(null)

    const closeMore = useCallback(() => setMoreOpen(false), [])
    const openMore = useCallback(() => setMoreOpen(true), [])

    const handleDuplicateClick = useCallback(
      (e: ChangeEvent<unknown>) => {
        Aglyn.canvas.duplicateNode(node)
      },
      [node],
    )

    const handleModifyClick = useCallback(
      (e: ChangeEvent<unknown>) => {
        setBesignerPanels(app, {
          panels: (panels) => ({
            ...panels,
            panelRight: {
              ...panels.panelRight,
              toggled: true,
              tab: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
            },
          }),
        })
      },
      [app],
    )

    const handleParentOnClick = useCallback(
      (e: ChangeEvent<unknown>) => {
        Besigner.focus.setSelectedNode(parent)
      },
      [parent],
    )

    const handleParentOnMouseEnter = useCallback(
      (e: ChangeEvent<unknown>) => {
        Besigner.focus.setHoveredNode(parent)
      },
      [parent],
    )
    const handleParentOnMouseLeave = useCallback((e: ChangeEvent<unknown>) => {
      Besigner.focus.clearHover()
    }, [])

    const deleteElementCallback = useDeleteElementCallback()
    const handleDeleteClick = useCallback(() => {
      closeMore()
      deleteElementCallback(node)
    }, [node, closeMore, deleteElementCallback])

    return (
      <>
        <MuiButtonGroup
          ref={ref}
          id="aglyn:element-overlay-badge"
          data-aglyn-node={$id}
          data-aglyn-kind="overlay-actions"
          variant="contained"
          color="secondary"
          aria-label="element controls"
          size="small"
          sx={{
            boxShadow: 4,

            pointerEvents: 'auto',
            bgcolor: 'surface.main',

            '& .MuiButton-root': {
              px: 0.5,
              py: 0.5,
              // px: 0.5,
              fontSize: 16,
              '&.MuiButtonGroup-grouped': {
                minWidth: 28,
                minHeight: 28,
              },
            },
          }}
          {...rest}
        >
          {!isRootElementId($id) && (
            <BadgeButton
              tooltip="Drag"
              children="drag"
              sx={{ '&, &:hover, &:focus': { cursor: 'move' } }}
              // ref={dragHandleRef}
              // ref={elementRef?.dragHandle}
              icon={{ path: ICON_VARIANT_MODIFY_DRAG.path }}
              TooltipProps={{ disableInteractive: true }}
              {...handleProps}
            />
          )}

          {!isRootElementId($id) && (
            <BadgeButton
              tooltip="Duplicate"
              children="duplicate"
              onClick={handleDuplicateClick}
              icon={{ path: ICON_VARIANT_MODIFY_DUPLICATE.path }}
              TooltipProps={{ disableInteractive: true }}
            />
          )}

          {!isRootElementId($id) && (
            <BadgeButton
              tooltip="Select parent"
              children={'select parent'}
              onClick={handleParentOnClick}
              onMouseEnter={handleParentOnMouseEnter}
              onMouseLeave={handleParentOnMouseLeave}
              icon={{ path: ICON_VARIANT_SELECT_PARENT.path }}
              TooltipProps={{ disableInteractive: true }}
            />
          )}

          {!isRootElementId($id) && <MoveUpButton node={node} />}
          {!isRootElementId($id) && <MoveDownButton node={node} />}

          <BadgeButton
            ref={moreButtonRef}
            tooltip="More options"
            children={'more options'}
            onClick={openMore}
            // onMouseEnter={handleParentOnMouseEnter}
            // onMouseLeave={handleParentOnMouseLeave}
            icon={{ path: ICON_VARIANT_SHOW_MORE.path }}
            TooltipProps={{ disableInteractive: true }}
          />
        </MuiButtonGroup>
        <Popper
          sx={{ zIndex: -1 }}
          open={Boolean(moreButton) && moreOpen}
          anchorEl={moreButton}
          role={undefined}
          transition
          disablePortal
        >
          {({ TransitionProps, placement }) => (
            <Grow
              {...TransitionProps}
              style={{
                transformOrigin:
                  placement === 'bottom' ? 'center top' : 'center bottom',
              }}
            >
              <Paper sx={{ bgcolor: 'secondary.main' }}>
                <ClickAwayListener onClickAway={closeMore}>
                  <MenuList
                    color="inherit"
                    id="split-button-menu"
                    dense
                    autoFocusItem
                  >
                    {!isRootElementId($id) && (
                      <MenuItem onClick={handleModifyClick}>
                        <ListItemIcon>
                          <MdiIcon path={ICON_VARIANT_MODIFY_EDIT.path} />
                        </ListItemIcon>
                        <ListItemText>{'Modify'}</ListItemText>
                      </MenuItem>
                    )}

                    {!isRootElementId($id) && (
                      <MenuItem onClick={handleDeleteClick}>
                        <ListItemIcon>
                          <MdiIcon path={ICON_VARIANT_MODIFY_DELETE.path} />
                        </ListItemIcon>
                        <ListItemText>{'Delete'}</ListItemText>
                      </MenuItem>
                    )}
                  </MenuList>
                </ClickAwayListener>
              </Paper>
            </Grow>
          )}
        </Popper>
      </>
    )
  }),
)
NodePinnedActions.displayName = 'NodePinnedActions'

export default NodePinnedActions
