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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import {
  BesignerPanelTabFlag,
  setBesignerPanels,
} from '@aglyn/besigner-data-app'
import { isRootElementId } from '@aglyn/core-util-app'
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
import { SrOnly, type SrOnlyProps } from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
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

export interface BadgeButtonProps extends Omit<TooltipProps, 'children'> {
  children?: SrOnlyProps['children']
  icon: MdiIconProps
  ButtonProps?: ButtonProps
  SrOnlyProps?: SrOnlyProps
}

export const BadgeButton = forwardRef<any, BadgeButtonProps>((props, ref) => {
  const { children, ButtonProps, icon, SrOnlyProps, ...rest } = props

  return (
    <MuiTooltip ref={ref} {...rest}>
      <MuiButton
        {...ButtonProps}
        sx={mergeSxProps(
          {
            py: 0.5,
            px: 0.585,
            fontSize: 16,
            minWidth: 24,
            '&.MuiButtonGroup-grouped': { minWidth: 30 },
          },
          ButtonProps?.sx,
        )}
      >
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

  return node?.index > 0 ? (
    <BadgeButton
      title="Move up"
      children={'move up'}
      ButtonProps={{ onClick: handleMoveUp }}
      icon={{ path: ICON_VARIANT_MODIFY_MOVE_UP.path }}
      disableInteractive
    />
  ) : null
})
const MoveDownButton = observer(({ node }: { node: Aglyn.NodeSchema }) => {
  const handleMoveDown = useCallback(
    (e: ChangeEvent<unknown>) => {
      Aglyn.canvas.reorderNode(node, node?.index + 1)
    },
    [node],
  )

  return node?.index < node?.parent?.nodes?.length - 1 ? (
    <BadgeButton
      title="Move down"
      children={'move down'}
      ButtonProps={{ onClick: handleMoveDown }}
      icon={{ path: ICON_VARIANT_MODIFY_MOVE_DOWN.path }}
      disableInteractive
    />
  ) : null
})

export interface ElementOverlayActionsProps extends ButtonGroupProps {
  $id: Aglyn.NodeId
}

const ElementOverlayActionsComponentRaw = (
  props: ElementOverlayActionsProps,
) => {
  const { $id, ...rest } = props

  const app = useBesignerAppContext()
  const node = Aglyn.canvas.getNode($id)
  const parent = node?.parent
  const elementRef = Besigner.refs.get($id)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreButton, moreButtonRef] = useState(null)

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

  return (
    <>
      <MuiButtonGroup
        id="aglyn:element-overlay-badge"
        data-aglyn-node={$id}
        data-aglyn-kind="overlay-actions"
        variant="contained"
        color="secondary"
        aria-label="element controls"
        sx={{
          boxShadow: 4,
          pointerEvents: 'auto',
        }}
        {...rest}
      >
        {!isRootElementId($id) && (
          <BadgeButton
            title="Drag"
            children="drag"
            sx={{ '&, &:hover, &:focus': { cursor: 'move' } }}
            // ref={dragHandleRef}
            ButtonProps={{
              // ref: elementRef?.dragHandle,
              ...elementRef?.dragHandle,
              sx: { '&, &:hover, &:focus': { cursor: 'move' } },
            }}
            icon={{ path: ICON_VARIANT_MODIFY_DRAG.path }}
            disableInteractive
          />
        )}

        {!isRootElementId($id) && (
          <BadgeButton
            title="Duplicate"
            children="duplicate"
            ButtonProps={{ onClick: handleDuplicateClick }}
            icon={{ path: ICON_VARIANT_MODIFY_DUPLICATE.path }}
            disableInteractive
          />
        )}

        {!isRootElementId($id) && (
          <BadgeButton
            title="Select parent"
            children={'select parent'}
            ButtonProps={{
              onClick: handleParentOnClick,
              onMouseEnter: handleParentOnMouseEnter,
              onMouseLeave: handleParentOnMouseLeave,
            }}
            icon={{ path: ICON_VARIANT_SELECT_PARENT.path }}
            disableInteractive
          />
        )}

        {!isRootElementId($id) && <MoveUpButton node={node} />}
        {!isRootElementId($id) && <MoveDownButton node={node} />}

        <BadgeButton
          ref={moreButtonRef}
          title="More options"
          children={'more options'}
          ButtonProps={{
            onClick: openMore,
            // onMouseEnter: handleParentOnMouseEnter,
            // onMouseLeave: handleParentOnMouseLeave,
          }}
          icon={{ path: ICON_VARIANT_SHOW_MORE.path }}
          disableInteractive
        />
      </MuiButtonGroup>
      <Popper
        sx={{ zIndex: 1 }}
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
                  color="secondary"
                  id="split-button-menu"
                  autoFocusItem
                >
                  {!isRootElementId($id) && (
                    <MenuItem dense onClick={handleModifyClick}>
                      <ListItemIcon>
                        <MdiIcon path={ICON_VARIANT_MODIFY_EDIT.path} />
                      </ListItemIcon>
                      <ListItemText>{'Modify'}</ListItemText>
                    </MenuItem>
                  )}

                  {!isRootElementId($id) && (
                    <MenuItem dense onClick={() => deleteElementCallback(node)}>
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
}
ElementOverlayActionsComponentRaw.displayName = 'ElementOverlayActionsComponent'
ElementOverlayActionsComponentRaw.aglyn = true

export const ElementOverlayActionsComponent = observer(
  ElementOverlayActionsComponentRaw,
)
export default ElementOverlayActionsComponent
