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
  AglynComponentElement,
  AglynComponentElementDataNormalized,
  ElementId,
} from '@aglyn/core-data-framework'
import { InnerRefProp } from '@aglyn/shared-data-types'
import { getDisplayName } from '@aglyn/shared-util-tools'
import { ComponentType, forwardRef, PropsWithoutRef, RefAttributes } from 'react'
import useAglynComponent from './use-aglyn-component'
import useAglynElementConditionalInnerRefProps
  from './use-aglyn-element-conditional-inner-ref-props'
import { useAglynElementData } from './use-aglyn-element-data'
import useAglynElementResolvedProps from './use-aglyn-element-resolved-props'


export interface RequiredElementDataProps {
  $id: ElementId
}

export interface OptionalElementDataProps extends InnerRefProp {
  elementData: AglynComponentElementDataNormalized<any>
  component: AglynComponentElement<any>
  elemProps: any
}

export interface ElementDataProps extends RequiredElementDataProps,
  OptionalElementDataProps {

}

export function withAglynElement<U = any, T = any>(
  WrappedComponent: ComponentType<PropsWithoutRef<ElementDataProps & U> & RefAttributes<T>>,
): ComponentType<RequiredElementDataProps & U & RefAttributes<T>> {
  const component = forwardRef<T, RequiredElementDataProps & U>(
    function RefRenderFn(props, ref) {
      const {$id, children: childrenProp, ...rest} = props
      const elementData = useAglynElementData($id)
      const component = useAglynComponent(elementData.componentId, elementData.bundleId)
      const {children, ...elemProps} = useAglynElementResolvedProps($id)
      const innerRefProps = useAglynElementConditionalInnerRefProps($id, ref)

      return (
        <WrappedComponent
          ref={ref}
          $id={$id}
          elementData={elementData}
          component={component}
          elemProps={elemProps}
          {...innerRefProps}
          {...rest as any}
        >
          {children}
          {childrenProp}
        </WrappedComponent>
      )
    },
  )
  component.displayName = `WithElementData(${getDisplayName(WrappedComponent)})`
  return component as ComponentType<RequiredElementDataProps & U & RefAttributes<T>>
}

export default withAglynElement
