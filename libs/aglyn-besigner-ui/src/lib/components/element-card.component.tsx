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

import { ICON_VARIANT_ELEMENT } from '@aglyn/shared-data-enums'
import { CardListItem, type CardListItemProps } from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { forwardRef } from 'react'

const Icon = styled(MdiIcon)(({ theme }) => ({
  fontSize: theme.typography.pxToRem(48),
  padding: '0.15ch',
  color: 'inherit',
  overflow: 'visible',
  opacity: 0.7,
}))

export interface ElementCardProps extends CardListItemProps {
  icon?: MdiIconProps
}

export const ElementCardComponent = forwardRef<any, ElementCardProps>(
  (props, ref) => {
    const { icon, ...rest } = props

    return (
      <CardListItem ref={ref} {...rest}>
        {({ item }) => (
          <div>
            {!icon?.path && icon ? (
              (icon as any)
            ) : (
              <Icon {...icon} path={icon?.path || ICON_VARIANT_ELEMENT.path} />
            )}
          </div>
        )}
      </CardListItem>
    )
  },
)
ElementCardComponent.displayName = 'ElementCardComponent'
ElementCardComponent.aglyn = true

export default ElementCardComponent
