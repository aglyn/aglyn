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

import {
  CANVAS_ROOT_ELEMENT_ID,
  DEFAULT_COMPONENT_ICON_ID,
  ElementId,
  setBuilderCanvasHovered,
  setBuilderCanvasSelected,
} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynCanvasElementHierarchy,
  useAglynComponentSchema,
  useAglynElementData,
  useAglynElementLabel,
} from '@aglyn/feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import MuiTreeItem, { TreeItemProps } from '@mui/lab/TreeItem'
import MuiTreeView, { SingleSelectTreeViewProps } from '@mui/lab/TreeView'
import { forwardRef, Fragment, useCallback, useMemo } from 'react'
import useAglynCanvasSelected from '../hooks/use-aglyn-canvas-selected'

const TreeItemIcon = styled(SvgPathIcon, {
  name: 'AglynTreeItemIcon',
})(({ theme }) => ({
  fontSize: theme.typography.pxToRem(20),
  marginLeft: theme.spacing(-0.25),
  marginRight: theme.spacing(0.35),
  marginBottom: theme.spacing(-0.5),
  padding: theme.spacing(0.26),
  borderRadius: '0.25em',
  backgroundColor: theme.palette.background.default,
  border: `1px solid ${theme.palette.divider}`,
  color: theme.palette.quaternary.main,
}))
const ScrollableTreeView = styled(MuiTreeView, { name: 'AglynScrollableTreeView' })({
  overflow: 'auto',
  flexGrow: 1,
})

interface ElementsTreeItemComponentProps extends Partial<TreeItemProps> {
  $id: ElementId
}

const ElementsTreeItemComponent = forwardRef<any, ElementsTreeItemComponentProps>(
  function RefRenderFn(props, ref) {
    const { $id, ...rest } = props
    const elements = useAglynElementData($id, 'elements')
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const label = useAglynElementLabel($id)
    const iconIds = useAglynComponentSchema(componentId, bundleId)?.metadata?.iconIds
    return (
      <>
        <MuiTreeItem
          ref={ref}
          nodeId={$id}
          label={
            <Fragment>
              <TreeItemIcon iconIds={iconIds || DEFAULT_COMPONENT_ICON_ID} />
              {label}
            </Fragment>
          }
          {...rest}
        >
          {elements.map(($id) => (
            <ElementsTreeItemComponent key={$id} $id={$id} />
          ))}
        </MuiTreeItem>
      </>
    )
  }
)

export interface ElementsTreeViewComponentProps extends Partial<SingleSelectTreeViewProps> {}

export const ElementsTreeViewComponent = forwardRef<any, ElementsTreeViewComponentProps>(
  function RefRenderFn(props, ref) {
    const { children, ...rest } = props

    const { getApp } = useAglynAppContext()
    const elements = useAglynElementData(CANVAS_ROOT_ELEMENT_ID, 'elements')
    const selected = useAglynCanvasSelected()
    const selectedId = selected?.$id
    const selectedIdHierarchy = useAglynCanvasElementHierarchy(selectedId)

    const defaultExpanded = useMemo(
      () => selectedIdHierarchy.filter((id) => id !== CANVAS_ROOT_ELEMENT_ID),
      [selectedIdHierarchy]
    )
    const handleTreeItemSelect = useCallback((e, $id) => {
      console.log('handleTreeItemSelect $id', $id)
      setBuilderCanvasSelected(getApp(), { selected: { $id } })
    }, [])
    const handleTreeItemFocus = useCallback((e, $id) => {
      console.log('handleTreeItemFocus $id', $id)
      setBuilderCanvasHovered(getApp(), { hovered: { $id } })
    }, [])

    return (
      <ScrollableTreeView
        ref={ref}
        aria-label="canvas elements navigator"
        onNodeSelect={handleTreeItemSelect}
        onNodeFocus={handleTreeItemFocus}
        selected={selectedId ?? ''}
        expanded={defaultExpanded}
        defaultCollapseIcon={<SvgPathIcon iconIds={'chevron-down'} />}
        defaultExpandIcon={<SvgPathIcon iconIds={'chevron-right'} />}
        {...rest}
      >
        {elements.map(($id) => (
          <ElementsTreeItemComponent key={$id} $id={$id} />
        ))}

        {children}
      </ScrollableTreeView>
    )
  }
)

ElementsTreeViewComponent.displayName = 'ElementsTreeViewComponent'
ElementsTreeViewComponent.defaultProps = {}

export default ElementsTreeViewComponent
