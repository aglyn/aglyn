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

import { DndDragType } from '@aglyn/besigner-data-app'
import { getComponentSchema } from '@aglyn/core-data-app'
import {
  CANVAS_ROOT_ELEMENT_ID,
  type NodeId,
} from '@aglyn/core-data-foundation'
import {
  useAglynAppContext,
  useAglynCanvasElementHierarchy,
  useAglynElementData,
  useAglynElementLabel,
} from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_COLLAPSIBLE_CLOSE,
  ICON_VARIANT_COLLAPSIBLE_OPEN,
  ICON_VARIANT_MODIFY_DRAG,
} from '@aglyn/shared-data-enums'
import { useForkedRefs } from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { alpha, styled } from '@aglyn/shared-ui-theme'
import {
  type SingleSelectTreeViewProps,
  TreeItem as MuiTreeItem,
  treeItemClasses,
  type TreeItemProps as MuiTreeItemProps,
  TreeView as MuiTreeView,
  type TreeViewProps as MuiTreeViewProps,
} from '@mui/lab'
import { Box, Button, Stack, Typography } from '@mui/material'
import { ChangeEvent, forwardRef, useCallback, useMemo, useState } from 'react'
import { useAglynCanvasSetHovered } from '../hooks/use-aglyn-canvas-hovered'
import useAglynCanvasSelected, {
  useAglynCanvasSetSelected,
} from '../hooks/use-aglyn-canvas-selected'
import useLeafDrag from '../hooks/use-leaf-drag'
import useLeafDrop from '../hooks/use-leaf-drop'
import ElementIconComponent from './element-icon.component'

const TreeView = styled(MuiTreeView)<MuiTreeViewProps>({
  // overflow: 'auto',
  // flexGrow: 1,
})
const TreeItem = styled(MuiTreeItem)<MuiTreeItemProps>(({ theme }) => ({
  [`& > .${treeItemClasses.group}`]: {
    minWidth: '100%',
    width: 'unset',
    borderLeft: `1px solid ${theme.palette.divider}`,
    marginLeft: theme.spacing(1.75),
  },
  [`& .${treeItemClasses.content}`]: {
    borderTopLeftRadius: `50px`,
    borderBottomLeftRadius: `50px`,
    [`&.${treeItemClasses.focused}`]: {
      backgroundColor: alpha(
        theme.palette.secondary.dark,
        theme.palette.action.focusOpacity + 0.1,
      ),
      [`&:hover`]: {
        backgroundColor: alpha(
          theme.palette.secondary.dark,
          theme.palette.action.focusOpacity + 0.2,
        ),
      },
    },
    [`&.${treeItemClasses.selected}`]: {
      backgroundColor: alpha(
        theme.palette.tertiary.main,
        theme.palette.action.selectedOpacity,
      ),
      [`&:hover`]: {
        backgroundColor: alpha(
          theme.palette.tertiary.main,
          theme.palette.action.selectedOpacity + 0.2,
        ),
      },
    },
    [`&.${treeItemClasses.selected}.${treeItemClasses.focused}`]: {
      backgroundColor: alpha(
        theme.palette.tertiary.main,
        theme.palette.action.activatedOpacity,
      ),
      [`&:hover`]: {
        backgroundColor: alpha(
          theme.palette.tertiary.main,
          theme.palette.action.selectedOpacity + 0.2,
        ),
      },
    },
  },
}))

interface ElementsTreeItemComponentProps extends Partial<MuiTreeItemProps> {
  $id: NodeId
}

const DraggableTreeItemComponent = forwardRef<
  any,
  ElementsTreeItemComponentProps
