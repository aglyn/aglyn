/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import Typography from '@aglyn/plugins-ui-mui/components/typography'
import {
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_DUPLICATE,
  ICON_VARIANT_MODIFY_MOVE_DOWN,
  ICON_VARIANT_MODIFY_MOVE_UP,
} from '@aglyn/shared-data-enums'
import MdiIcon from '@aglyn/shared-ui-mdi-jsx/components/mdi-icon'
import {
  alpha,
  Divider,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Paper,
  PaperProps,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { ChangeEvent, useCallback, useState } from 'react'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'
import useBesignerAppContext from '../hooks/use-besigner-app-context'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'

export interface NodeContextMenuProps extends PaperProps {
  node: Aglyn.NodeSchema<any>
}

export const NodeContextMenu = observer((props: NodeContextMenuProps) => {
  const { node, ...rest } = props

  const isRootNode = Aglyn.canvas.isRootNode(node)
  const app = useBesignerAppContext()
  const handleAddElementClick = useAddElementDrawerCallback()
  const elementRef = Besigner.refs.get(node?.$id)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreButton, moreButtonRef] = useState(null)

  const closeMore = useCallback(() => setMoreOpen(false), [])
  const openMore = useCallback(() => setMoreOpen(true), [])

  const handleDuplicateClick = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (isRootNode) return
      Aglyn.canvas.duplicateNode(node)
    },
    [node, isRootNode],
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
  const handleMoveUp = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (isRootNode) return
      Aglyn.canvas.reorderNode(node, node?.index - 1)
    },
    [node, isRootNode],
  )
  const handleMoveDown = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (isRootNode) return
      Aglyn.canvas.reorderNode(node, node?.index + 1)
    },
    [node, isRootNode],
  )

  const handleParentOnClick = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (isRootNode) return
      Besigner.focus.setSelectedNode(node?.parent)
    },
    [node, isRootNode],
  )

  const handleParentOnMouseEnter = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (isRootNode) return
      Besigner.focus.setHoveredNode(node)
    },
    [node, isRootNode],
  )
  const handleParentOnMouseLeave = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (isRootNode) return
      Besigner.focus.clearHover()
    },
    [isRootNode],
  )

  const deleteElementCallback = useDeleteElementCallback()

  return (
    <Paper sx={{ width: 240, overflow: 'hidden' }} {...rest}>
      <MenuList dense>
        <Typography
          variant="caption"
          color="text.secondary"
          align="center"
          textOverflow="ellipsis"
          component="div"
          bgcolor="primary.dark"
          px={1}
          py={0.15}
          mb={1}
          sx={{
            backgroundColor: (theme) => alpha(theme.palette.primary.dark, 0.12),
          }}
        >
          {node?.labelShort}
        </Typography>
        <MenuItem onClick={() => handleAddElementClick(node)}>
          <ListItemText inset>Add element</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={handleParentOnClick}
          disabled={isRootNode}
          onMouseEnter={handleParentOnMouseEnter}
          onPointerEnter={handleParentOnMouseEnter}
          onMouseLeave={handleParentOnMouseLeave}
          onPointerLeave={handleParentOnMouseLeave}
        >
          <ListItemText inset>Select parent</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={handleMoveUp}
          disabled={isRootNode || !(node?.index > 0)}
        >
          <ListItemIcon>
            <MdiIcon
              fontSize="inherit"
              path={ICON_VARIANT_MODIFY_MOVE_UP.path}
            />
          </ListItemIcon>
          <ListItemText>Shift up</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={handleMoveDown}
          disabled={
            isRootNode || !(node?.index < node?.parent?.nodes?.length - 1)
          }
        >
          <ListItemIcon>
            <MdiIcon
              fontSize="inherit"
              path={ICON_VARIANT_MODIFY_MOVE_DOWN.path}
            />
          </ListItemIcon>
          <ListItemText>Shift down</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem disabled={isRootNode} onClick={handleDuplicateClick}>
          <ListItemIcon>
            <MdiIcon
              fontSize="inherit"
              path={ICON_VARIANT_MODIFY_DUPLICATE.path}
            />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={isRootNode}
          onClick={() => deleteElementCallback(node)}
        >
          <ListItemIcon>
            <MdiIcon
              fontSize="inherit"
              path={ICON_VARIANT_MODIFY_DELETE.path}
            />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </MenuList>
    </Paper>
  )
})
NodeContextMenu.displayName = 'NodeContextMenu'

export default NodeContextMenu
