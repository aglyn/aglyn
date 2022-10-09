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

import * as Aglyn from '@aglyn/aglyn'
import { DndDragType } from '@aglyn/besigner-data-app'
import {
  LeafComponent,
  type LeafComponentProps,
  useAglynCanvasElementHierarchy,
} from '@aglyn/core-feature-renderer'
import { useForkedRefs } from '@aglyn/shared-ui-jsx'
import {
  type ChangeEvent,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRenderedCanvasElements } from '../contexts/rendered-canvas-elements'
import { useAglynCanvasSetHovered } from '../hooks/use-aglyn-canvas-hovered'
import useAglynCanvasElementIsSelected from '../hooks/use-aglyn-canvas-is-element-selected'
import { useAglynCanvasSetSelected } from '../hooks/use-aglyn-canvas-selected'
import useLeafDrag from '../hooks/use-leaf-drag'
import useLeafDrop from '../hooks/use-leaf-drop'

export interface ElementLeafComponentProps extends LeafComponentProps {}

const ElementLeafComponent = forwardRef<any, ElementLeafComponentProps>(
  (props, forwardRef) => {
    const { $id, leafComponent, ...rest } = props
    const node = Aglyn.screen.getNode($id)
    const schema = Aglyn.components.getSchema(node?.componentId)
    const componentId = schema?.componentId
    const pluginId = schema?.pluginId
    const trail = useAglynCanvasElementHierarchy($id)
    const dndData = useMemo(
      () => ({
        $id,
        componentId,
        pluginId,
        componentSchema: schema,
        restrictParent: schema?.restrictParent,
        restrictChildren: schema?.restrictChildren,
        trail,
      }),
      [$id, componentId, pluginId, schema, trail],
    )
    const [, dragHandle, dragPreview] = useLeafDrag(dndData, DndDragType.CANVAS)
    const [, dropRef] = useLeafDrop(dndData)
    const [nodeRef, setNodeRef] = useState<HTMLElement>()
    const { setElementRef, deleteElementRef } = useRenderedCanvasElements()
    const ref = useForkedRefs<HTMLElement>(
      forwardRef,
      dragPreview,
      dropRef,
      setNodeRef,
    )
    const isSelected = useAglynCanvasElementIsSelected($id)
    const setHovered = useAglynCanvasSetHovered()
    const setSelected = useAglynCanvasSetSelected()

    /**
     * Update context element ref
     */
    useEffect(() => {
      setElementRef($id, { $id, node: nodeRef, dragHandle })
    }, [setElementRef, dragHandle, $id, nodeRef])
    /**
     * Remove only on unmount
     */
    useEffect(() => () => deleteElementRef($id), [deleteElementRef, $id])

    const handleOnMouseOver = useCallback(
      (e: ChangeEvent<any>) => {
        e.preventDefault()
        e.stopPropagation()
        setHovered({ $id })
      },
      [$id, setHovered],
    )
    const handleOnMouseDown = useCallback(
      (e: ChangeEvent<any>) => {
        e.preventDefault()
        e.stopPropagation()
        setSelected((prev) => ({
          $id: $id && prev?.$id === $id ? undefined : $id,
        }))
      },
      [$id, setSelected],
    )

    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
    // console.log('element attributes', elementAttributes)

    return (
      <LeafComponent
        ref={ref}
        $id={$id}
        leafComponent={leafComponent || ElementLeafComponent}
        onMouseOver={handleOnMouseOver}
        onMouseDown={handleOnMouseDown}
        data-aglyn-node={$id}
        data-aglyn-component={componentId}
        data-aglyn-bundle={pluginId}
        data-aglyn-status={isSelected ? 'selected' : 'none'}
        {...rest}
      />
    )
  },
)
ElementLeafComponent.displayName = 'BesignerLeafComponent'
ElementLeafComponent.aglyn = true
ElementLeafComponent.defaultProps = {}

export { ElementLeafComponent }
export default ElementLeafComponent
