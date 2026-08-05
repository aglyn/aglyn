/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn'
import { ICON_VARIANT_ELEMENT } from '@aglyn/shared-data-enums'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { observer } from 'mobx-react-lite'
import { useContext } from 'react'
import { isElement, isValidElementType } from 'react-is'
import ComponentPromotionContext from '../contexts/component-promotion-context'

export interface ComponentIconProps extends MdiIconProps {
  component?: Aglyn.ComponentSchema
  /**
   * The node being drawn, when there is one. Only a reusable-component
   * instance needs it, and only to reach the icon its definition chose —
   * `component` alone cannot answer that, since every instance shares the
   * one `reusableInstance` schema (AGL-1193).
   */
  node?: Aglyn.NodeSchema<any>
}

export const ComponentIconComponent = observer((props: ComponentIconProps) => {
  const { component, node, ...rest } = props
  const Icon = component?.icon

  // An instance's definition icon outranks the schema's package glyph, which
  // is the same glyph for every component anyone has ever promoted. Read live
  // off the definition rather than denormalized onto the node, so changing a
  // component's icon reaches the instances already placed.
  const { definitions } = useContext(ComponentPromotionContext)
  const definitionIconPath = Aglyn.resolveInstanceIconPath(node, definitions)
  if (definitionIconPath) return <MdiIcon path={definitionIconPath} {...rest} />

  if (isElement(Icon)) return Icon

  return (
    <MdiIcon
      path={Icon?.path || ICON_VARIANT_ELEMENT.path}
      {...(isValidElementType(Icon) ? { component: Icon } : {})}
      {...rest}
    />
  )
})
ComponentIconComponent.displayName = 'ComponentIconComponent'

export default ComponentIconComponent
