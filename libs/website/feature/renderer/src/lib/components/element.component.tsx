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

import { ComponentType, forwardRef } from 'react'
import Website, { AnyProps, handleResolveProps } from '@aglyn/website/core'
import { _isArr, _isArrEmpty, _isStr, yes } from '@aglyn/shared/util/helpers'
import * as ReactIs from 'react-is'
import ElementsComponent from './elements.component'


export interface ElementComponentProps extends AnyProps {
  elementData: Website.ElementData
  elementComponent?: ComponentType<ElementComponentProps>
}

const ElementComponent = forwardRef<any, ElementComponentProps>(function RefRenderFn(props, ref) {
  const {elementData: data, elementComponent, ...rest} = props
  const component = !_isStr(data?.component)
    ? (data?.component as Website.Component)
    : Website.App.getComponent({moduleId: 'react', componentId: data?.component})
  const {ctor, metadata = {}} = component ?? {}
  const resolvedProps = handleResolveProps(data?.props, metadata, component)
  const {children: content = null, ...ctorProps} = resolvedProps
  const ComponentCtor = ReactIs.isValidElementType(ctor) ? ctor : 'div'
  const haveChildren = yes(!_isArr(data?.children) || _isArrEmpty(data?.children))

  return (
    <ComponentCtor innerRef={ref} {...ctorProps} {...rest}>
      {!haveChildren ? (
        <ElementsComponent
          elementComponent={elementComponent}
          children={data?.children as Website.ElementData[]}
        />
      ) : (
        content
      )}
    </ComponentCtor>
  )
})

ElementComponent.displayName = 'ElementComponent'
ElementComponent.defaultProps = {
  elementComponent: ElementComponent,
}

export default ElementComponent
