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

import { styled } from '@aglyn/shared-ui-theme'
import { _isLength } from '@aglyn/shared-util-tools'
import {
  Breadcrumbs as MuiBreadcrumbs,
  type BreadcrumbsProps as MuiBreadcrumbsProps,
} from '@mui/material'
import { forwardRef } from 'react'
import BreadcrumbItemComponent, {
  type BreadcrumbItemProps,
  classKeys,
} from './breadcrumb-item.component'


const Breadcrumbs = styled(MuiBreadcrumbs, {
  name: 'AglynBreadcrumbs',
})(({ theme }) => {
  // In CSS vars mode theme.palette.* always returns the static light values;
  // use (theme.vars || theme) so all palette refs become live CSS custom-property
  // references that switch when the .dark class toggles on <html>.
  const tv = (theme as any).vars || theme

  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: theme.spacing(4),

    [`& .${classKeys.item}`]: {
      color: tv.palette.text.primary,
      display: 'flex',
      fontWeight: theme.typography.fontWeightRegular,
      transition: theme.transitions.create('color', {
        easing: theme.transitions.easing.easeInOut,
        duration: theme.transitions.duration.leavingScreen,
      }),
      ':hover': {
        transition: theme.transitions.create('color', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.shortest,
        }),
      },
      [`&.${classKeys.last}, &.${classKeys.disabled}`]: {
        fontWeight: theme.typography.fontWeightMedium,
        textDecoration: 'none',
        cursor: 'default',
        pointerEvents: 'default',
        color: tv.palette.text.secondary,
      },
      [`&.${classKeys.centered}`]: {
        alignItems: 'center',
      },
      [`& .${classKeys.icon}`]: {
        marginRight: theme.spacing(0.5),
        width: 20,
        height: 20,
      },
    },
  }
})

export interface BreadcrumbsProps extends MuiBreadcrumbsProps {
  items: BreadcrumbItemProps[]
  centered?: boolean
}

export const BreadcrumbsComponent = forwardRef<any, BreadcrumbsProps>(
  (props, ref) => {
    const { centered, children, items = [], ...rest } = props

    return (
      <Breadcrumbs ref={ref} aria-label="breadcrumb" {...rest}>
        {items.map(({ className, ...item }, key, arr) => (
          <BreadcrumbItemComponent
            key={item.key ?? item.id ?? key}
            isLast={_isLength(key, arr.length - 1)}
            centered={centered}
            {...item}
          />
        ))}
        {children}
      </Breadcrumbs>
    )
  },
)

BreadcrumbsComponent.displayName = 'BreadcrumbsComponent'
BreadcrumbsComponent.aglyn = true

export default BreadcrumbsComponent
