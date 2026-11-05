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
 * AGL-4173: a same-page `#fragment` link must never raise the loading overlay.
 *
 * Measured on aglyn.com/managed: Next scrolled "See what's included" to its
 * section (y 3954), then the overlay closed and handed focus back to the
 * button, and the browser scrolled the button back into view (y 273), 6 ms
 * later. The button looked as if it went nowhere.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LoadingContext } from '../contexts/loading.context'
import {
  isSameDocumentJump,
  LinkNavigationReporter,
} from './link-navigation-reporter'

let mockPending = false
jest.mock('next/link', () => ({
  __esModule: true,
  useLinkStatus: () => ({ pending: mockPending }),
}))

const here = { href: 'https://aglyn.com/managed?x=1' }

describe('isSameDocumentJump', () => {
  it.each([
    ['#included'],
    ['#'],
    ['/managed?x=1#start'],
    ['https://aglyn.com/managed?x=1#start'],
  ])('treats %s as a jump within the page', (href) => {
    expect(isSameDocumentJump(href, here)).toBe(true)
  })

  it.each([
    ['/pricing'],
    ['/pricing#plans'],
    ['/managed#start'],
    ['/managed?x=2#start'],
    ['/managed?x=1'],
    ['https://example.com/managed?x=1#start'],
    [''],
  ])('treats %s as a real navigation', (href) => {
    expect(isSameDocumentJump(href, here)).toBe(false)
  })

  it('judges a hash-only UrlObject as a jump and anything with a path as not', () => {
    expect(isSameDocumentJump({ hash: 'start' }, here)).toBe(true)
    expect(isSameDocumentJump({ pathname: '/managed', hash: 'start' }, here)).toBe(
      false,
    )
    expect(isSameDocumentJump({ query: { x: '1' } }, here)).toBe(false)
    expect(isSameDocumentJump(undefined, here)).toBe(false)
  })
})

describe('LinkNavigationReporter', () => {
  const renderWith = (queueLoading: jest.Mock, node: ReactNode) =>
    render(
      <LoadingContext.Provider
        value={{
          loading: false,
          queueLoading,
          dequeueLoading: jest.fn(),
          dequeueAllLoading: jest.fn(),
          checkLoading: jest.fn(),
        }}
      >
        {node}
      </LoadingContext.Provider>,
    )

  afterEach(() => {
    mockPending = false
  })

  it('queues the overlay while a real navigation is pending', () => {
    mockPending = true
    const queueLoading = jest.fn(() => jest.fn())
    renderWith(
      queueLoading,
      <LinkNavigationReporter sameDocumentRef={{ current: false }} />,
    )
    expect(queueLoading).toHaveBeenCalledTimes(1)
  })

  it('never queues the overlay for a same-page jump', () => {
    mockPending = true
    const queueLoading = jest.fn(() => jest.fn())
    renderWith(
      queueLoading,
      <LinkNavigationReporter sameDocumentRef={{ current: true }} />,
    )
    expect(queueLoading).not.toHaveBeenCalled()
  })

  it('still queues for a link that passes no ref', () => {
    mockPending = true
    const queueLoading = jest.fn(() => jest.fn())
    renderWith(queueLoading, <LinkNavigationReporter />)
    expect(queueLoading).toHaveBeenCalledTimes(1)
  })
})
