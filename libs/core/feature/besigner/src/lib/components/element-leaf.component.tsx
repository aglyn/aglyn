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
import {useCombinedRefs, useIsomorphicLayoutEffect} from '@aglyn/shared-ui-jsx'
import {type ChangeEvent, forwardRef, useCallback, useMemo, useRef} from 'react'
import {useRenderedCanvasElements} from '../contexts/rendered-canvas-elements'
import {useAglynCanvasSetHovered} from '../hooks/use-aglyn-canvas-hovered'
import useAglynCanvasElementIsSelected from '../hooks/use-aglyn-canvas-is-element-selected'
import {useAglynCanvasSetSelected} from '../hooks/use-aglyn-canvas-selected'
import useLeafDnd from '../hooks/use-leaf-dnd'


export interface ElementLeafComponentProps extends LeafComponentProps {}


const InnerLeafComponent = forwardRef<any, ElementLeafComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, leafComponent, ...rest} = props
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const isSelected = useAglynCanvasElementIsSelected($id)
    const setHovered = useAglynCanvasSetHovered()
    const setSelected = useAglynCanvasSetSelected()
    const leaf = useMemo(() => leafComponent || ElementLeafComponent, [leafComponent])


    const handleOnMouseOver = useCallback((e: ChangeEvent<any>) => {
      e.stopPropagation()
      setHovered({$id})
    }, [$id, setHovered])
    const handleOnMouseUp = useCallback((e: ChangeEvent<any>) => {
      e.preventDefault()
      e.stopPropagation()
      setSelected((prev) => ({$id: $id && prev?.$id === $id ? undefined : $id}))
    }, [$id, setSelected])

    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
    // console.log('element attributes', elementAttributes)

    return (
      <LeafComponent
        ref={ref}
        $id={$id}
        leafComponent={leaf}
        onMouseOver={handleOnMouseOver}
        onMouseUp={handleOnMouseUp}
        data-aglyn-element-id={$id}
        data-aglyn-element-component={componentId}
        data-aglyn-element-bundle={bundleId}
        data-aglyn-element-selected={isSelected}
        {...rest}
      />
    )
  },
)
InnerLeafComponent.displayName = 'InnerLeafComponent'
InnerLeafComponent.aglyn = true
InnerLeafComponent.defaultProps = {}


const ElementLeafComponent = forwardRef<any, ElementLeafComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const element = useRef<HTMLElement>()
    const [dragHandle, dragPreview, dropRef] = useLeafDnd($id)
    const [setElementRef, deleteElementRef] = useRenderedCanvasElements()
    useIsomorphicLayoutEffect(() => {
      setElementRef($id, {$id, element, dragHandle})
      return () => deleteElementRef($id)
    }, [])
    return (
      <InnerLeafComponent
        ref={useCombinedRefs(ref, element, dragPreview, dropRef)}
        $id={$id}
        {...rest}
      />
    )
  },
)
ElementLeafComponent.displayName = 'BesignerLeafComponent'
ElementLeafComponent.aglyn = true
ElementLeafComponent.defaultProps = {}

export {ElementLeafComponent}
export default ElementLeafComponent
