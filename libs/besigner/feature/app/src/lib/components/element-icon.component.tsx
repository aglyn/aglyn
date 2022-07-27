/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { NodeId } from '@aglyn/core-data-foundation'
import { useAglynElementComponentSchema } from '@aglyn/core-feature-renderer'
import { ICON_VARIANT_ENTITY_BLOCK } from '@aglyn/shared-data-enums'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { forwardRef, useMemo } from 'react'

export interface ElementIconProps extends MdiIconProps {
  $id: NodeId
}

const ElementIconComponent = forwardRef<any, ElementIconProps>((props, ref) => {
  const { $id, sx, ...rest } = props
  const icon = useAglynElementComponentSchema($id)?.icon
  const iconProps = useMemo(
    () => ({
      ...icon,
      path: icon?.path || ICON_VARIANT_ENTITY_BLOCK.path,
      sx: mergeSxProps(icon?.sx, sx),
    }),
    [icon, sx],
  )

  return (
    <MdiIcon
      ref={ref}
      fontSize="inherit"
      color="inherit"
      {...iconProps}
      {...rest}
    />
  )
})
ElementIconComponent.displayName = 'ElementIconComponent'
ElementIconComponent.defaultProps = {}

export { ElementIconComponent }
export default ElementIconComponent
