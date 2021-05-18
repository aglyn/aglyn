/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import Link, { LinkProps } from 'next/link'


export type NextLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & LinkProps;

const NextLink = React.forwardRef<HTMLAnchorElement, NextLinkProps>(
  function RefRenderFn(props, ref) {
    const {
      as,
      children,
      href,
      replace,
      scroll,
      passHref,
      shallow,
      prefetch,
      locale,
      ...other
    } = props

    return (
      <Link
        as={as}
        href={href}
        locale={locale}
        passHref={passHref}
        prefetch={prefetch}
        replace={replace}
        scroll={scroll}
        shallow={shallow}
      >
        <a ref={ref} {...other}>
          {children}
        </a>
      </Link>
    )
  }
)

NextLink.displayName = 'NextComposedLink'

export default NextLink
