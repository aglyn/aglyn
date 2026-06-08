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

import { styled } from '@mui/material/styles'
import Link, { type LinkProps } from 'next/link'
import { type AnchorHTMLAttributes, forwardRef } from 'react'

export interface NextAnchorProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {}

// Add support for the sx prop
export const NextAnchor = styled('a', {
  name: 'AglynNextLink',
})<NextAnchorProps>({})
NextAnchor.displayName = 'NextAnchor'
NextAnchor.aglyn = true

export type NextLinkBaseProps = Omit<NextAnchorProps, 'href'> &
  Omit<LinkProps, 'href'> &
  JSX.OverrideableComponentProps

export interface NextLinkProps extends NextLinkBaseProps, NextLinkBaseProps {
  hrefTo?: LinkProps['href']
}

export const NextLink = forwardRef<any, NextLinkProps>((props, ref) => {
  const {
    href: _2,
    hrefTo,
    replace,
    scroll,
    passHref = true,
    shallow,
    prefetch,
    locale,
    children,
    ...rest
  } = props as LinkProps & NextLinkProps

  return (
    <Link
      ref={ref}
      href={hrefTo}
      locale={locale}
      passHref={passHref}
      prefetch={prefetch}
      replace={replace}
      scroll={scroll}
      shallow={shallow}
      {...rest}
    >
      {children}
    </Link>
  )
})

NextLink.displayName = 'NextLink'
NextLink.aglyn = true

export default NextLink
