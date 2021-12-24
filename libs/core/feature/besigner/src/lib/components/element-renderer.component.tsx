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

import {setBesignerCanvasHovered, setBesignerCanvasSelected} from '@aglyn/core-data-framework'
import {
  ElementRendererComponent as DefaultElementRendererComponent,
  type ElementRendererComponentProps as DefaultElementRendererComponentProps,
  useAglynAppContext,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {useCombinedRefs, useDynamicEffect} from '@aglyn/shared-ui-jsx'
import {useDroppable} from '@dnd-kit/core'
import {forwardRef, useCallback, useRef} from 'react'
import {useCanvasRenderedElementRefs} from '../contexts/canvas-rendered-element-refs'


export interface ElementRendererComponentProps extends DefaultElementRendererComponentProps {
  [prop: string]: any
}

const ElementRendererComponent = forwardRef<any, ElementRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const localRef = useRef<Element>()
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const componentSchema = useAglynComponentSchema(componentId, bundleId)
    const {getApp} = useAglynAppContext()

    const {
      setNodeRef: dropRef,
    } = useDroppable({
      id: $id,
      data: {
        $id,
        componentId,
        bundleId,
        hierarchy: componentSchema?.renderFlags?.hierarchy,
      },
    })

    const handleMouseOver = useCallback((e) => {
      e.stopPropagation()
      setBesignerCanvasHovered(getApp(), {hovered: {$id}})
    }, [$id])

    const handleMouseLeave = useCallback((e) => {
      // e.stopPropagation()
      setBesignerCanvasHovered(getApp(), {hovered: null})
    }, [])

    const handleSelect = useCallback((e) => {
      e.stopPropagation()
      setBesignerCanvasSelected(getApp(), {selected: {$id}})
    }, [$id])

    const {setElementRef, deleteElementRef} = useCanvasRenderedElementRefs()
    useDynamicEffect(() => {
      setElementRef($id, localRef)
      return () => {
        deleteElementRef($id)
      }
    }, [$id, localRef, setElementRef, deleteElementRef])


    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
    // console.log('element attributes', elementAttributes)

    return (
      <DefaultElementRendererComponent
        ref={useCombinedRefs(ref, localRef, dropRef)}
        $id={$id}
        elementRendererComponent={ElementRendererComponent}
        onClick={handleSelect}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        data-aglyn-element-id={$id}
        {...rest}
      />
    )
  },
)

ElementRendererComponent.displayName = 'Besigner.ElementRendererComponent'
ElementRendererComponent.defaultProps = {}

export {ElementRendererComponent}
export default ElementRendererComponent
