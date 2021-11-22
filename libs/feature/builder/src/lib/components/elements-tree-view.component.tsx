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

import { ElementId } from '@aglyn/core-data-framework'
import { useAglynElementData, useAglynElementLabel } from '@aglyn/feature-renderer'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import TreeItem, { TreeItemProps } from '@mui/lab/TreeItem'
import TreeView, { SingleSelectTreeViewProps } from '@mui/lab/TreeView'
import { forwardRef } from 'react'


interface CanvasElementTreeItemComponentProps extends Partial<TreeItemProps> {
  $id: ElementId
}

const CanvasElementTreeItemComponent = forwardRef<any, CanvasElementTreeItemComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const elements = useAglynElementData($id, 'elements')
    const label = useAglynElementLabel($id)
    return (
      <TreeItem ref={ref} nodeId={$id} label={label} {...rest}>
        {elements.map(($id) => (
          <CanvasElementTreeItemComponent key={$id} $id={$id} />
        ))}
      </TreeItem>
    )
  },
)

export interface ElementsTreeViewComponentProps extends Partial<SingleSelectTreeViewProps> {

}

export const ElementsTreeViewComponent = forwardRef<any, ElementsTreeViewComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      ...rest
    } = props

    const elements = useAglynElementData('__root__', 'elements')

    return (
      <TreeView
        ref={ref}
        aria-label="file system navigator"
        defaultCollapseIcon={<SvgPathIcon iconIds={'chevron-down'} />}
        defaultExpandIcon={<SvgPathIcon iconIds={'chevron-right'} />}
        sx={{height: '100%', flexGrow: 1, maxWidth: 400, overflowY: 'auto'}}
        {...rest}
      >

        {elements.map(($id) => (
          <CanvasElementTreeItemComponent key={$id} $id={$id} />
        ))}

      </TreeView>
    )
  },
)

ElementsTreeViewComponent.displayName = 'ElementsTreeViewComponent'
ElementsTreeViewComponent.defaultProps = {}

export default ElementsTreeViewComponent
