/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
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
  const pathname = typeof href === 'object' ? href.pathname : href
  const className = clsx(classNameProps, { [activeClassName]: router.pathname === pathname && activeClassName })

  if (naked) {
    return <NextLink ref={innerRef} className={className} href={href} {...other} />
  }

  if (button || other.disabled) {
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
