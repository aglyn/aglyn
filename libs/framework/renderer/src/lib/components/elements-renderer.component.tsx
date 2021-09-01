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

import { AglynComponentData } from '@aglyn/framework/sdk'
import { OverrideableComponentProps } from '@aglyn/shared/ui/react'
import { forwardRef, Fragment } from 'react'
import {
  ElementRendererComponent,
  ElementRendererComponentProps,
} from './element-renderer.component'


export interface ElementsComponentProps extends OverrideableComponentProps {
  elementRendererComponent?: ElementRendererComponentProps['elementRendererComponent']
  children?: AglynComponentData[]
}

export const ElementsRendererComponent = forwardRef<any, ElementsComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      component: Component,
      elementRendererComponent,
      children,
      ...rest
    } = props
    const ElementRendererComponentProp = elementRendererComponent || ElementRendererComponent
    return (
      <Component ref={ref} {...rest}>
        {children.map((data, i) => (
          <ElementRendererComponentProp
            key={data?.$id ?? i}
            elementData={data}
            elementRendererComponent={ElementRendererComponentProp}
          />
        ))}
      </Component>
    )
  },
)

ElementsRendererComponent.displayName = 'ElementsComponent'
ElementsRendererComponent.defaultProps = {
  component: Fragment,
  children: [],
}

export default ElementsRendererComponent
