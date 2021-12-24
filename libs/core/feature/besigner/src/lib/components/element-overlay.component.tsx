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
  type CanvasRendererComponentProps,
  type ElementDataProps,
  ElementsRendererComponent,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {_isArrEmpty} from '@aglyn/shared-util-guards'
import ElementPopperComponent, {type ElementPopperComponentProps} from './element-popper.component'


export interface ViewportPoppersComponentProps extends ElementPopperComponentProps, ElementDataProps {
  elementRendererComponent?: CanvasRendererComponentProps['elementRendererComponent']
}

function ElementOverlayComponent(props: ViewportPoppersComponentProps) {
  const {
    elementRendererComponent: renderer,
    $id,
    ...rest
  } = props
  const ElementRenderer = renderer || ElementOverlayComponent
  const elements = useAglynElementData($id, 'elements')

  return (
    <ElementPopperComponent $id={$id} {...rest}>
      {!_isArrEmpty(elements || []) && (
        <ElementsRendererComponent
          elementRendererComponent={ElementRenderer}
          elements={elements}
        />
      )}
    </ElementPopperComponent>
  )
}

ElementOverlayComponent.displayName = 'ElementOverlayComponent'

export {ElementOverlayComponent}
export default ElementOverlayComponent
