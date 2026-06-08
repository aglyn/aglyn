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
import { isElement, isValidElementType } from 'react-is'

export interface ComponentIconProps extends MdiIconProps {
  component?: Aglyn.ComponentSchema
}

export const ComponentIconComponent = observer((props: ComponentIconProps) => {
  const { component, ...rest } = props
  const Icon = component?.icon

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
