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

import { Leaf, type LeafProps } from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { observer } from 'mobx-react-lite'
import { forwardRef } from 'react'
import DraggableDroppable from './dnd/draggable-droppable'

export interface ElementLeafComponentProps extends LeafProps {}

const RawLeafComponent = forwardRef<any, ElementLeafComponentProps>(
  (props, ref) => {
    const { node, ...rest } = props
    const isSelected = Besigner.focus.isNodeSelected(node)

    return (
      <>
        <DraggableDroppable
          node={node}
          type={Besigner.DragType.CANVAS}
          accept={Object.values(Besigner.DragType)}
          disableDragging={!Besigner.dnd.canDragNode(node)}
        >
          <Leaf
            ref={ref}
            node={node}
            data-aglyn={`leaf:${node?.$id}`}
            data-aglyn-selected={isSelected ? 'selected' : undefined}
            {...rest}
          />
        </DraggableDroppable>

        {/*<Draggable node={node} type={DragType.CANVAS}>*/}
        {/*  <Box sx={{ h: 100, w: 100 }}>Move me! ;)</Box>*/}
        {/*</Draggable>*/}
      </>
    )
  },
)
RawLeafComponent.displayName = 'BesignerLeafComponent'
RawLeafComponent.aglyn = true

export const LeafComponent = observer<ElementLeafComponentProps, any>(
  RawLeafComponent,
)
export default LeafComponent
