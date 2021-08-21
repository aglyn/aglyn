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

import { ComponentType, ElementType, forwardRef, memo } from 'react'
import {
  AglynComponent,
  AglynComponentData,
  getApp,
  getComponent,
  handleResolveProps,
} from '@aglyn/framework/sdk'
import { _isArr, _isArrEmpty, _isStrT, _s, yes } from '@aglyn/shared/util/helpers'
import * as ReactIs from 'react-is'
import ElementsComponent from './elements-renderer.component'
import { AnyProps } from '@aglyn/shared/util/types'


export interface ElementRendererComponentProps extends AnyProps {
  elementData: AglynComponentData
  elementComponent?: ComponentType<ElementRendererComponentProps>
}

const ElementRendererComponent = forwardRef<any, ElementRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {elementData: data, elementComponent, ...rest} = props
    const component = _isStrT(data?.component)
      ? getComponent(getApp(), {componentId: _s(data?.component)})
      : data?.component as AglynComponent
    const ctor = component
    const options = component?.options
    const resolvedProps = handleResolveProps(data?.props, options, ctor)
    const {children: content = null, ...ctorProps} = resolvedProps
    const ComponentCtor = (ReactIs.isValidElementType(ctor) ? ctor : 'div') as ElementType
    const haveChildren = yes(!_isArr(data?.children) || _isArrEmpty(data?.children))

    return (
      <ComponentCtor innerRef={ref} {...ctorProps} {...rest}>
        {!haveChildren ? (
          <ElementsComponent
            elementComponent={elementComponent}
            children={data?.children as AglynComponentData[]}
          />
        ) : (
          content
        )}
      </ComponentCtor>
    )
  },
)

ElementRendererComponent.displayName = 'ElementRendererComponent'
ElementRendererComponent.defaultProps = {
  elementComponent: ElementRendererComponent,
}

export default memo(ElementRendererComponent)
