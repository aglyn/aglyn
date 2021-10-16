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
  AglynComponentElementData,
  getComponent,
  getComponentSchema,
} from '@aglyn/core-data-framework'
import { AnyProps } from '@aglyn/shared-data-types'
import { ReactIs } from '@aglyn/shared-ui-jsx'
import { _isArr, _isArrEmpty, _isFnT } from '@aglyn/shared-util-guards'
import { yes } from '@aglyn/shared-util-tools'
import { ComponentType, forwardRef } from 'react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'
import { ElementsRendererComponent } from './elements-renderer.component'


export interface ElementRendererComponentProps extends AnyProps {
  elementData: AglynComponentElementData
  elementRendererComponent?: ComponentType<ElementRendererComponentProps>
}

export const ElementRendererComponent = forwardRef<any, ElementRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {elementData, elementRendererComponent: elementRendererComponentProp, ...rest} = props

    const elementRendererComponent = elementRendererComponentProp || ElementRendererComponent
    const {getApp} = useAglynAppContext()
    const {$id, componentId, bundleId, elements, props: dataProps} = elementData
    const component = getComponent(getApp(), {componentId, bundleId})
    const schema = getComponentSchema(getApp(), {componentId, bundleId})
    const Component = ReactIs.isValidElementType(component) ? component : 'div'
    const resolveProps = schema?.renderFlags?.resolveProps
    const noRef = yes(schema?.renderFlags?.elementRef?.disable)
    const refKey = yes(schema?.renderFlags?.elementRef?.innerRef) ? 'innerRef' : 'ref'
    const refProps = !noRef ? {[refKey]: ref} : undefined
    const {children, ...elemProps}: AnyProps = {
      ...(_isFnT(resolveProps)
        ? (resolveProps.call(elementData, dataProps) as AnyProps)
        : dataProps),
    }

    return (
      <Component {...refProps} {...elemProps} {...rest} key={$id}>
        {_isArr(elements) && !_isArrEmpty(elements) ? (
          <ElementsRendererComponent
            elementRendererComponent={elementRendererComponent}
            children={elements}
          />
        ) : null}
        {children}
      </Component>
    )
  },
)

ElementRendererComponent.displayName = 'ElementRendererComponent'

export default ElementRendererComponent
