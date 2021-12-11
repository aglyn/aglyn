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
  IAglynComponent,
  AglynComponentElementDataNormalized,
  ElementId,
} from '@aglyn/core-data-framework'
import { InnerRefProp } from '@aglyn/shared-data-types'
import { getDisplayName } from '@aglyn/shared-util-tools'
import clsx from 'clsx'
import { ComponentType, forwardRef, PropsWithoutRef, RefAttributes } from 'react'
import useAglynComponent from './use-aglyn-component'
import useAglynElementConditionalInnerRefProps from './use-aglyn-element-conditional-inner-ref-props'
import { useAglynElementData } from './use-aglyn-element-data'
import useAglynElementResolvedProps from './use-aglyn-element-resolved-props'

export interface RequiredElementDataProps {
  $id: ElementId
  className?: string
}

export interface OptionalElementDataProps extends InnerRefProp {
  elementData: AglynComponentElementDataNormalized<any>
  component: IAglynComponent<any>
  elemProps: any
}

export interface ElementDataProps extends RequiredElementDataProps, OptionalElementDataProps {}

export function withAglynElementData<U = any, T = any>(
  WrappedComponent: ComponentType<PropsWithoutRef<ElementDataProps & U> & RefAttributes<T>>
): ComponentType<RequiredElementDataProps & U & RefAttributes<T>> {

  const displayName = getDisplayName(WrappedComponent)
  const WithAglynElementData = forwardRef<T, RequiredElementDataProps & U>(
    function RefRenderFn(props, ref) {
      const { $id, children: childrenProp, className: classNameProp, ...rest } = props
      const elementData = useAglynElementData($id)
      const component = useAglynComponent(elementData.componentId, elementData.bundleId)
      const { children, className: classNameElem, ...elemProps } = useAglynElementResolvedProps($id)
      const innerRefProps = useAglynElementConditionalInnerRefProps($id, ref)
      const className = clsx(classNameProp, classNameElem)

      return (
        <WrappedComponent
          ref={ref}
          $id={$id}
          elementData={elementData}
          component={component}
          elemProps={elemProps}
          className={className}
          {...innerRefProps}
          {...(rest as any)}
        >
          {children}
          {childrenProp}
        </WrappedComponent>
      )
    }
  )
  WithAglynElementData.displayName = `WithAglynElementData(${displayName})`
  return WithAglynElementData as ComponentType<RequiredElementDataProps & U & RefAttributes<T>>
}

export default withAglynElementData
