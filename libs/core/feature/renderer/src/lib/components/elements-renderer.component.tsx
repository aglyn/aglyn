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
import { OverrideableComponentProps } from '@aglyn/shared-data-types'
import { forwardRef, Fragment } from 'react'
import {
  ElementRendererComponent,
  ElementRendererComponentProps,
} from './element-renderer.component'

export interface ElementsComponentProps extends OverrideableComponentProps {
  elementRendererComponent?: ElementRendererComponentProps['elementRendererComponent']
  elements?: ComponentId[]
}

const ElementsRendererComponentRaw = forwardRef<any, ElementsComponentProps>(function RefRenderFn(
  props,
  ref
) {
  const { component: Component, elementRendererComponent, elements, children, ...rest } = props
  const ElementRendererComponentProp = elementRendererComponent || ElementRendererComponent
  return (
    <Component ref={ref} {...rest}>
      {elements.map(($id) => (
        <ElementRendererComponentProp
          key={$id}
          $id={$id}
          elementRendererComponent={ElementRendererComponentProp}
        />
      ))}
      {children}
    </Component>
  )
})

ElementsRendererComponentRaw.displayName = 'ElementsComponent'
ElementsRendererComponentRaw.defaultProps = {
  component: Fragment,
  children: null,
  elements: [],
}

export const ElementsRendererComponent = ElementsRendererComponentRaw
export default ElementsRendererComponent
