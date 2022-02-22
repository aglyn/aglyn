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

import {generateComponentClassKeys} from '@aglyn/shared-feature-themes'
import {_isObj} from '@aglyn/shared-util-guards'
import {truthy} from '@aglyn/shared-util-tools'
import {
  Button as MuiButton,
  ButtonBase as MuiButtonBase,
  type ButtonBaseProps as MuiButtonBaseProps,
  type ButtonProps as MuiButtonProps,
  Link as MuiLink,
  type LinkProps as MuiLinkProps,
} from '@mui/material'
import clsx from 'clsx'
import {useRouter} from 'next/router'
import {forwardRef} from 'react'
import {NextLink, type NextLinkProps} from './next-link'


export type AppLinkVariant = 'naked' | 'button' | 'button-base' | 'text' | 'default' | undefined | never
export type AppLinkVariantDefault = Extract<AppLinkVariant, 'text' | 'default' | undefined | never>

type BaseLinkProps = Omit<NextLinkProps, 'as' | 'hrefTo'>
export type TextProps = MuiLinkProps<any, BaseLinkProps>
export type ButtonProps = MuiButtonProps<any, BaseLinkProps>
export type ButtonBaseProps = MuiButtonBaseProps<any, BaseLinkProps>
export type NakedProps = MuiLinkProps<any, BaseLinkProps>
export type DefaultProps = TextProps

export type AppLinkProps<T = AppLinkVariant> =
  T extends string
    ? T extends AppLinkVariant
      ? T extends AppLinkVariantDefault ? DefaultProps & {componentVariant?: T}
        : T extends 'button' ? ButtonProps & {componentVariant: T}
          : T extends 'button-base' ? ButtonBaseProps & {componentVariant: T}
            : T extends 'naked' ? NakedProps & {componentVariant: T}
              : never
      : never
    : (DefaultProps & {componentVariant?: undefined | never})

export const appLinkClassKey = generateComponentClassKeys('AglynAppLink', [
  'disabled',
  'active',
  'variantNaked',
  'variantButton',
  'variantButtonBase',
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
  function RefRenderFn<T extends AppLinkVariant>(props: AppLinkProps<T>, ref) {
    const {className, componentVariant: variant, href, hrefAs, ...rest} = props

    const router = useRouter()
    const pathname = _isObj(href) ? href['pathname'] : href
    const isCurrentPath = router.pathname === pathname || router.pathname === href

    const isNaked = variant === 'naked',
      isButton = variant === 'button',
      isButtonBase = variant === 'button-base',
      isText = variant === 'text' || variant === 'default' || !variant

    const elemClassName = clsx({
      [appLinkClassKey.active]: isCurrentPath,
      [appLinkClassKey.disabled]: truthy(rest['disabled']),
      [appLinkClassKey.variantNaked]: isNaked,
      [appLinkClassKey.variantButton]: isButton,
      [appLinkClassKey.variantButtonBase]: isButtonBase,
      [appLinkClassKey.variantText]: isText,
    }, className)

    if (variant === 'naked') {
      return (
        <NextLink
          ref={ref}
          className={elemClassName}
          hrefTo={href || '#'}
          hrefAs={hrefAs}
          {...rest}
        />
      )
    }
    if (variant === 'button') {
      return (
        <MuiButton
          ref={ref}
          className={elemClassName}
          component={NextLink}
          hrefTo={href || '#'}
          hrefAs={hrefAs}
          {...rest}
        />
      )
    }
    if (variant === 'button-base') {
      return (
        <MuiButtonBase
          ref={ref}
          className={elemClassName}
          component={NextLink}
          hrefTo={href || '#'}
          hrefAs={hrefAs}
          {...rest}
        />
      )
    }
    return (
      <MuiLink
        ref={ref}
        className={elemClassName}
        component={NextLink}
        hrefTo={href || '#'}
        hrefAs={hrefAs}
        {...rest}
      />
    )
  },
)
AppLink.displayName = 'AppLink'

type AppLink = typeof AppLink
export {AppLink}
export default AppLink
