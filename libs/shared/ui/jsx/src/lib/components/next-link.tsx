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
import {
  type AnchorHTMLAttributes,
  forwardRef,
  useCallback,
  useState,
} from 'react'
import { LinkNavigationReporter } from './link-navigation-reporter'

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
    onPointerEnter,
    onTouchStart,
    onFocus,
    ...rest
  } = props as LinkProps & NextLinkProps

  // Next prefetches every link that enters the viewport, and for a statically
  // generated route that means the route's whole RSC payload. On a page whose
  // header links to five destinations, a visitor who reads the page and leaves
  // is served all five anyway — measured at 164.5 KB across 5 requests on the
  // marketing home page, about a sixth of everything that page transfers, and
  // five tenant invocations besides.
  //
  // Prefetching is held until the visitor reaches for a link instead. Pointer,
  // touch and focus are the three ways that happens, and each precedes the
  // click by long enough for the payload to land. Flipping Next's own prop is
  // what re-arms it: `false` suppresses viewport AND hover prefetch in the app
  // router, so leaving it there would move the fetch onto the click itself.
  //
  // An explicit `prefetch` from a caller still decides — `true` for a link
  // worth paying for up front, `false` for one that must never prefetch.
  const [reachedFor, setReachedFor] = useState(false)
  const noteIntent = useCallback(() => setReachedFor(true), [])
  const compose =
    (theirs: ((event: any) => void) | undefined) => (event: any) => {
      theirs?.(event)
      noteIntent()
    }

  return (
    <Link
      ref={ref}
      href={hrefTo}
      locale={locale}
      passHref={passHref}
      prefetch={prefetch ?? (reachedFor ? undefined : false)}
      replace={replace}
      scroll={scroll}
      shallow={shallow}
      onPointerEnter={compose(onPointerEnter)}
      onTouchStart={compose(onTouchStart)}
      onFocus={compose(onFocus)}
      {...rest}
    >
      {children}
      {/* null-rendering: drives the global loading overlay off this link's
          real navigation transition (useLinkStatus), not URL-commit. */}
      <LinkNavigationReporter />
    </Link>
  )
})

NextLink.displayName = 'NextLink'
NextLink.aglyn = true

export default NextLink
