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

import { forwardRef, memo } from 'react'
import { AglynComponentData } from '@aglyn/framework/sdk'
import ElementComponent, { ElementRendererComponentProps } from './element-renderer.component'
import { ComponentProp } from '@aglyn/shared/ui/react'
import ElementsComponent from './elements-renderer.component'


export interface WebsiteComponentProps extends ComponentProp {
  elements?: AglynComponentData[]
  elementComponent?: ElementRendererComponentProps['elementComponent']
}

const WebsiteRendererComponent = forwardRef<any, WebsiteComponentProps>(function RefRenderFn(props, ref) {
  const {component: Component, elementComponent, elements, ...rest} = props
  return (
    <Component ref={ref} {...rest}>
      <ElementsComponent children={elements} elementComponent={elementComponent} />
    </Component>
  )
})

WebsiteRendererComponent.displayName = 'WebsiteComponent'
WebsiteRendererComponent.defaultProps = {
  component: 'div',
  elementComponent: ElementComponent,
  elements: [],
}

export default memo(WebsiteRendererComponent)
