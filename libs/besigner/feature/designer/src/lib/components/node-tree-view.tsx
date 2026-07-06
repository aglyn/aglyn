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
  ICON_VARIANT_COLLAPSIBLE_CLOSE,
  ICON_VARIANT_COLLAPSIBLE_OPEN,
  ICON_VARIANT_MODIFY_DRAG,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { noop } from '@aglyn/shared-util-tools'
import {
  Box,
  BoxProps,
  Collapse,
  Divider,
  IconButton,
  List as MuiList,
  ListItem as MuiListItem,
  ListItemButton as MuiListItemButton,
  listItemButtonClasses,
  listItemClasses,
  ListItemIcon as MuiListItemIcon,
  type ListItemIconProps as MuiListItemIconProps,
  type ListItemProps as MuiListItemProps,
  ListItemText as MuiListItemText,
  type ListProps as MuiListProps,
  Stack,
} from '@mui/material'
import clsx from 'clsx'
import uniq from 'lodash-es/uniq'
import { observer } from 'mobx-react-lite'
import type { ComponentProps } from 'react'
import {
  type ChangeEvent,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import useLeafDrag from '../hooks/use-leaf-drag'
import useLeafDrop from '../hooks/use-leaf-drop'
import ComponentIconComponent from './component-icon.component'

const classKey = generateComponentClassKeys('TreeView', [
  'root',
  'subTreeView',
  'treeItem',
  'treeListItem',
  'dragHandle',
  'itemSelected',
  'itemHovered',
  'itemIsDragging',
  'itemIsDragOver',
])

const TreeView = styled(MuiList)<MuiListProps>(({ theme }) => ({
  alignItems: 'stretch',
  flexDirection: 'column',
  width: 'fit-content',
  minWidth: '100%',

  [`& .${listItemButtonClasses.root}`]: {
    zIndex: 0,
    paddingTop: 0,
    paddingBottom: 0,
    // paddingLeft: 0,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    [[
      `&:hover`,
      `&.${listItemButtonClasses.focusVisible}`,
      `&.${listItemButtonClasses.selected}`,
      `&.${classKey.itemSelected}`,
    ].join(',')]: {
      backgroundColor: 'transparent',
    },
  },

  [`& .${listItemClasses.root}`]: {
    alignItems: 'stretch',
    flexDirection: 'column',

    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,

    [`> .${classKey.treeListItem}`]: {
      borderTopLeftRadius: 4,
      borderBottomLeftRadius: 4,
      [`& .${classKey.dragHandle}`]: {
        visibility: 'hidden',
      },

      [`&:hover, &.${classKey.itemHovered}`]: {
        [`& .${classKey.dragHandle}`]: {
          visibility: 'visible',
        },
        backgroundColor: `rgba(${(theme as any).vars.palette.secondary.darkChannel} / calc(${(theme as any).vars.palette.action.hoverOpacity} + 0.2))`,
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.secondary.darkChannel} / calc(${(theme as any).vars.palette.action.focusOpacity} + 0.3))`,
        },
      },
      [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
        backgroundColor: `rgba(${(theme as any).vars.palette.secondary.darkChannel} / calc(${(theme as any).vars.palette.action.focusOpacity} + 0.2))`,
      },
    },
    [`&.${classKey.itemSelected}`]: {
      [`> .${classKey.treeListItem}`]: {
        backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / ${(theme as any).vars.palette.action.selectedOpacity})`,

        [`&:hover, &.${classKey.itemHovered}`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / calc(${(theme as any).vars.palette.action.selectedOpacity} + 0.2))`,

          [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
            backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / calc(${(theme as any).vars.palette.action.selectedOpacity} + 0.2))`,
          },
        },
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / ${(theme as any).vars.palette.action.activatedOpacity})`,
        },
      },
    },
  },
}))
TreeView.displayName = 'TreeView'

const TreeItem = styled(MuiListItem, {
  shouldForwardProp(propName) {
    return propName !== 'depth'
  },
})<MuiListItemProps & { depth: number }>((styles) => {
  const { theme, depth = 1 } = styles
  const depthOpacity = 0.2 - 1 / (1 << depth)
  return {
    [`&:has(.${classKey.subTreeView}):has(.${classKey.itemSelected})`]: {
      backgroundColor: `rgba(0 0 0 / ${depthOpacity < 0 ? 0 : depthOpacity})`,
    },
  }
})
TreeItem.displayName = 'TreeItem'

interface DragHandleProps extends MuiListItemIconProps {
  draggingEnabled?: boolean
}

const DragHandle = styled(MuiListItemIcon, {
  shouldForwardProp(propName) {
    return propName !== 'draggingEnabled'
  },
})<DragHandleProps>(({ theme, draggingEnabled }) => ({
  minWidth: 23,
  padding: theme.spacing(0.75),
  paddingLeft: 0,
  borderRadius: '4px',
  cursor: 'move',
  pointerEvents: !draggingEnabled ? 'none' : undefined,
  opacity: !draggingEnabled ? 0.5 : undefined,
  zIndex: 1,
}))
DragHandle.displayName = 'DragHandle'

interface NodeTreeItemProps
  extends Omit<ComponentProps<typeof TreeItem>, 'depth'> {
  nodeId: Aglyn.NodeId
}

const NodeTreeItem = observer(
  forwardRef<any, NodeTreeItemProps>((props, ref) => {
    const { nodeId, className, ...rest } = props
    const {
      expanded,
      closeIcon,
      expandIcon,
      onItemSelect,
      onItemHover,
      onItemToggle,
      onItemFocus,
    } = useContext(TreeViewContext)
    // console.log('NodeTreeItem', [...expanded])
    const node = Aglyn.canvas.getNode(nodeId)
    const schema = node?.componentSchema
    const nodeLabel = node?.labelShort
    const breadcrumbPath = node?.breadcrumbPath || []
    const depth = breadcrumbPath?.length - 1
    const isRootNode = Aglyn.canvas.isRootNode(node)
    const dragAllowed = Aglyn.isFeatureEnabled(schema?.flags?.dragging)
    const collapseIn = expanded?.some((i) => i === nodeId)
    const isSelected = Besigner.focus.isNodeSelected(node)
    const isHovered = Besigner.focus.isNodeHovered(node)
    const dragDisabled = Boolean(isRootNode || !dragAllowed)

    const {
      attributes: dragAttributes,
      transform,
      isDragging,
      setNodeRef: setDraggableNodeRef,
      listeners: draggableListeners,
    } = useLeafDrag(node, Besigner.DragType.TREE)
    const style = transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          cursor: 'grab',
          opacity: 0.5,
        }
      : undefined
    const { setNodeRef: setDroppableNodeRef, isOver } = useLeafDrop(
      node,
      undefined,
      'tree',
    )

    if (!node) return <>'Invalid node'</>
    return (
      <TreeItem
        ref={ref}
        // ref={setDraggableNodeRef}
        data-aglyn-node={nodeId}
        {...dragAttributes}
        depth={depth}
        onMouseEnter={(e) => onItemHover(e, nodeId)}
        onFocus={(e) => onItemFocus(e, nodeId)}
        className={clsx(className, classKey.treeItem, {
          [classKey.itemSelected]: isSelected,
          [classKey.itemHovered]: isHovered,
          [classKey.itemIsDragging]: isDragging,
          [classKey.itemIsDragOver]: isOver,
        })}
        disablePadding
        style={style}
        {...rest}
      >
        <Stack
          ref={(e: any) => {
            setDraggableNodeRef(e)
            setDroppableNodeRef(e)
          }}
          className={classKey.treeListItem}
          direction="row"
        >
          {!isRootNode && (
            <MuiListItemIcon
              {...draggableListeners}
              className={classKey.dragHandle}
              draggable
              sx={{
                minWidth: 23,
                padding: 0.75,
                pl: 0,
                borderRadius: '4px',
                cursor: 'move',
                pointerEvents: dragDisabled ? 'none' : undefined,
                opacity: dragDisabled ? 0.5 : undefined,
                zIndex: 1,
              }}
            >
              <MdiIcon
                color="inherit"
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_DRAG.path}
              />
            </MuiListItemIcon>
          )}
          <MuiListItemButton
            sx={{
              paddingLeft: `${
                depth <= 1 ? (depth < 1 ? 0 : 0) : (depth - 1) * 23
              }px`,
            }}
            onClick={(e) => onItemSelect(e, nodeId)}
            onMouseOver={(e) => onItemHover(e, nodeId)}
            dense
          >
            <MuiListItemIcon sx={{ minWidth: 20, mr: '1px' }}>
              <IconButton
                color="default"
                sx={{
                  padding: '2px',
                  visibility: !node?.hasNodes ? 'hidden' : 'visible',
                }}
                disabled={!node?.hasNodes}
                onClick={(e) => onItemToggle(e, nodeId)}
              >
                {collapseIn ? closeIcon : expandIcon}
              </IconButton>
            </MuiListItemIcon>
            <MuiListItemIcon
              sx={{
                minWidth: 20,
                mr: 0.5,
                fontSize: 14,
                padding: 0.2,
                borderRadius: '0.25em',
                backgroundColor: 'background.default',
                border: 1,
                borderColor: 'divider',
                boxShadow: 1,
                color: 'tertiary',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
              }}
            >
              <ComponentIconComponent component={node?.componentSchema} />
            </MuiListItemIcon>
            <MuiListItemText
              primary={nodeLabel}
              slotProps={{
                primary: {
                  noWrap: true,
                  sx: { maxWidth: '180px', width: 'fit-content', textOverflow: 'ellipsis' },
                },
              }}
            />
          </MuiListItemButton>
        </Stack>

        {node?.hasNodes && (
          <Box className={classKey.subTreeView} sx={{ position: 'relative' }}>
            <Divider
              orientation="vertical"
              sx={{
                position: 'absolute',
                height: 1,
                left: `${
                  depth <= 1 ? (depth < 1 ? 20 - 9 : 34) : depth * 23 + 11
                }px`,
                zIndex: 0,
                pointerEvents: 'none',
              }}
              // flexItem
            />
            <Collapse unmountOnExit in={collapseIn}>
              <TreeView disablePadding>
                {node?.nodes?.map((nodeId) => (
                  <NodeTreeItem key={nodeId} nodeId={nodeId} />
                ))}
              </TreeView>
            </Collapse>
          </Box>
        )}
      </TreeItem>
    )
  }),
)
NodeTreeItem.displayName = 'NodeTreeItem'

const TreeViewContext = createContext<{
  expanded: Aglyn.NodeId[]
  // selected: Aglyn.NodeId
  closeIcon?: JSX.Node
  expandIcon?: JSX.Node
  onItemSelect: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemToggle: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemHover: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemFocus: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
}>({
  expanded: [],
  // selected: null,
  closeIcon: '●',
  expandIcon: '○',
  onItemSelect: noop,
  onItemToggle: noop,
  onItemHover: noop,
  onItemFocus: noop,
})

export interface NodeTreeViewProps extends BoxProps {
  TreeViewProps?: Partial<Omit<ComponentProps<typeof TreeView>, 'children'>>
}

const CloseIcon = (
  <MdiIcon fontSize="small" path={ICON_VARIANT_COLLAPSIBLE_CLOSE.path} />
)
const ExpandIcon = (
  <MdiIcon fontSize="small" path={ICON_VARIANT_COLLAPSIBLE_OPEN.path} />
)

export const NodeTreeView = observer(
  forwardRef<any, NodeTreeViewProps>((props, ref) => {
    const { TreeViewProps, ...rest } = props
    const allExpanded = Besigner.focus.getAllExpanded()
    const manuallyCollapsed = Besigner.focus.getManuallyCollapsed()

    const expanded = useMemo(() => {
      const paths = allExpanded.reduce((acc, i) => {
        return [...acc, ...(i?.breadcrumbPath || [])]
      }, [])
      return uniq(paths).filter((id) => !manuallyCollapsed.includes(id))
    }, [allExpanded, manuallyCollapsed])

    const handleTreeItemToggle = useCallback((e, $id: Aglyn.NodeId) => {
      e.stopPropagation()
      e.preventDefault()
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      Besigner.focus.toggleNodeExpansion(node)
    }, [])

    const handleTreeItemSelect = useCallback((e, $id: Aglyn.NodeId) => {
      e.stopPropagation()
      e.preventDefault()
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      Besigner.focus.handleNodeSelection(node)
    }, [])

    const handleTreeItemHover = useCallback((e, $id: Aglyn.NodeId) => {
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      Besigner.focus.setHoveredNode(node)
    }, [])

    const handleTreeItemFocus = useCallback((e, $id: Aglyn.NodeId) => {
      e.stopPropagation()
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      Besigner.focus.setHoveredNode(node)
    }, [])

    return (
      <TreeViewContext.Provider
        value={{
          expanded: expanded,
          closeIcon: CloseIcon,
          expandIcon: ExpandIcon,
          onItemFocus: handleTreeItemFocus,
          onItemHover: handleTreeItemHover,
          onItemSelect: handleTreeItemSelect,
          onItemToggle: handleTreeItemToggle,
        }}
      >
        <Box
          ref={ref}
          component="nav"
          id={'aglyn:node-tree-view'}
          aria-label="canvas nodes navigator"
          {...rest}
        >
          <TreeView className={classKey.root} {...TreeViewProps}>
            <NodeTreeItem nodeId={Aglyn.NODE_ROOT_ID} />
          </TreeView>
        </Box>
      </TreeViewContext.Provider>
    )
  }),
)

NodeTreeView.displayName = 'NodeTreeView'
NodeTreeView.aglyn = true

export default NodeTreeView
