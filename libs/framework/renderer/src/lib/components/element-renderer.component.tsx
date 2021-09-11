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

import { AglynComponentData, getApp, getComponent } from '@aglyn/framework/sdk'
import { ReactIs } from '@aglyn/shared/ui/react'
import { _isArr, _isArrEmpty } from '@aglyn/shared/util/guards'
import { _s, yes } from '@aglyn/shared/util/tools'
import { AnyProps } from '@aglyn/shared/util/types'
import { ComponentType, ElementType, forwardRef } from 'react'
import { handleElementResolveProps } from '../util/handle-element-resolve-props'
import { ElementsRendererComponent } from './elements-renderer.component'


export interface ElementRendererComponentProps extends AnyProps {
  elementData: AglynComponentData
  elementRendererComponent?: ComponentType<ElementRendererComponentProps>
}

export const ElementRendererComponent = forwardRef<any, ElementRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      elementData,
      elementRendererComponent: elementRendererComponentProp,
      ...rest
    } = props
    const elementRendererComponent = elementRendererComponentProp || ElementRendererComponent

    // TODO: move to context consumer
    const component = getComponent(getApp(), {componentId: _s(elementData?.component)})
    const ctor = component
    const options = component?.options
    const resolvedProps = handleElementResolveProps(elementData?.props, options, ctor)
    const {children: content = null, ...ctorProps} = resolvedProps
    const ComponentCtor = (ReactIs.isValidElementType(ctor) ? ctor : 'div') as ElementType
    const haveChildren = yes(!_isArr(elementData?.children) || _isArrEmpty(elementData?.children))
    const refProps = options?.disableRef ? {}
      : options?.innerRef ? {innerRef: ref} : {ref: ref}

    return (
      <ComponentCtor {...refProps} {...ctorProps} {...rest}>
        {!haveChildren ? (
          <ElementsRendererComponent
            elementRendererComponent={elementRendererComponent}
            children={elementData?.children}
          />
        ) : (
          content
        )}
      </ComponentCtor>
    )
  },
)

ElementRendererComponent.displayName = 'ElementRendererComponent'

export default ElementRendererComponent
