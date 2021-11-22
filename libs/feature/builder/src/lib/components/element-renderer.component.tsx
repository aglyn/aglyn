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

import { InteractionModeFlag } from '@aglyn/core-data-framework'
import {
  ElementRendererComponent as DefaultElementRendererComponent,
  ElementRendererComponentProps as DefaultElementRendererComponentProps,
  useAglynBuilderStore,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/feature-renderer'
import { useCombinedRefs } from '@aglyn/shared-ui-jsx'
import { getElementClientRectBounding } from '@aglyn/shared-util-dom'
import { CSS } from '@aglyn/shared-util-tools'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import Portal from '@mui/material/Portal'
import { forwardRef, Fragment, MouseEvent, useCallback, useRef } from 'react'
import { ActivityContext, useHoverContext } from '../contexts/hover-context'


export interface ElementRendererComponentProps extends DefaultElementRendererComponentProps {
  [prop: string]: any
}

const ElementRendererComponentRaw = forwardRef<any, ElementRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const localRef = useRef()
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const componentSchema = useAglynComponentSchema(componentId, bundleId)
    const {hoverOpen, hoverClose, hoverSelect, hoverDeselect} = useHoverContext()
    const interactMode = useAglynBuilderStore('flags', 'interactMode')
    const rearrangeEnabled = interactMode === InteractionModeFlag.REARRANGE
    const selectEnabled = interactMode === InteractionModeFlag.SELECT


    const {setNodeRef: dropRef, isOver, active, over} = useDroppable({
      id: $id,
      data: {
        componentId, bundleId,
        hierarchy: componentSchema?.renderFlags?.hierarchy,
      },
    })
    const {setNodeRef: dragRef, listeners, attributes, transform, isDragging} = useDraggable({
      id: $id,
      data: {
        componentId, bundleId,
        hierarchy: componentSchema?.renderFlags?.hierarchy,
      },
    })
    const {onPointerDown, ...dragListeners} = listeners
    const style = {
      transform: CSS.Translate.toString(transform),
    }

    const handleMouseOver = useCallback((e: MouseEvent<HTMLElement>) => {
      if (isDragging) return
      e.stopPropagation()
      const target = e.currentTarget
      if (target) {
        const clientPosition = getElementClientRectBounding(target)
        hoverOpen(e, {
          hovered: {
            $id: $id,
            position: clientPosition,
            componentId: componentId,
            bundleId: bundleId,
          },
        })
      }
      else {
        hoverClose(e as any)
      }
    }, [isDragging, hoverOpen, hoverClose, $id])


    const handleMouseLeave = useCallback((e) => {
      // if (isDragging) return
      // e.stopPropagation()
      // hoverClose(e)
    }, [isDragging, hoverClose, $id])


    const handleSelect = useCallback((e) => {
      e.stopPropagation()
      const target = e.currentTarget
      if (target) {
        const clientPosition = getElementClientRectBounding(target)
        hoverSelect(e, {
          selected: {
            $id: $id,
            position: clientPosition,
            componentId: componentId,
            bundleId: bundleId,
          },
        })
      }
      else {
        hoverDeselect(e)
      }
      // confirm({title: 'clicked'})
    }, [rearrangeEnabled, isDragging, hoverSelect, hoverDeselect, $id, componentId, bundleId])


    const handlePointerDown = useCallback((e) => {
      if (selectEnabled) {
        handleSelect(e)
      }
      if (rearrangeEnabled) {
        onPointerDown(e)
      }
    }, [rearrangeEnabled, selectEnabled])

    // console.log('setNodeRef isOver isDragging', isOver, active, over)

    return (
      <Fragment>
        <DefaultElementRendererComponent
          ref={useCombinedRefs(ref, localRef, dropRef, dragRef)}
          $id={$id}
          data-aglyn-element-id={$id}
          data-aglyn-component-id={componentId}
          data-aglyn-bundle-id={bundleId}
          elementRendererComponent={ElementRendererComponent}
          style={style}
          onMouseOver={handleMouseOver}
          onMouseOut={handleMouseLeave}
          onPointerDown={handlePointerDown}
          {...dragListeners}
          {...rest}
        />
        <ActivityContext.Consumer>
          {(activityRef) => (
            <Portal container={activityRef.current}>
              {/*{isOver && !isDragging}*/}
            </Portal>
          )}
        </ActivityContext.Consumer>
      </Fragment>
    )
  },
)

ElementRendererComponentRaw.displayName = 'ElementRendererComponent'
ElementRendererComponentRaw.defaultProps = {}

export const ElementRendererComponent = ElementRendererComponentRaw
export default ElementRendererComponent
