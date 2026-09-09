/**
 * @license
 * Copyright 2026 Aglyn LLC
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

/**
 * AGL-2710 — route payloads are prefetched on intent, not on arrival.
 *
 * Next prefetches every link in the viewport, and for a statically generated
 * route that is the route's whole RSC payload. A visitor who reads one page
 * and leaves is served every destination its header points at: 164.5 KB
 * across 5 requests on the marketing home page. Holding the prefetch until
 * the visitor reaches for a link is what turns that into bytes only a visit
 * that might navigate pays for.
 *
 * The prop is asserted rather than the network because the prop IS the
 * mechanism: `false` suppresses viewport and hover prefetch alike in the app
 * router, so a link that stayed at `false` would fetch on the click instead.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import NextLink from './next-link'

/** The last `prefetch` value handed to `next/link`, per rendered href. */
const prefetchFor = (href: string) =>
  screen.getByTestId(`link-${href}`).getAttribute('data-prefetch')

// The router-only props are dropped rather than spread: React warns about
// every one of them as an unknown attribute on a plain anchor.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    prefetch,
    children,
    passHref: _passHref,
    replace: _replace,
    scroll: _scroll,
    shallow: _shallow,
    locale: _locale,
    ...rest
  }: any) => (
    <a
      href={String(href)}
      data-testid={`link-${href}`}
      data-prefetch={String(prefetch)}
      {...rest}
    >
      {children}
    </a>
  ),
}))

jest.mock('./link-navigation-reporter', () => ({
  __esModule: true,
  LinkNavigationReporter: () => null,
}))

describe('NextLink prefetching', () => {
  it('does not prefetch a link the visitor has not reached for', () => {
    render(<NextLink hrefTo="/pricing">Pricing</NextLink>)
    expect(prefetchFor('/pricing')).toBe('false')
  })

  it.each(['pointerEnter', 'touchStart', 'focus'] as const)(
    're-arms prefetching on %s',
    (gesture) => {
      render(<NextLink hrefTo="/pricing">Pricing</NextLink>)
      fireEvent[gesture](screen.getByTestId('link-/pricing'))
      // `undefined` is Next's own default: prefetch this route as its
      // staticness dictates, which is what a reached-for link should do.
      expect(prefetchFor('/pricing')).toBe('undefined')
    },
  )

  it('leaves an explicit prefetch alone in both directions', () => {
    render(
      <>
        <NextLink hrefTo="/always" prefetch>
          Always
        </NextLink>
        <NextLink hrefTo="/never" prefetch={false}>
          Never
        </NextLink>
      </>,
    )
    expect(prefetchFor('/always')).toBe('true')
    fireEvent.pointerEnter(screen.getByTestId('link-/never'))
    expect(prefetchFor('/never')).toBe('false')
  })

  it('still calls a handler the caller passed', () => {
    const onPointerEnter = jest.fn()
    render(
      <NextLink hrefTo="/pricing" onPointerEnter={onPointerEnter}>
        Pricing
      </NextLink>,
    )
    fireEvent.pointerEnter(screen.getByTestId('link-/pricing'))
    expect(onPointerEnter).toHaveBeenCalledTimes(1)
    expect(prefetchFor('/pricing')).toBe('undefined')
  })
})
