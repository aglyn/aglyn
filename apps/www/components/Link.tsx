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

import MuiButton, { ButtonProps as MuiButtonProps } from '@material-ui/core/Button'
import MuiLink, { LinkProps as MuiLinkProps } from '@material-ui/core/Link'
import clsx from 'clsx'
import { useRouter } from 'next/router'
import { forwardRef } from 'react'
import NextLink, { NextLinkProps } from './NextLink'


export type NextOnly = Omit<NextLinkProps, 'as'>
export type NextAndMuiLinkProps = MuiLinkProps & NextOnly
export type NextAndMuiButtonProps = MuiButtonProps & NextOnly

type MergedProps<T> = T extends any
  ? T extends { naked: true, button?: false }
    ? NextOnly & T
    : T extends { naked?: false, button: true }
      ? NextAndMuiButtonProps
      : NextAndMuiLinkProps & T
  : never

// type MergedPropsWithInnerRef<T> = [T] extends [any]
//   ? T extends { naked?: false, button: true }
//     ? T & InnerRefProp<HTMLButtonElement>
//     : T & InnerRefProp<HTMLAnchorElement>
//   : never

type LinkRefType<T> = T extends any
  ? T extends { naked?: false, button: true }
    ? HTMLButtonElement
    : HTMLAnchorElement
  : never

export interface BaseProps {
  activeClassName?: string
  naked?: boolean
  button?: boolean
}

export interface LinkProps extends MergedProps<BaseProps> {}

/**
 * A styled version of the Next.js Link component: https://nextjs.org/docs/#with-link
 * @export
 * @param {LinkProps} props
 * @return {JSX.Element}
 */
const Link = forwardRef<LinkRefType<LinkProps>, LinkProps>(
  function RefRenderFn(props, ref) {
    const {
      href,
      activeClassName = 'active',
      className: classNameProps,
      naked,
      button,
      ...other
    }: LinkProps & { component?: any } = props

    const router = useRouter()
    const pathname = typeof href === 'object' ? href['pathname'] : href
    const className = clsx(classNameProps, {[activeClassName]: router.pathname === pathname && activeClassName})

    if (naked) {
      return (
        <NextLink
          ref={ref as any}
          className={className}
          href={href}
          {...other}
        />
      )
    }

    if (button || other['disabled']) {
      return (
        <MuiButton
          ref={ref}
          className={className}
          component={NextLink}
          href={href as string}
          {...other as unknown}
        />
      )
    }

    return (
      <MuiLink
        ref={ref}
        className={className}
        component={NextLink}
        href={href as string}
        {...other}
      />
    )
  },
)

Link.displayName = 'Link'

export default Link
