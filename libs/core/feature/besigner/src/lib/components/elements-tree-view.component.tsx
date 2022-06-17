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

import { DndDragSourceTypeFlag } from '@aglyn/besigner-data'
import { CANVAS_ROOT_ELEMENT_ID, type ElementId } from '@aglyn/core-data-framework'
import {
  useAglynCanvasElementHierarchy,
  useAglynComponentSchema,
  useAglynElementData,
  useAglynElementLabel,
} from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_COLLAPSABLE_CLOSE,
  ICON_VARIANT_COLLAPSABLE_OPEN,
  ICON_VARIANT_ENTITY_BLOCK,
  ICON_VARIANT_MODIFY_DRAG,
} from '@aglyn/shared-data-enums'
import { alpha, mergeSxProps, styled } from '@aglyn/shared-ui-theme'
import { isReactElement, useForkedRefs } from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { _isObjT } from '@aglyn/shared-util-guards'
import {
  type SingleSelectTreeViewProps,
  TreeItem as MuiTreeItem,
  treeItemClasses,
  type TreeItemProps,
  TreeView as MuiTreeView,
} from '@mui/lab'
import { Box, Button, Stack, Typography } from '@mui/material'
import { ChangeEvent, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getEmptyImage } from 'react-dnd-html5-backend'
import { useAglynCanvasSetHovered } from '../hooks/use-aglyn-canvas-hovered'
import useAglynCanvasSelected, {
  useAglynCanvasSetSelected,
} from '../hooks/use-aglyn-canvas-selected'
import useLeafDnd from '../hooks/use-leaf-dnd'

const TreeItem = styled(MuiTreeItem, { name: 'AglynTreeItem' })(({ theme }) => ({
  [`& .${treeItemClasses.content}`]: {
    borderTopLeftRadius: `50px`,
    borderBottomLeftRadius: `50px`,
    '&.Mui-focused': {
      backgroundColor: alpha(theme.palette.secondary.dark, theme.palette.action.focusOpacity),
    },
    '&.Mui-selected': {
      backgroundColor: alpha(theme.palette.quaternary.main, theme.palette.action.selectedOpacity),
    },
    '&.Mui-selected.Mui-focused': {
      backgroundColor: alpha(theme.palette.quaternary.main, theme.palette.action.activatedOpacity),
    },
  },
}))
const TreeView = styled(MuiTreeView, { name: 'AglynTreeView' })({
  overflow: 'auto',
  flexGrow: 1,
})

interface ElementsTreeItemComponentProps extends Partial<TreeItemProps> {
  $id: ElementId
}

const ElementsTreeItemComponent = forwardRef<
  any,
  ElementsTreeItemComponentProps & { dragHandleRef?: any; dragPreviewRef?: any }
