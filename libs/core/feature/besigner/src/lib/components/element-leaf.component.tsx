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
  LeafComponent,
  type LeafComponentProps,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {useCombinedRefs} from '@aglyn/shared-ui-jsx'
import {forwardRef, useEffect, useRef} from 'react'
import {useCanvasRenderedElementRefs} from '../contexts/canvas-rendered-element-refs'
import useLeafDnd from '../hooks/use-leaf-dnd'


export interface ElementLeafComponentProps extends LeafComponentProps {
  [prop: string]: any
}

const ElementLeafComponent = forwardRef<any, ElementLeafComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, leafComponent, ...rest} = props
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const leaf = leafComponent || ElementLeafComponent
    const [dragHandleRef, dragPreviewRef, dropRef, handleHover, handleSelect] = useLeafDnd($id)
    const [setElementRef, deleteElementRef] = useCanvasRenderedElementRefs()
    const elemRef = useRef<Element>(null)
    setElementRef($id, {$id, element: elemRef, dragHandle: dragHandleRef})
    useEffect(() => () => {deleteElementRef($id)}, [$id, deleteElementRef])

    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
    // console.log('element attributes', elementAttributes)

    return (
      <LeafComponent
        ref={useCombinedRefs(ref, elemRef, dragPreviewRef, dropRef)}
        $id={$id}
        leafComponent={leaf}
        onMouseOver={handleHover}
        onMouseDown={handleSelect}
        data-aglyn-element-type="element"
        data-aglyn-element-id={$id}
        data-aglyn-element-component={componentId}
        data-aglyn-element-bundle={bundleId}
        {...rest}
      />
    )
  },
)

ElementLeafComponent.displayName = 'Besigner.LeafComponent'
ElementLeafComponent.defaultProps = {}

export {ElementLeafComponent}
export default ElementLeafComponent
