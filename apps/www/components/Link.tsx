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

import React from 'react'
import clsx from 'clsx'
import { useRouter } from 'next/router'
import MuiLink, { LinkProps as MuiLinkProps } from '@material-ui/core/Link'
import MuiButton, { ButtonProps as MuiButtonProps } from '@material-ui/core/Button'
import NextLink, { NextLinkProps } from './NextLink'


export type NextOnly = NextLinkProps
export type NextAndMuiLink = MuiLinkProps & NextLinkProps
export type NextAndMuiButton = MuiButtonProps & NextLinkProps

export interface BaseProps {
  activeClassName?: string
  innerRef?: React.Ref<HTMLAnchorElement>
  naked?: boolean
  button?: boolean
}

export type LinkProps = BaseProps & (
    BaseProps['naked'] extends true
      ? NextOnly
      : BaseProps['button'] extends true
        ? NextAndMuiButton /*& {variant?: MuiButtonProps['variant']}*/
        : NextAndMuiLink
  )

/**
 * A styled version of the Next.js Link component: https://nextjs.org/docs/#with-link
 * @export
 * @param {LinkProps} props
 * @return {JSX.Element}
 */
export function InnerRefLink(props: LinkProps) {
  const {
    href,
    activeClassName = 'active',
    className: classNameProps,
    innerRef,
    naked,
    button,
    ...other
  } = props

  const router = useRouter()
  const pathname = typeof href === 'object' ? href['pathname'] : href
  const className = clsx(classNameProps, { [activeClassName]: router.pathname === pathname && activeClassName })

  if (naked) {
    return <NextLink ref={innerRef} className={className} href={href} {...other} />
  }

  if (button || other['disabled']) {
    return (
      <MuiButton
        ref={innerRef}
        className={className}
        component={NextLink}
        href={href as string}
        {...other as unknown}
      />
    )
  }

  return (
    <MuiLink
      ref={innerRef}
      className={className}
      component={NextLink}
      href={href as string}
      {...other}
    />
  )
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  function LinkRefRenderFn(props, ref) {
    return (<InnerRefLink {...props} innerRef={ref} />)
  },
)

export default Link