>(function RefRenderFn(props, ref) {
  const { $id, dragHandleRef, dragPreviewRef, ...rest } = props,
    elements = useAglynElementData($id, 'elements') || [],
    componentId = useAglynElementData($id, 'componentId'),
    bundleId = useAglynElementData($id, 'bundleId'),
    label = useAglynElementLabel($id),
    icon = useAglynComponentSchema(componentId, bundleId)?.icon
  const setHovered = useAglynCanvasSetHovered()
  const setSelected = useAglynCanvasSetSelected()

  const handleOnMouseOver = useCallback(
    (e) => {
      e.stopPropagation()
      setHovered({ $id })
    },
    [$id, setHovered]
  )

  const handleOnMouseDown = useCallback(
    (e: ChangeEvent<any>) => {
      e.preventDefault()
      e.stopPropagation()
      setSelected((prev) => ({ $id: $id && prev?.$id === $id ? undefined : $id }))
    },
    [$id, setSelected]
  )

  const itemIcon = useMemo(() => {
    if (!icon?.path && icon && (!_isObjT(icon) || isReactElement(icon))) {
      return icon as any
    }

    return (
      <Box
        component="div"
        sx={mergeSxProps(
          {
            fontSize: 14,
            marginLeft: -0.5,
            marginRight: 0.75,
            padding: 0.2,
            borderRadius: '0.25em',
            backgroundColor: 'background.default',
            border: 1,
            borderColor: 'divider',
            boxShadow: 1,
            color: 'quaternary',
            display: 'flex',
            alignItems: 'center',
            flexDirection: 'column',
          },
          icon?.sx
        )}
      >
        <MdiIcon
          color="quaternary"
          fontSize="inherit"
          {...icon}
          path={icon?.path || ICON_VARIANT_ENTITY_BLOCK.path}
        />
      </Box>
    )
  }, [icon])

  return (
    <TreeItem
      ref={ref}
      nodeId={$id}
      collapseIcon={<MdiIcon path={ICON_VARIANT_COLLAPSABLE_CLOSE.path} />}
      expandIcon={<MdiIcon path={ICON_VARIANT_COLLAPSABLE_OPEN.path} />}
      onMouseOver={handleOnMouseOver}
      label={
        <Stack direction="row" alignItems="center">
          {itemIcon}
          <Typography component="div" sx={{ flexGrow: 1 }}>
            {label}
          </Typography>

          <Button
            component="div"
            color="inherit"
            ref={dragHandleRef}
            onMouseDown={handleOnMouseDown}
            sx={{
              fontSize: 16,
              padding: 0.5,
              marginLeft: 0.5,
              backgroundColor: 'transparent',
              color: 'tertiary.main',
              display: 'flex',
              alignItems: 'center',
              flexDirection: 'column',
              minWidth: 'unset',
            }}
          >
            <MdiIcon color="inherit" fontSize="inherit" path={ICON_VARIANT_MODIFY_DRAG.path} />
          </Button>
        </Stack>
      }
      {...rest}
    >
      {elements.map(($id) => (
        <DraggableTreeItemComponent key={$id} $id={$id} />
      ))}
    </TreeItem>
  )
})

const DraggableTreeItemComponent = forwardRef<any, ElementsTreeItemComponentProps>(
  function RefRenderFn(props, ref) {
    const { $id, ...rest } = props
    const elemRef = useRef<Element>(null)
    const [dragHandleRef, dragPreviewRef, dropRef] = useLeafDnd($id, {
      dragType: DndDragSourceTypeFlag.TREE_ELEMENT,
    })

    useEffect(() => {
      dragPreviewRef(getEmptyImage(), { captureDraggingState: true })
    }, [dragPreviewRef])
    return (
      <ElementsTreeItemComponent
        ref={useForkedRefs(ref, elemRef, dragHandleRef, dropRef)}
        // dragPreviewRef={dragPreviewRef}
        // dragHandleRef={dragHandleRef}
        $id={$id}
        {...rest}
      />
    )
  }
)
DraggableTreeItemComponent.displayName = 'DraggableTreeItemComponent'

export interface ElementsTreeViewComponentProps extends Partial<SingleSelectTreeViewProps> {}

export const ElementsTreeViewComponent = forwardRef<any, ElementsTreeViewComponentProps>(
  function RefRenderFn(props, ref) {
    const { children, ...rest } = props
    const [selected, setSelected] = useAglynCanvasSelected()
    const setHovered = useAglynCanvasSetHovered()
    const selectedHierarchy = useAglynCanvasElementHierarchy(selected?.$id)
    const [expanded, setExpanded] = useState<ElementId[]>([])
    const allExpanded = useMemo(
      () => [...selectedHierarchy, ...expanded],
      [selectedHierarchy, expanded]
    )

    const handleTreeItemSelect = useCallback(
      (e, $id) => {
        e.stopPropagation()
        e.preventDefault()
        setSelected((prev) => ({ $id: $id && prev?.$id === $id ? undefined : $id }))
      },
      [setSelected]
    )

    const handleTreeItemFocus = useCallback(
      (e, $id) => {
        e.stopPropagation()
        setHovered({ $id })
      },
      [setHovered]
    )

    const handleTreeItemToggle = useCallback((e, ids: ElementId[]) => {
      e.stopPropagation()
      e.preventDefault()
      setExpanded(ids)
    }, [])

    return (
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
        {children}
        <DraggableTreeItemComponent key={CANVAS_ROOT_ELEMENT_ID} $id={CANVAS_ROOT_ELEMENT_ID} />
      </TreeView>
    )
  }
)

ElementsTreeViewComponent.displayName = 'ElementsTreeViewComponent'
ElementsTreeViewComponent.aglyn = true
ElementsTreeViewComponent.defaultProps = {}

export default ElementsTreeViewComponent
