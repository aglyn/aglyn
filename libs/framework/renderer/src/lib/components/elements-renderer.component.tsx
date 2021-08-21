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

import { forwardRef, Fragment, memo } from 'react'
import { AglynComponentData } from '@aglyn/framework/sdk'
import _ElementComponent, { ElementRendererComponentProps } from './element-renderer.component'
import { ComponentProp } from '@aglyn/shared/ui/react'


export interface ElementsComponentProps extends ComponentProp {
  elementComponent?: ElementRendererComponentProps['elementComponent']
  children?: AglynComponentData[]
}

const ElementsRendererComponent = forwardRef<any, ElementsComponentProps>(function RefRenderFn(props, ref) {
  const {
    component: Component,
    elementComponent,
    children,
    ...rest
  } = props
  const ElementComponent = elementComponent ?? _ElementComponent
  return (
    <Component ref={ref} {...rest}>
      {children.map((data, i) => (
        <ElementComponent
          key={data?.$id ?? i}
          elementData={data}
          elementComponent={ElementComponent}
        />
      ))}
    </Component>
  )
})

ElementsRendererComponent.displayName = 'ElementsComponent'
ElementsRendererComponent.defaultProps = {
  component: Fragment,
  children: [],
}

export default memo(ElementsRendererComponent)
