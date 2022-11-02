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
  ICON_VARIANT_COLLAPSIBLE_CLOSE,
  ICON_VARIANT_COLLAPSIBLE_OPEN,
  ICON_VARIANT_MODIFY_DRAG,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { alpha, styled } from '@aglyn/shared-ui-theme'
import generateComponentClassKeys from '@aglyn/shared-ui-theme/util/generate-component-class-keys'
import noop from '@aglyn/shared-util-tools/noop'
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
  type ListItemButtonProps as MuiListItemButtonProps,
  listItemClasses,
  ListItemIcon as MuiListItemIcon,
  type ListItemProps as MuiListItemProps,
  ListItemText as MuiListItemText,
  type ListProps as MuiListProps,
  Stack,
} from '@mui/material'
import clsx from 'clsx'
import { observer } from 'mobx-react-lite'
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

const TreeView = styled(MuiList)<MuiListProps>({
  alignItems: 'stretch',
  flexDirection: 'column',
  width: 'fit-content',
  minWidth: '100%',
})
TreeView.displayName = 'TreeView'

const TreeItem = styled(MuiListItem, {
  shouldForwardProp(propName) {
    return propName !== 'depth'
  },
})<MuiListItemProps & { depth: number }>((styles) => {
  const { theme, depth = 1 } = styles
  const depthOpacity = 0.2 - 1 / (1 << depth)
  return {
    alignItems: 'stretch',
    flexDirection: 'column',

    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,

    [`&:has(.${classKey.subTreeView}):has(.${listItemClasses.selected})`]: {
      backgroundColor: alpha(
        theme.palette.common.black,
        depthOpacity < 0 ? 0 : depthOpacity,
      ),
    },

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
        backgroundColor: alpha(
          theme.palette.secondary.dark,
          theme.palette.action.hoverOpacity + 0.2,
        ),
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: alpha(
            theme.palette.secondary.dark,
            theme.palette.action.focusOpacity + 0.3,
          ),
        },
      },
      [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
        backgroundColor: alpha(
          theme.palette.secondary.dark,
          theme.palette.action.focusOpacity + 0.2,
        ),
      },
    },
    [`&.${listItemClasses.selected}, &.${classKey.itemSelected}`]: {
      [`> .${classKey.treeListItem}`]: {
        backgroundColor: alpha(
          theme.palette.tertiary.main,
          theme.palette.action.selectedOpacity,
        ),

        [`&:hover, &.${classKey.itemHovered}`]: {
          backgroundColor: alpha(
            theme.palette.tertiary.main,
            theme.palette.action.selectedOpacity + 0.2,
          ),

          [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
            backgroundColor: alpha(
              theme.palette.tertiary.main,
              theme.palette.action.selectedOpacity + 0.2,
            ),
          },
        },
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: alpha(
            theme.palette.tertiary.main,
            theme.palette.action.activatedOpacity,
          ),
        },
      },
    },
  }
})
TreeItem.displayName = 'TreeItem'

const TreeItemButton = styled(MuiListItemButton, {
  shouldForwardProp(propName) {
    return propName !== 'depth'
  },
})<MuiListItemButtonProps & { depth: number }>((styles) => {
  const { theme, depth = 1 } = styles
  const shift = depth <= 1 ? (depth < 1 ? 0 : 0) : (depth - 1) * 23
  return {
    zIndex: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: shift,
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
  }
})
TreeItemButton.displayName = 'TreeItemButton'

interface NodeTreeItemProps
  extends Omit<JSX.ComponentProps<typeof TreeItem>, 'depth'> {
  nodeId: Aglyn.NodeId
}

