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

import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import { AppLink, AppLinkProps, SvgPathIcon, SvgPathIconProps } from '@aglyn/shared-ui-jsx'
import { _isLength } from '@aglyn/shared-util-guards'
import { yes } from '@aglyn/shared-util-tools'
import MuiBreadcrumbs, { BreadcrumbsProps as MuiBreadcrumbsProps } from '@mui/material/Breadcrumbs'
import Typography from '@mui/material/Typography'
import clsx from 'clsx'
import React, { forwardRef, useMemo } from 'react'


const classKeys = generateComponentClassKeys('AglynBreadcrumbs', [
  'item',
  'disabled',
  'last',
  'centered',
  'icon',
])

const StyledBreadcrumbs = styled(MuiBreadcrumbs, {
  name: 'AglynBreadcrumbs',
})(({theme}) => ({
  display: 'flex',
  alignItems: 'center',
  minHeight: theme.spacing(4),
  [`& .${classKeys.item}`]: {
    display: 'flex',
    cursor: 'pointer',
  },
  [`& .${classKeys.disabled}`]: {
    cursor: 'default',
  },
  [`& .${classKeys.last}`]: {
    opacity: 0.68,
    textDecoration: 'none',
  },
  [`& .${classKeys.centered}`]: {
    alignItems: 'center',
  },
  [`& .${classKeys.icon}`]: {
    marginRight: theme.spacing(0.5),
    width: 20,
    height: 20,
  },
}))

export interface ItemProps extends AppLinkProps<'text'> {
  icon?: SvgPathIconProps
  disabled?: boolean
}

export interface BreadcrumbsProps extends MuiBreadcrumbsProps {
  items: ItemProps[]
  centerIcons?: boolean
}

export const Breadcrumbs = forwardRef<any, BreadcrumbsProps>(function RefRenderFn(props, ref) {
  const {centerIcons, children, items, ...rest} = props

  const MemoedItem = useMemo(() => {
    const Component = forwardRef<any, ItemProps & { isLast: boolean }>(function RefRenderFn(
      itemProps,
      ref,
    ) {
      const {icon, className, isLast, disabled, ...item} = itemProps
      const isDisabled = yes(disabled || isLast)
      const itemClass = clsx(
        classKeys.item,
        {
          [classKeys.disabled]: isDisabled,
          [classKeys.centered]: Boolean(centerIcons),
          [classKeys.last]: Boolean(isLast),
        },
        className,
      )

      const ItemComponent = isLast ? Typography : AppLink

      return (
        <ItemComponent ref={ref as any} className={itemClass} {...item}>
          {icon ? <SvgPathIcon className={classKeys.icon} {...icon} /> : null}
          {item.children}
        </ItemComponent>
      )
    })
    Component.displayName = 'BreadcrumbItem'
    return Component
  }, [centerIcons])

  return (
    <StyledBreadcrumbs ref={ref} aria-label="breadcrumb" {...rest}>
      {items.map(({...item}, key) => (
        <MemoedItem
          key={item.id || item['key'] || key}
          isLast={_isLength(key, items.length - 1)}
          {...item}
        />
      ))}
      {children}
    </StyledBreadcrumbs>
  )
})

Breadcrumbs.displayName = 'Breadcrumbs'

export default Breadcrumbs
