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

import { ComponentId } from '@aglyn/core-data-framework'
import { ReactIs } from '@aglyn/shared-ui-jsx'
import { _isArrEmpty } from '@aglyn/shared-util-guards'
import { ComponentType, forwardRef, HTMLAttributes, PropsWithoutRef, RefAttributes } from 'react'
import { ElementDataProps, withAglynElementData } from '../hooks/with-aglyn-element-data'
import { ElementsRendererComponent } from './elements-renderer.component'

// eslint-disable-next-line @typescript-eslint/ban-types
export interface ElementRendererComponentProps<T = any> extends HTMLAttributes<T> {
  $id: ComponentId
  elementRendererComponent?: ComponentType<
    PropsWithoutRef<ElementRendererComponentProps<any>> & RefAttributes<any>
  >
}

export type DecoratedElementRendererProps<T = any> = ElementRendererComponentProps<T> &
  ElementDataProps

const ElementRendererComponentRaw = forwardRef<any, DecoratedElementRendererProps>(
  function RefRenderFn(props, ref) {
    const {
      $id,
      elemProps,
      elementData,
      component: Component,
      elementRendererComponent: elementRendererComponentProp,
      children,
      ...rest
    } = props

    const elementRendererComponent = elementRendererComponentProp || ElementRendererComponent

    return ReactIs.isValidElementType(Component) ? (
      <Component ref={ref} {...elemProps} {...rest}>
        {!_isArrEmpty(elementData.elements || []) ? (
          <ElementsRendererComponent
            elementRendererComponent={elementRendererComponent}
            elements={elementData.elements}
          />
        ) : null}
        {children}
      </Component>
    ) : (
      <>Error loading element component</>
    )
  }
)

ElementRendererComponentRaw.displayName = 'Renderer.ElementRendererComponent'
ElementRendererComponentRaw.defaultProps = {
  children: null,
}

export const ElementRendererComponent = withAglynElementData(ElementRendererComponentRaw)

export default ElementRendererComponent
