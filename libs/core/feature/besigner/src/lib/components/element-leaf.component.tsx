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

import {
  LeafComponent,
  type LeafComponentProps,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {useCombinedRefs} from '@aglyn/shared-ui-jsx'
import {type ChangeEvent, forwardRef, useCallback, useEffect, useRef} from 'react'
import {useRenderedCanvasElements} from '../contexts/rendered-canvas-elements'
import useAglynCanvasElementStatusManagers from '../hooks/use-aglyn-canvas-element-status-managers'
import useAglynCanvasElementIsSelected from '../hooks/use-aglyn-canvas-is-element-selected'
import useLeafDnd from '../hooks/use-leaf-dnd'


export interface ElementLeafComponentProps extends LeafComponentProps {}

const ElementLeafComponent = forwardRef<any, ElementLeafComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, leafComponent, ...rest} = props
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const leaf = leafComponent || ElementLeafComponent
    const isSelected = useAglynCanvasElementIsSelected($id)
    const [handleHover, handleSelect] = useAglynCanvasElementStatusManagers($id)
    const [dragHandleRef, dragPreviewRef, dropRef] = useLeafDnd($id)
    const [setElementRef, deleteElementRef] = useRenderedCanvasElements()
    const elemRef = useRef<Element>(null)
    setElementRef($id, {$id, element: elemRef, dragHandle: dragHandleRef})
    useEffect(() => () => {deleteElementRef($id)}, [$id, deleteElementRef])

    const handleOnMouseOver = useCallback((e: ChangeEvent<any>) => {
      e.stopPropagation()
      handleHover($id)
    }, [$id, handleHover])
    const handleOnMouseDown = useCallback((e: ChangeEvent<any>) => {
      e.preventDefault()
      e.stopPropagation()
      if (isSelected) handleSelect(null)
      else handleSelect($id)
    }, [$id, handleSelect, isSelected])

    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
    // console.log('element attributes', elementAttributes)

    return (
      <LeafComponent
        ref={useCombinedRefs(ref, elemRef, dragPreviewRef, dropRef)}
        $id={$id}
        leafComponent={leaf}
        onMouseOver={handleOnMouseOver}
        onMouseDown={handleOnMouseDown}
        data-aglyn-element-id={$id}
        data-aglyn-element-component={componentId}
        data-aglyn-element-bundle={bundleId}
        data-aglyn-element-selected={isSelected}
        {...rest}
      />
    )
  },
)

ElementLeafComponent.displayName = 'Besigner.LeafComponent'
ElementLeafComponent.aglyn = true
ElementLeafComponent.defaultProps = {}

export {ElementLeafComponent}
export default ElementLeafComponent
