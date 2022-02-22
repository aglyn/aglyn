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

import {generateComponentClassKeys, styled} from '@aglyn/shared-feature-themes'
import {AppLink, type AppLinkProps, AppLinkVariant} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {_isLength} from '@aglyn/shared-util-guards'
import {truthy} from '@aglyn/shared-util-tools'
import {
  Breadcrumbs as MuiBreadcrumbs,
  type BreadcrumbsProps as MuiBreadcrumbsProps,
  Typography,
} from '@mui/material'
import clsx from 'clsx'
import {forwardRef, useMemo} from 'react'


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

export type BreadcrumbItemProps = AppLinkProps & {
  icon?: MdiIconProps
  disabled?: boolean
}

export interface BreadcrumbsProps extends MuiBreadcrumbsProps {
  items: BreadcrumbItemProps[]
  centerIcons?: boolean
}

const BreadcrumbsComponent = forwardRef<any, BreadcrumbsProps>(
  function RefRenderFn(props, ref) {
    const {centerIcons, children, items, ...rest} = props

    const MemoedItem = useMemo(() => {
      const Component = forwardRef(
        function RefRenderFn<T extends AppLinkVariant>(
          props: AppLinkProps<T> & {isLast: boolean},
          ref,
        ) {
          const {
            icon,
            className,
            isLast,
            disabled,
            children,
            ...rest
          } = props
          const itemClass = clsx(classKeys.item, {
            [classKeys.disabled]: truthy(disabled || isLast),
            [classKeys.centered]: Boolean(centerIcons),
            [classKeys.last]: Boolean(isLast),
          }, className)
          const iconClass = clsx(classKeys.icon, icon?.className)

          const ItemComponent = isLast ? Typography : AppLink

          return (
            <ItemComponent
              ref={ref}
              className={itemClass}
              {...rest}
            >
              {icon ? <MdiIcon {...icon} className={iconClass} /> : null}
              {children}
            </ItemComponent>
          )
        },
      )
      Component.displayName = 'AglynBreadcrumbItem'
      return Component
    }, [centerIcons])

    return (
      <StyledBreadcrumbs ref={ref} aria-label="breadcrumb" {...rest}>
        {items.map(({...item}, key) => (
          <MemoedItem
            key={item.id ?? key}
            isLast={_isLength(key, items.length - 1)}
            disabled={_isLength(key, items.length - 1)}
            {...item}
          />
        ))}
        {children}
      </StyledBreadcrumbs>
    )
  },
)

BreadcrumbsComponent.displayName = 'AglynBreadcrumbsComponent'
BreadcrumbsComponent.defaultProps = {}

export {BreadcrumbsComponent}
export default BreadcrumbsComponent
