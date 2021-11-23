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
import { styled } from '@aglyn/shared-feature-themes'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import MuiTreeItem, { TreeItemProps } from '@mui/lab/TreeItem'
import MuiTreeView, { SingleSelectTreeViewProps } from '@mui/lab/TreeView'
import { forwardRef } from 'react'


const ScrollableTreeView = styled(MuiTreeView, {name: 'ScrollableTreeView'})({
  overflow: 'auto',
  flexGrow: 1,
  maxWidth: 400,
})

interface ElementsTreeItemComponentProps extends Partial<TreeItemProps> {
  $id: ElementId
}

const ElementsTreeItemComponent = forwardRef<any, ElementsTreeItemComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const elements = useAglynElementData($id, 'elements')
    const label = useAglynElementLabel($id)
    return (
      <MuiTreeItem ref={ref} nodeId={$id} label={label} {...rest}>
        {elements.map(($id) => (
          <ElementsTreeItemComponent key={$id} $id={$id} />
        ))}
      </MuiTreeItem>
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
      <ScrollableTreeView
        ref={ref}
        aria-label="file system navigator"
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
  },
)

ElementsTreeViewComponent.displayName = 'ElementsTreeViewComponent'
ElementsTreeViewComponent.defaultProps = {}

export default ElementsTreeViewComponent
