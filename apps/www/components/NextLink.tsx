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
      ...rest
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
        <a ref={ref} {...rest}>
          {children}
        </a>
      </Link>
    )
  }
)

NextLink.displayName = 'NextComposedLink'

export default NextLink
