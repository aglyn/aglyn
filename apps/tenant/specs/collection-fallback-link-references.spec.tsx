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
 * The legacy article surface resolves a body's link references (AGL-3118).
 *
 * This renderer answers where AGL-551 could compose neither a template screen
 * nor the themed built-in, and it is reached through `catch-all-client` — which
 * rendered it OUTSIDE the screen-link context, so it had no routing map to
 * resolve anything against. Driven through the client component rather than
 * the renderer alone, because that missing provider is half the defect: a
 * fallback rendered in isolation would resolve nothing and still pass.
 */

/** The plugin gate loads nothing: every render here passes `nodes={null}`. */
jest.mock('../utils/site-plugin-loader', () =>
  require('./site-plugin-loader-empty-manifest'),
)

import { act, render } from '@testing-library/react'
import CatchAllClient from '../app/[host]/[scheme]/[[...slug]]/catch-all-client'

/** The map the page hands the renderer: one live entry, one listing. */
const ROUTES = {
  home: '/',
  'collection:blog': 'blog',
  'entry:blog/e1': 'blog/we-launched',
}

const BODY =
  'Read [the launch](entry:blog/e1), skip [the draft](entry:blog/draft), ' +
  'browse [every post](collection:blog) or [about](/about).'

const renderEntry = async (
  body: string,
  screenRoutes: Record<string, string> = ROUTES,
) => {
  let container!: HTMLElement
  await act(async () => {
    container = render(
      <CatchAllClient
        data={{ host: { $id: 'host-1' } as never }}
        nodes={null}
        screenRoutes={screenRoutes}
        content={
          {
            collection: { $id: 'blog', slug: 'blog', displayName: 'Blog' },
            entries: [],
            entry: { $id: 'e9', title: 'Hello', slug: 'hello', body },
          } as never
        }
      />,
    ).container
  })
  // The article really committed, so an absent anchor below is a resolved
  // link that was dropped rather than a page that never rendered.
  expect(container.querySelector('h1')?.textContent).toBe('Hello')
  return container
}

const hrefsIn = (container: HTMLElement) =>
  [...container.querySelectorAll('article a')].map((a) => a.getAttribute('href'))

describe('an entry body’s link references (AGL-3118)', () => {
  it('links each live target at the address it is served from', async () => {
    const container = await renderEntry(BODY)

    expect(hrefsIn(container)).toEqual([
      '/blog/we-launched',
      '/blog',
      '/about',
      // The "← Blog" link back to the listing this surface has always drawn.
      '/blog',
    ])
    expect(container.textContent).toContain('skip the draft')
  })

  it('never emits the stored reference as an href', async () => {
    const container = await renderEntry(BODY)

    expect(container.innerHTML).not.toContain('entry:')
    expect(container.innerHTML).not.toContain('collection:')
  })

  it('renders every reference as words when the map answers for nothing', async () => {
    // An entry read that failed open, or a payload composed before the map
    // existed: the body reads as prose rather than as links to nowhere.
    const container = await renderEntry(BODY, {})

    expect(hrefsIn(container)).toEqual(['/about', '/blog'])
    expect(container.textContent).toContain('Read the launch')
  })
})
