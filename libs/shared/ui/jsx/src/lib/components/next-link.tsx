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

import { PartialPick } from '@aglyn/shared-data-types'
import Link, { LinkProps } from 'next/link'
import { AnchorHTMLAttributes, forwardRef } from 'react'

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

export interface NextLinkProps extends AnchorProps, PartialPick<LinkProps, 'as'> {
  hrefAs?: LinkProps['as']
  className?: string
}

export const NextLink = forwardRef<HTMLAnchorElement, NextLinkProps>(function RefRenderFn(
  props,
  ref
) {
  const {
    hrefAs,
    children,
    href,
    replace,
    scroll,
    passHref,
    shallow,
    prefetch,
    locale,
    as,
    component: _,
    ...rest
  }: NextLinkProps & { component?: any } = props

  return (
    <Link
      as={as ?? hrefAs}
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
})

NextLink.displayName = 'NextLink'

export default NextLink
