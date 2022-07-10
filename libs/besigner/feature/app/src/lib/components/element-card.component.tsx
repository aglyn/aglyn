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

import { ICON_VARIANT_ENTITY_BLOCK } from '@aglyn/shared-data-enums'
import {
  CardIconListItem,
  type CardIconListItemProps,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { useForkedSxProps } from '@aglyn/shared-ui-theme'
import { forwardRef } from 'react'

export interface ElementCardProps extends CardIconListItemProps {
  label: string
  icon?: MdiIconProps
}

const ElementCardComponent = forwardRef<any, ElementCardProps>((props, ref) => {
  const { item, label, icon, ...rest } = props
  const _iconSx = useForkedSxProps(
    {
      fontSize: { xs: `5ch`, sm: `4ch` },
      padding: `0.15ch`,
      color: 'quaternary.main',
      overflow: 'visible',
    },
    icon?.sx,
  )

  return (
    <CardIconListItem ref={ref} item={item} label={label} {...rest}>
      {({ item }) => (
        <div>
          {!icon?.path && icon ? (
            (icon as any)
          ) : (
            <MdiIcon
              {...icon}
              path={icon?.path || ICON_VARIANT_ENTITY_BLOCK.path}
              sx={_iconSx}
            />
          )}
        </div>
      )}
    </CardIconListItem>
  )
})
ElementCardComponent.displayName = 'ElementCardComponent'
ElementCardComponent.aglyn = true
ElementCardComponent.defaultProps = {}
export { ElementCardComponent }
export default ElementCardComponent
