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

import {CANVAS_ROOT_ELEMENT_ID, type ElementId} from '@aglyn/core-data-framework'
import {
  useAglynCanvasElementHierarchy,
  useAglynComponentSchema,
  useAglynElementData,
  useAglynElementLabel,
} from '@aglyn/core-feature-renderer'
import {ICON_VARIANT_ENTITY_BLOCK} from '@aglyn/shared-data-enums'
import {alpha, styled} from '@aglyn/shared-feature-themes'
import {mdiChevronDown, mdiChevronRight, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr} from '@aglyn/shared-util-guards'
import MuiTreeItem, {treeItemClasses, type TreeItemProps} from '@mui/lab/TreeItem'
import MuiTreeView, {type SingleSelectTreeViewProps} from '@mui/lab/TreeView'
import {forwardRef, Fragment, useCallback, useMemo, useState} from 'react'
import useAglynCanvasElementStatusManagers from '../hooks/use-aglyn-canvas-element-status-managers'
import useAglynCanvasSelected from '../hooks/use-aglyn-canvas-selected'


const TreeItem = styled(MuiTreeItem, {name: 'AglynTreeItem'})(({theme}) => ({
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
      elements = useAglynElementData($id, 'elements') || [],
      componentId = useAglynElementData($id, 'componentId'),
      bundleId = useAglynElementData($id, 'bundleId'),
      label = useAglynElementLabel($id),
      icon = useAglynComponentSchema(componentId, bundleId)?.icon

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
              {...icon}
              path={icon?.path || ICON_VARIANT_ENTITY_BLOCK.path}
              sx={[
                {
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
                  color: 'quaternary',
                },
                ...(_isArr(icon?.sx) ? icon.sx : [icon?.sx]),
              ]}
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
    const selected = useAglynCanvasSelected()
    const selectedHierarchy = useAglynCanvasElementHierarchy(selected?.$id)
    const [handleHover, handleSelect] = useAglynCanvasElementStatusManagers()
    const [expanded, setExpanded] = useState<ElementId[]>([])
    const allExpanded = useMemo(() => [
      ...selectedHierarchy, ...expanded,
    ], [selectedHierarchy, expanded])

    const handleTreeItemSelect = useCallback((e, $id) => {
      e.stopPropagation()
      e.preventDefault()
      handleSelect($id === selected?.$id ? null : $id)
    }, [handleSelect, selected])


    const handleTreeItemFocus = useCallback((e, $id) => {
      e.stopPropagation()
      handleHover($id)
    }, [handleHover])


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
