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
  type ElementId,
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
import {alpha, styled} from '@aglyn/shared-feature-themes'
import {mdiChevronDown, mdiChevronRight, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {_isStrT} from '@aglyn/shared-util-guards'
import MuiTreeItem, {treeItemClasses, type TreeItemProps} from '@mui/lab/TreeItem'
import MuiTreeView, {type SingleSelectTreeViewProps} from '@mui/lab/TreeView'
import {forwardRef, Fragment, useCallback, useMemo, useState} from 'react'
import useAglynCanvasSelected from '../hooks/use-aglyn-canvas-selected'


const TreeItem = styled(MuiTreeItem, {name: 'AglynTreeItem'})(({theme}) => ({
  [`& .${treeItemClasses.content}`]: {
    borderTopLeftRadius: `50px`,
    borderBottomLeftRadius: `50px`,
    '&.Mui-focused': {
      backgroundColor: alpha(theme.palette.grey['A400'], theme.palette.action.focusOpacity),
    },
    '&.Mui-selected': {
      backgroundColor: alpha(theme.palette.quaternary.main, theme.palette.action.selectedOpacity),
    },
    '&.Mui-selected.Mui-focused': {
      backgroundColor: alpha(theme.palette.quaternary.main, theme.palette.action.activatedOpacity),
    },
  },
}))
const TreeView = styled(MuiTreeView, {name: 'AglynTreeView'})({
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
      <TreeItem
        ref={ref}
        nodeId={$id}
        collapseIcon={<MdiIcon path={mdiChevronDown.path} />}
        expandIcon={<MdiIcon path={mdiChevronRight.path} />}
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
      </TreeItem>
    )
  },
)

export interface ElementsTreeViewComponentProps extends Partial<SingleSelectTreeViewProps> {}

export const ElementsTreeViewComponent = forwardRef<any, ElementsTreeViewComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {getApp} = useAglynAppContext()
    const selected = useAglynCanvasSelected()
    const selectedHierarchy = useAglynCanvasElementHierarchy(selected?.$id)
    const [expanded, setExpanded] = useState<ElementId[]>([])
    const allExpanded = useMemo(() => [
      ...selectedHierarchy, ...expanded,
    ], [selectedHierarchy, expanded])

    const handleTreeItemSelect = useCallback((e, $id) => {
      e.stopPropagation()
      e.preventDefault()
      setBesignerCanvasSelected(getApp(), {
        selected: (prev) => ({...prev, $id: $id === selected?.$id ? null : $id}),
      })
    }, [getApp, selected])


    const handleTreeItemFocus = useCallback((e, $id) => {
      setBesignerCanvasHovered(getApp(), {
        hovered: (prev) => ({...prev, $id}),
      })
    }, [getApp])


    const handleTreeItemToggle = useCallback((e, ids: ElementId[]) => {
      e.stopPropagation()
      e.preventDefault()
      setExpanded(ids)
    }, [setExpanded])

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
        <ElementsTreeItemComponent
          key={CANVAS_ROOT_ELEMENT_ID}
          $id={CANVAS_ROOT_ELEMENT_ID}
        />
      </TreeView>
    )
  },
)

ElementsTreeViewComponent.displayName = 'ElementsTreeViewComponent'
ElementsTreeViewComponent.defaultProps = {}

export default ElementsTreeViewComponent
