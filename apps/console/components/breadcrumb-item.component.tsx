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

import {
  AppLink,
  type AppLinkProps,
  type AppLinkVariant,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import { truthy } from '@aglyn/shared-util-tools'
import { Typography } from '@mui/material'
import clsx from 'clsx'
import { forwardRef } from 'react'

export const classKeys = generateComponentClassKeys('AglynBreadcrumbItem', [
  'item',
  'disabled',
  'last',
  'centered',
  'icon',
])

export type BreadcrumbItemProps<T extends AppLinkVariant = AppLinkVariant> =
  AppLinkProps<T> & {
    icon?: MdiIconProps
    disabled?: boolean
    isLast?: boolean
    centered?: boolean
  }

export const BreadcrumbItemComponent = forwardRef(function RefRenderFn<
  T extends AppLinkVariant,
>(props: BreadcrumbItemProps<T>, ref) {
  const { icon, className, isLast, disabled, children, centered, ...rest } =
    props
  const itemClass = clsx(
    classKeys.item,
    {
      [classKeys.disabled]: truthy(disabled || isLast),
      [classKeys.centered]: Boolean(centered),
      [classKeys.last]: Boolean(isLast),
    },
    className,
  )
  const iconClass = clsx(classKeys.icon, icon?.className)

  const ItemComponent = isLast ? Typography : AppLink

  return (
    <ItemComponent ref={ref} className={itemClass} {...rest}>
      {icon?.path ? <MdiIcon {...icon} className={iconClass} /> : null}
      {children}
    </ItemComponent>
  )
})
BreadcrumbItemComponent.displayName = 'BreadcrumbItemComponent'
BreadcrumbItemComponent.aglyn = true

export default BreadcrumbItemComponent