>((props, ref) => {
  const { $id, ...rest } = props
  const app = useAglynAppContext()
  const componentId = useAglynElementData($id, 'componentId')
  const bundleId = useAglynElementData($id, 'bundleId')
  const trail = useAglynCanvasElementHierarchy($id)
  const dndData = useMemo(() => {
    const componentSchema = getComponentSchema(app, { componentId, bundleId })
    return {
      $id,
      componentId,
      bundleId,
      trail,
      restrictParent: componentSchema?.restrictParent,
      restrictChildren: componentSchema?.restrictChildren,
    }
  }, [app, componentId, bundleId, $id, trail])
  const [, dragHandle, dragPreview] = useLeafDrag(dndData, DndDragType.TREE)
  const [, dropRef] = useLeafDrop(dndData)
  const elements = useAglynElementData($id, 'elements')
  const label = useAglynElementLabel($id)
  const setHovered = useAglynCanvasSetHovered()
  const setSelected = useAglynCanvasSetSelected()

  const handleOnMouseOver = useCallback(
    (e) => {
      e.stopPropagation()
      setHovered({ $id })
    },
    [$id, setHovered],
  )

  const handleOnMouseDown = useCallback((e: ChangeEvent<any>) => {
    // e.preventDefault()
    // e.stopPropagation()
    // setSelected((prev) => ({
    //   $id: $id && prev?.$id === $id ? undefined : $id,
    // }))
  }, [])

  return (
    <TreeItem
      ref={useForkedRefs(ref, dropRef)}
      nodeId={$id}
      collapseIcon={<MdiIcon path={ICON_VARIANT_COLLAPSIBLE_CLOSE.path} />}
      expandIcon={<MdiIcon path={ICON_VARIANT_COLLAPSIBLE_OPEN.path} />}
      onMouseOver={handleOnMouseOver}
      label={
        <Stack ref={dragPreview} direction="row" alignItems="center">
          <Button
            component="div"
            color="inherit"
            ref={dragHandle}
            // onMouseDown={handleOnMouseDown}
            sx={{
              fontSize: 16,
              padding: 0.5,
              marginLeft: -0.5,
              marginRight: 0.5,
              backgroundColor: 'transparent',
              color: 'text.secondary',
              display: 'flex',
              alignItems: 'center',
              flexDirection: 'column',
              minWidth: 'unset',
            }}
          >
            <MdiIcon
              color="inherit"
              fontSize="inherit"
              path={ICON_VARIANT_MODIFY_DRAG.path}
            />
          </Button>
          <Box
            component="div"
            sx={{
              fontSize: 14,
              marginLeft: -0.5,
              marginRight: 0.75,
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
            <ElementIconComponent $id={$id} />
          </Box>

          <Typography component="div" noWrap>
            {label as string}
          </Typography>
        </Stack>
      }
      {...rest}
    >
      {elements?.map(($id) => (
        <DraggableTreeItemComponent key={$id} $id={$id} />
      ))}
    </TreeItem>
  )
})
DraggableTreeItemComponent.displayName = 'DraggableTreeItemComponent'

export interface ElementsTreeViewComponentProps
  extends Partial<SingleSelectTreeViewProps> {}

export const ElementsTreeViewComponent = forwardRef<
  any,
  ElementsTreeViewComponentProps
>((props, ref) => {
  const { children, ...rest } = props
  const [selected, setSelected] = useAglynCanvasSelected()
  const setHovered = useAglynCanvasSetHovered()
  const selectedHierarchy = useAglynCanvasElementHierarchy(selected?.$id)
  const [manuallyExpanded, setManuallyExpanded] = useState<NodeId[]>([])

  const allExpanded = useMemo(
    () => [...selectedHierarchy, ...manuallyExpanded],
    [selectedHierarchy, manuallyExpanded],
  )

  const handleTreeItemSelect = useCallback(
    (e, $id) => {
      e.stopPropagation()
      e.preventDefault()
      setSelected((prev) => ({
        $id: $id && prev?.$id === $id ? undefined : $id,
      }))
    },
    [setSelected],
  )

  const handleTreeItemFocus = useCallback(
    (e, $id) => {
      e.stopPropagation()
      setHovered({ $id })
    },
    [setHovered],
  )

  const handleTreeItemToggle = useCallback(
    (e, ids: NodeId[]) => {
      e.stopPropagation()
      e.preventDefault()
      setManuallyExpanded(ids)
    },
    [setManuallyExpanded],
  )

  return (
    <>
      {children}

      <TreeView
        ref={ref}
        id={'aglyn:tree-view'}
        aria-label="canvas elements navigator"
        onNodeSelect={handleTreeItemSelect}
        onNodeFocus={handleTreeItemFocus}
        onNodeToggle={handleTreeItemToggle}
        selected={selected?.$id ?? ''}
        expanded={allExpanded}
        {...rest}
      >
        <DraggableTreeItemComponent
          key={CANVAS_ROOT_ELEMENT_ID}
          $id={CANVAS_ROOT_ELEMENT_ID}
        />
      </TreeView>
    </>
  )
})

ElementsTreeViewComponent.displayName = 'ElementsTreeViewComponent'
ElementsTreeViewComponent.aglyn = true
ElementsTreeViewComponent.defaultProps = {}

export default ElementsTreeViewComponent
