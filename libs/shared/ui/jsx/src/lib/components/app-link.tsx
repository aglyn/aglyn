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

import { Conditional } from '@aglyn/shared-data-types'
import { generateComponentClassKeys } from '@aglyn/shared-feature-themes'
import { _isObj } from '@aglyn/shared-util-guards'
import { yes } from '@aglyn/shared-util-tools'
import MuiButton, { ButtonProps as MuiButtonProps } from '@mui/material/Button'
import MuiLink, { LinkProps as MuiLinkProps } from '@mui/material/Link'
import clsx from 'clsx'
import { useRouter } from 'next/router'
import { ElementType, forwardRef } from 'react'
import { NextLink, NextLinkProps } from './next-link'


type LinkType = 'naked' | 'button' | 'text' | 'default'

type NakedBaseProps = NextLinkProps
type NakedTruncated = { linkType: 'naked' } & NakedBaseProps

type ButtonBaseProps = MuiButtonProps<'a', { component?: ElementType<NextLinkProps> }>
type ButtonTruncated = { linkType: 'button' } & ButtonBaseProps

type TextBaseProps = MuiLinkProps<'a', { component?: ElementType<NextLinkProps> }>
type TextTruncated = { linkType?: 'text' } & TextBaseProps

interface CommonProps {}

type TruncatedProps = ButtonTruncated | TextTruncated | NakedTruncated

export type AppLinkProps<T extends LinkType = 'default'> = CommonProps &
  Conditional<T,
    'naked',
    NakedTruncated,
    Conditional<T, 'button', ButtonTruncated, Conditional<T, 'text', TextTruncated, TruncatedProps>>>

const classKey = generateComponentClassKeys('AppLink', [
  'disabled',
  'active',
  'typeNaked',
  'typeButton',
  'typeText',
])

/**
 * A Material-UI styled version of a "composed" Next.js Link.
 *
 * Specify the `componentVariant` props to conditionally render output element
 * componentVariant === 'naked' = NextLink
 * componentVariant === 'button' = MuiButton
 * componentVariant === any = MuiLink
 *
 * @param {AppLinkProps} props
 * @return {JSX.Element}
 */
export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function RefRenderFn(
  props,
  ref,
) {
  const {className, linkType, ...rest} = props

  const router = useRouter()
  const href = rest.href
  const pathname = _isObj(href) ? href['pathname'] : href
  const isCurrentPath = router.pathname === pathname
  const elemClassName = clsx(
    {
      [classKey.active]: isCurrentPath,
      [classKey.disabled]: yes(rest['disabled']),
      [classKey.typeNaked]: linkType === 'naked',
      [classKey.typeButton]: linkType === 'button',
      [classKey.typeText]: linkType === 'text',
    },
    className,
  )

  switch (true) {
    case linkType === 'naked':
      return (
        <NextLink
          ref={ref}
          className={elemClassName}
          // href={href}
          {...(rest as NakedBaseProps)}
        />
      )
    case linkType === 'button':
      return (
        <MuiButton
          ref={ref}
          className={elemClassName}
          component={NextLink}
          // href={href as string}
          {...(rest as ButtonBaseProps)}
        />
      )
    case linkType === 'text':
    case undefined:
    default:
      return (
        <MuiLink
          ref={ref}
          className={elemClassName}
          component={NextLink}
          // href={href as string}
          {...(rest as TextBaseProps)}
        />
      )
  }
})

AppLink.displayName = 'Link'

export default AppLink
