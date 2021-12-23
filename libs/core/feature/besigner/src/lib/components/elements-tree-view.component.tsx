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
  ElementId,
  setBesignerCanvasHovered,
  setBesignerCanvasSelected,
} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynCanvasElementHierarchy,
  useAglynComponentSchema,
  useAglynElementData,
  useAglynElementLabel,
} from '@aglyn/core-feature-renderer'
import {IconVariant} from '@aglyn/shared-data-brand'
import {styled} from '@aglyn/shared-feature-themes'
import {mdiChevronDown, mdiChevronRight, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {_isStrT} from '@aglyn/shared-util-guards'
import MuiTreeItem, {TreeItemProps} from '@mui/lab/TreeItem'
import MuiTreeView, {SingleSelectTreeViewProps} from '@mui/lab/TreeView'
import {forwardRef, Fragment, useCallback, useMemo} from 'react'
import useAglynBesignerStoreState from '../hooks/use-aglyn-besigner-store-state'


const ScrollableTreeView = styled(MuiTreeView, {name: 'AglynScrollableTreeView'})({
  overflow: 'auto',
  flexGrow: 1,
})

interface ElementsTreeItemComponentProps extends Partial<TreeItemProps> {
  $id: ElementId
}

const ElementsTreeItemComponent = forwardRef<any, ElementsTreeItemComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props,
      elements = useAglynElementData($id, 'elements'),
      componentId = useAglynElementData($id, 'componentId'),
      bundleId = useAglynElementData($id, 'bundleId'),
      label = useAglynElementLabel($id),
      {iconPath, iconColor} = useAglynComponentSchema(componentId, bundleId)?.metadata || {}

    return (
      <MuiTreeItem
        ref={ref}
        nodeId={$id}
        label={
          <Fragment>
            <MdiIcon
              color="quaternary"
              path={iconPath || IconVariant.ENTITY_BLOCK}
              sx={{
                fontSize: 20,
                marginLeft: -0.25,
                marginRight: 0.5,
                marginBottom: -0.5,
                padding: 0.26,
                borderRadius: '0.25em',
                backgroundColor: 'background.default',
                border: 1,
                borderColor: 'divider',
                boxShadow: 1,
                color: _isStrT(iconColor) ? iconColor : 'quaternary',
              }}
            />
            {label}
          </Fragment>
        }
        {...rest}
      >
        {elements.map(($id) => (
          <ElementsTreeItemComponent key={$id} $id={$id} />
        ))}
      </MuiTreeItem>
    )
  },
)

export interface ElementsTreeViewComponentProps extends Partial<SingleSelectTreeViewProps> {}

export const ElementsTreeViewComponent = forwardRef<any, ElementsTreeViewComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {getApp} = useAglynAppContext()
    const elements = useAglynElementData(CANVAS_ROOT_ELEMENT_ID, 'elements')
    const selected = useAglynBesignerStoreState('canvas', 'selected')
    const selectedId = selected?.$id
    const selectedIdHierarchy = useAglynCanvasElementHierarchy(selectedId)

    const defaultExpanded = useMemo(
      () => selectedIdHierarchy.filter((id) => id !== CANVAS_ROOT_ELEMENT_ID),
      [selectedIdHierarchy],
    )
    const handleTreeItemSelect = useCallback((e, $id) => {
      console.log('handleTreeItemSelect $id', $id)
      setBesignerCanvasSelected(getApp(), {selected: {$id}})
    }, [])
    const handleTreeItemFocus = useCallback((e, $id) => {
      console.log('handleTreeItemFocus $id', $id)
      setBesignerCanvasHovered(getApp(), {hovered: {$id}})
    }, [])

    return (
      <ScrollableTreeView
        ref={ref}
        aria-label="canvas elements navigator"
        onNodeSelect={handleTreeItemSelect}
        onNodeFocus={handleTreeItemFocus}
        selected={selectedId ?? ''}
        expanded={defaultExpanded}
        defaultCollapseIcon={<MdiIcon path={mdiChevronDown.path} />}
        defaultExpandIcon={<MdiIcon path={mdiChevronRight.path} />}
        {...rest}
      >
        {elements.map(($id) => (
          <ElementsTreeItemComponent key={$id} $id={$id} />
        ))}

        {children}
      </ScrollableTreeView>
    )
  },
)

ElementsTreeViewComponent.displayName = 'ElementsTreeViewComponent'
ElementsTreeViewComponent.defaultProps = {}

export default ElementsTreeViewComponent
