/**
 * @license
 * Copyright 2024 Aglyn LLC
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
'use client'

import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import { _isObj } from '@aglyn/shared-util-tools'
import { truthy } from '@aglyn/shared-util-tools'
import type {
  ButtonBaseProps as MuiButtonBaseProps,
  ButtonProps as MuiButtonProps,
  FabProps as MuiFabProps,
  IconButtonProps as MuiIconButtonProps,
  LinkProps as MuiLinkProps,
} from '@mui/material'
import {
  Button as MuiButton,
  ButtonBase as MuiButtonBase,
  Link as MuiLink,
} from '@mui/material'
import clsx from 'clsx'
import dynamic, { type DynamicOptionsLoadingProps } from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { forwardRef, useMemo } from 'react'
import NextLink, { type NextLinkProps } from './next-link'

const Placeholder = (props: DynamicOptionsLoadingProps) => {
  const { error } = props
  console.log('props', props)
  if (error) console.error(error)
  return <a href={'#'}>{error ? 'error!' : 'loading'}</a>
}

const MuiFab = dynamic<MuiFabProps>(() => import('@mui/material/Fab'), {
  loading: Placeholder,
  ssr: true,
})
const MuiIconButton = dynamic<MuiIconButtonProps>(
  () => import('@mui/material/IconButton'),
  { loading: Placeholder, ssr: true },
)

export type AppLinkVariant =
  | 'naked'
  | 'button'
  | 'button-base'
  | 'icon-button'
  | 'fab'
  | 'text'
  | 'default'
  | undefined
  | never

type BaseLinkProps = Omit<NextLinkProps, 'hrefTo'>
export type ButtonBaseProps = MuiButtonBaseProps<any, BaseLinkProps>
export type ButtonProps = MuiButtonProps<any, BaseLinkProps>
export type DefaultProps = TextProps
export type FabProps = MuiFabProps<any, BaseLinkProps>
export type IconButtonProps = MuiIconButtonProps<any, BaseLinkProps>
export type NakedProps = MuiLinkProps<any, BaseLinkProps>
export type TextProps = MuiLinkProps<any, BaseLinkProps>

export type AppLinkVariantDefault = Extract<
  AppLinkVariant,
  'text' | 'default' | undefined | never
>

export type AppLinkProps<T = AppLinkVariant> = T extends string
  ? T extends AppLinkVariant
    ? T extends AppLinkVariantDefault
      ? DefaultProps & { componentVariant?: T }
      : T extends 'button'
        ? ButtonProps & { componentVariant: T }
        : T extends 'button-base'
          ? ButtonBaseProps & { componentVariant: T }
          : T extends 'icon-button'
            ? IconButtonProps & { componentVariant: T }
            : T extends 'fab'
              ? FabProps & { componentVariant: T }
              : T extends 'naked'
                ? NakedProps & { componentVariant: T }
                : never
    : never
  : DefaultProps & { componentVariant?: undefined | never }

export type AppLinkSimpleLinkProps = AppLinkProps<AppLinkVariantDefault>
export type AppLinkNakedLinkProps = AppLinkProps<'naked'>
export type AppLinkButtonProps = AppLinkProps<'button'>
export type AppLinkButtonBaseProps = AppLinkProps<'button-base'>
export type AppLinkIconButtonProps = AppLinkProps<'icon-button'>
export type AppLinkFabProps = AppLinkProps<'fab'>

export const appLinkClassKey = generateComponentClassKeys('AglynAppLink', [
  'active',
  'activeAsAncestor',
  'disabled',
  'variantButton',
  'variantButtonBase',
  'variantDefault',
  'variantFab',
  'variantIconButton',
  'variantNaked',
  'variantText',
])

/**
 * A Material-UI styled version of a "composed" Next.js Link.
 *
 * Specify the `componentVariant` props to conditionally render output element
 * componentVariant === 'naked' = NextLink
 * componentVariant === 'button' = MuiButton
 * componentVariant === any = MuiLink
 */
const AppLink = forwardRef(
  <T extends AppLinkVariant>(props: AppLinkProps<T>, ref) => {
    const { className, componentVariant, href, ...rest } = props

    const variant = componentVariant
    const pathname = usePathname()
    const [active, activeAsAncestor] = useMemo(() => {
      const hrefPath = _isObj(href) ? href['pathname'] : href,
        samePath = hrefPath === pathname,
        isRootHref = hrefPath === '/',
        pathIsAncestor = pathname.startsWith(hrefPath),
        currentlyNested = pathname.lastIndexOf('/') > 0,
        isSpecified = truthy(hrefPath)
      const active = isSpecified && samePath
      const activeAsAncestor =
        isSpecified && !isRootHref && currentlyNested && pathIsAncestor
      return [active, !active && activeAsAncestor]
    }, [href, pathname])

    const elemClassName = clsx(
      {
        [appLinkClassKey.active]: active || truthy(rest['active']),
        [appLinkClassKey.activeAsAncestor]: activeAsAncestor,
        [appLinkClassKey.disabled]: truthy(rest['disabled']),
        [appLinkClassKey.variantNaked]: variant === 'naked',
        [appLinkClassKey.variantButton]: variant === 'button',
        [appLinkClassKey.variantButtonBase]: variant === 'button-base',
        [appLinkClassKey.variantIconButton]: variant === 'icon-button',
        [appLinkClassKey.variantFab]: variant === 'fab',
        [appLinkClassKey.variantText]:
          variant === 'text' || variant === 'default' || !variant,
        [appLinkClassKey.variantDefault]: variant === 'default' || !variant,
      },
      className,
    )

    switch (variant) {
      case 'naked':
        return (
          <NextLink
            ref={ref}
            className={elemClassName}
            hrefTo={href || ''}
            {...rest}
          />
        )

      case 'button':
        return (
          <MuiButton
            ref={ref}
            className={elemClassName}
            component={NextLink}
            hrefTo={href || ''}
            {...rest}
          />
        )

      case 'button-base':
        return (
          <MuiButtonBase
            ref={ref}
            className={elemClassName}
            component={NextLink}
            hrefTo={href || ''}
            {...rest}
          />
        )

      case 'icon-button':
        return (
          <MuiIconButton
            ref={ref}
            className={elemClassName}
            component={NextLink}
            hrefTo={href || ''}
            {...rest}
          />
        )

      case 'fab':
        return (
          <MuiFab
            ref={ref}
            className={elemClassName}
            component={NextLink}
            hrefTo={href || ''}
            {...rest}
          />
        )

      default:
        return (
          <MuiLink
            ref={ref}
            className={elemClassName}
            component={NextLink}
            hrefTo={href || ''}
            {...rest}
          />
        )
    }
  },
)
AppLink.displayName = 'AppLink'
AppLink.aglyn = true

type AppLink = typeof AppLink
export { AppLink }
export default AppLink