const NodeTreeItem = observer((props: NodeTreeItemProps) => {
  const { nodeId, className, ...rest } = props
  const {
    expanded,
    selected,
    closeIcon,
    expandIcon,
    onItemSelect,
    onItemHover,
    onItemToggle,
    onItemFocus,
  } = useContext(TreeViewContext)
  const node = Aglyn.screen.getNode(nodeId)
  const schema = node?.componentSchema
  const nodeLabel = node?.labelShort
  const breadcrumbPath = node?.breadcrumbPath
  const depth = breadcrumbPath?.length - 1
  const isRootNode = Aglyn.screen.isRootNode(node)
  const dragAllowed = Aglyn.components.isFeatureEnabled(schema?.flags?.dragging)
  const collapseIn = expanded?.some((i) => i === nodeId)
  const isSelected = Besigner.focus.isNodeSelected(node)
  const dragDisabled = Boolean(isRootNode || !dragAllowed)

  const [{ isDragging }, dragHandle, dragPreview] = useLeafDrag(
    { $id: node?.$id, node },
    Besigner.dnd.DragType.TREE,
  )
  const [{ isOver }, dropRef] = useLeafDrop({
    $id: node?.$id,
    node,
    type: Besigner.dnd.DropAreaType.INSIDE,
  })

  return (
    <TreeItem
      // ref={mouseEnterRef}
      data-aglyn-node={nodeId}
      depth={depth}
      selected={isSelected}
      onMouseEnter={(e) => {
        onItemHover(e, nodeId)
      }}
      onFocus={(e) => {
        onItemFocus(e, nodeId)
      }}
      className={clsx(className, classKey.treeItem, {
        [classKey.itemSelected]: Besigner.focus.isNodeSelected(node),
        [classKey.itemHovered]: Besigner.focus.isNodeHovered(node),
        [classKey.itemIsDragging]: isDragging,
        [classKey.itemIsDragOver]: isOver,
      })}
      disablePadding
      sx={{ opacity: isDragging ? 0.5 : undefined }}
      {...rest}
    >
      <Stack
        ref={(e) => {
          dropRef(dragPreview(e as any))
        }}
        className={classKey.treeListItem}
        direction="row"
      >
        {!isRootNode && (
          <MuiListItemIcon
            ref={dragHandle}
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
        <TreeItemButton
          depth={depth}
          onClick={(e) => {
            onItemSelect(e, nodeId)
          }}
          onMouseOver={(e) => {
            // e.stopPropagation()
            // e.preventDefault()
            onItemHover(e, nodeId)
          }}
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
            <ComponentIconComponent component={schema} />
          </MuiListItemIcon>
          <MuiListItemText
            primary={nodeLabel}
            primaryTypographyProps={{
              noWrap: true,
              maxWidth: '180px',
              width: 'fit-content',
              textOverflow: 'ellipsis',
            }}
          />
        </TreeItemButton>
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
})
NodeTreeItem.displayName = 'NodeTreeItem'

const TreeViewContext = createContext<{
  expanded: Aglyn.NodeId[]
  selected: Aglyn.NodeId
  closeIcon?: JSX.Node
  expandIcon?: JSX.Node
  onItemSelect: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemToggle: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemHover: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemFocus: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
}>({
  expanded: [],
  selected: null,
  closeIcon: '●',
  expandIcon: '○',
  onItemSelect: noop,
  onItemToggle: noop,
  onItemHover: noop,
  onItemFocus: noop,
})

const TreeViewContent = observer(() => {
  const selected = Besigner.focus.state.selected
  const lastSelected = Besigner.focus.state.lastSelected
  const allExpanded = Besigner.focus.state.allExpanded

  const expanded = useMemo(() => {
    return allExpanded.reduce(
      (acc, item) => [...acc, ...(item?.breadcrumbPath || [])],
      [],
    )
  }, [allExpanded])

  const handleTreeItemToggle = useCallback((e, $id: Aglyn.NodeId) => {
    e.stopPropagation()
    e.preventDefault()
    Besigner.focus.toggleNodeExpansion(Aglyn.screen.getNode($id))
  }, [])

  const handleTreeItemSelect = useCallback((e, $id: Aglyn.NodeId) => {
    e.stopPropagation()
    e.preventDefault()
    const node = Aglyn.screen.getNode($id)
    Besigner.focus.toggleNodeExpansion(node)
    Besigner.focus.handleNodeSelection(node)
  }, [])

  const handleTreeItemHover = useCallback((e, $id: Aglyn.NodeId) => {
    Besigner.focus.setHoveredNode(Aglyn.screen.getNode($id))
  }, [])

  const handleTreeItemFocus = useCallback((e, $id: Aglyn.NodeId) => {
    e.stopPropagation()
    Besigner.focus.setHoveredNode(Aglyn.screen.getNode($id))
  }, [])

  return (
    <TreeViewContext.Provider
      value={{
        expanded: expanded,
        selected: lastSelected?.$id,
        closeIcon: (
          <MdiIcon
            fontSize="small"
            path={ICON_VARIANT_COLLAPSIBLE_CLOSE.path}
          />
        ),
        expandIcon: (
          <MdiIcon fontSize="small" path={ICON_VARIANT_COLLAPSIBLE_OPEN.path} />
        ),
        onItemFocus: handleTreeItemFocus,
        onItemHover: handleTreeItemHover,
        onItemSelect: handleTreeItemSelect,
        onItemToggle: handleTreeItemToggle,
      }}
    >
      <NodeTreeItem nodeId={Aglyn.NODE_ROOT_ID} />
    </TreeViewContext.Provider>
  )
})

export interface NodeTreeViewProps extends BoxProps {
  TreeViewProps?: Partial<Omit<JSX.ComponentProps<typeof TreeView>, 'children'>>
}

export const NodeTreeViewComponent = forwardRef<any, NodeTreeViewProps>(
  (props, ref) => {
    const { TreeViewProps, ...rest } = props

    return (
      <Box
        ref={ref}
        component="nav"
        id={'aglyn:node-tree-view'}
        aria-label="canvas nodes navigator"
        {...rest}
      >
        <TreeView className={classKey.root} {...TreeViewProps}>
          <TreeViewContent />
        </TreeView>
      </Box>
    )
  },
)

NodeTreeViewComponent.displayName = 'NodeTreeViewComponent'
NodeTreeViewComponent.aglyn = true
NodeTreeViewComponent.defaultProps = {}

export default NodeTreeViewComponent
