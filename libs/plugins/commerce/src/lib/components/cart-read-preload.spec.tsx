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
 * The cart page starts reading the stored cart while its HTML arrives
 * (AGL-4047), instead of only once the whole page has hydrated: the server
 * render carries a preload hint for the exact request the cart's fetch makes,
 * with the CORS mode a default `fetch()` uses, so the browser hands the fetch
 * the response it already has rather than reading the cart twice.
 *
 * A header badge (the button variant) is on every page and carries no hint.
 */

import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host 1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

const CART_URL = '/api/commerce/cart?hostId=host%201'

beforeEach(() => {
  document.head.innerHTML = ''
  ;(global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/commerce/cart-extras')) return { ok: true, json: async () => ({ extras: [] }) }
    return {
      ok: true,
      json: async () => ({
        lines: [{ productId: 'reader', quantity: 1, name: 'Pocket reader', unitAmountCents: 5_900 }],
        count: 1,
        subtotalCents: 5_900,
      }),
    }
  })
})

function cartPreloads(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="fetch"]')]
}

describe('the cart page reads the cart while the page loads', () => {
  it('is in the server-rendered HTML, before any script runs', () => {
    const html = renderToString(<Cart variant="inline" />)
    const link = html.match(/<link[^>]*rel="preload"[^>]*>/)?.[0] ?? ''
    expect(link).toContain('as="fetch"')
    expect(link).toContain(`href="${CART_URL.replace('&', '&amp;')}"`)
    expect(link).toContain('crossorigin="anonymous"')
  })

  it('names the exact request the cart fetches, so the fetch is answered by it', async () => {
    render(<Cart variant="inline" />)
    expect(await screen.findByText('Pocket reader')).toBeTruthy()
    const links = cartPreloads()
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(CART_URL)
    expect(links[0].getAttribute('crossorigin')).toBe('anonymous')
    const cartReads = (global.fetch as jest.Mock).mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/commerce/cart?'))
    expect(cartReads).toEqual([CART_URL])
  })

  it('is not on a header badge', async () => {
    render(<Cart variant="button" />)
    await screen.findByLabelText('Cart')
    expect(cartPreloads()).toHaveLength(0)
  })
})
