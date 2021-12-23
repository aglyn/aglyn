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
  InteractionModeFlag,
  setBesignerCanvasHovered,
  setBesignerCanvasSelected,
} from '@aglyn/core-data-framework'
import {
  ElementRendererComponent as DefaultElementRendererComponent,
  ElementRendererComponentProps as DefaultElementRendererComponentProps,
  useAglynAppContext,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {styled} from '@aglyn/shared-feature-themes'
import {useCombinedRefs, useDynamicEffect} from '@aglyn/shared-ui-jsx'
import {CSS} from '@aglyn/shared-util-tools'
import {useDraggable, useDroppable} from '@dnd-kit/core'
import Box, {BoxProps} from '@mui/material/Box'
import {forwardRef, MouseEvent, useCallback, useRef} from 'react'
import {useCanvasRenderedElementRefs} from '../contexts/canvas-rendered-element-refs'
import {useAglynBesignerStoreState} from '../hooks/use-aglyn-besigner-store-state'
import {useBesignerElementAttributes} from '../hooks/use-besigner-element-attributes'


interface ElementBoxProps extends BoxProps {}

const ElementBox = styled(Box, {
  name: 'ElementBox',
})<ElementBoxProps>(({theme}) => ({
  // [`&.[${ElementAttribute.HOVERED}]`]: {
  //   visibility: 'visible',
  // },
  // [`&[${ElementAttribute.HOVERED}^="self"]`]: {
  //   outlineWidth: 3,
  //   outlineOffset: 2,
  //   outlineColor: theme.palette.secondary.light,
  //   outlineStyle: 'dashed',
  // },
  // [`&[${ElementAttribute.SELECTED}^="self"]`]: {
  //   outlineWidth: 3,
  //   outlineOffset: -1,
  //   outlineColor: theme.palette.quaternary.main,
  //   outlineStyle: 'solid',
  // },
}))

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
    const elementAttributes = useBesignerElementAttributes({$id, componentId, bundleId})
    const {getApp} = useAglynAppContext()
    const interactMode = useAglynBesignerStoreState('flags', 'interactMode')
    const rearrangeEnabled = interactMode === InteractionModeFlag.REARRANGE
    const selectEnabled = interactMode === InteractionModeFlag.SELECT

    const {
      setNodeRef: dropRef,
      isOver,
      active,
      over,
    } = useDroppable({
      id: $id,
      data: {
        componentId,
        bundleId,
        hierarchy: componentSchema?.renderFlags?.hierarchy,
      },
    })
    const {
      setNodeRef: dragRef,
      listeners,
      attributes,
      transform,
      isDragging,
    } = useDraggable({
      id: $id,
      data: {
        componentId,
        bundleId,
        hierarchy: componentSchema?.renderFlags?.hierarchy,
      },
    })
    const {onPointerDown, ...dragListeners} = listeners
    const style = {
      transform: CSS.Translate.toString(transform),
    }

    const handleMouseOver = useCallback(
      (e: MouseEvent<HTMLElement>) => {
        // if (isDragging) return
        e.stopPropagation()
        const target = e.currentTarget
        if (target) {
          setBesignerCanvasHovered(getApp(), {hovered: {$id}})
        }
        else {
          // hoverClose(e as any)
        }
      },
      [$id],
    )

    const handleMouseLeave = useCallback((e) => {
      if (isDragging) return
      e.stopPropagation()
      setBesignerCanvasHovered(getApp(), {hovered: {}})
      // hoverClose(e)
    }, [])

    const handleSelect = useCallback(
      (e) => {
        e.stopPropagation()
        const target = e.currentTarget
        if (target) {
          setBesignerCanvasSelected(getApp(), {selected: {$id}})
        }
        else {
          // hoverDeselect(e)
        }
        // confirm({title: 'clicked'})
      },
      [$id],
    )

    const handlePointerDown = useCallback(
      (e) => {
        if (selectEnabled) {
          handleSelect(e)
        }
        if (rearrangeEnabled) {
          onPointerDown(e)
        }
      },
      [rearrangeEnabled, selectEnabled],
    )

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
        ref={useCombinedRefs(ref, localRef, dropRef, dragRef)}
        // component={}
        $id={$id}
        elementRendererComponent={ElementRendererComponent}
        style={style}
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseLeave}
        onPointerDown={handlePointerDown}
        {...elementAttributes}
        {...dragListeners}
        {...rest}
      />
    )
  },
)

ElementRendererComponent.displayName = 'Besigner.ElementRendererComponent'
ElementRendererComponent.defaultProps = {}

export {ElementRendererComponent}
export default ElementRendererComponent
