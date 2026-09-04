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
 * The entry cover's authored alt reaches the rendered `<img>` (AGL-2418).
 *
 * `coverImageAlt` already existed when this was written — AGL-2417 added it
 * so a SHARED card could say what it shows, and it reached `og:image:alt`
 * and nothing else. The picture on the page itself was still hard-coded
 * `alt=""`, so the sentence an author typed into "Cover image description"
 * was delivered to everyone who saw the link in a chat window and to nobody
 * who actually opened the post. A field that stores is not a field that
 * renders; this suite asserts the second half.
 *
 * The empty case is the load-bearing one. `alt=""` and a MISSING `alt` are
 * not the same announcement: an `<img>` with no alt makes a screen reader
 * fall back to reading the file name, so every pre-AGL-2418 entry — none of
 * which has an alt — must keep emitting the empty attribute, not lose it.
 * That is also the correct rendering here on its own merits: this cover sits
 * directly beneath `<h1>{entry.title}</h1>`, so with nothing authored the
 * title already names it and a second announcement is noise.
 */

import { act, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import CatchAllPage from '../app/[host]/[[...slug]]/catch-all-client'

/**
 * The plugin gate loads nothing. The cover `<img>` is plain JSX in
 * `catch-all-client.tsx` and every render here passes `nodes={null}`, so no
 * canvas node — and therefore no plugin-registered component — can supply the
 * element this file reads `alt` off. See the stub for the measurement.
 */
jest.mock('../utils/site-plugin-loader', () =>
  require('./site-plugin-loader-empty-manifest'),
)

/** See `tenant-media-refs.spec.tsx`: the first render suspends. */
const renderSettled = async (element: ReactElement) => {
  let container!: HTMLElement
  await act(async () => {
    container = render(element).container
  })
  return container
}

const HOST_ID = 'DXnRbPH4CQ'
const COVER = 'https://images.example.com/chart.png'

const renderEntry = async (entry: Record<string, unknown>) => {
  const container = await renderSettled(
    <CatchAllPage
      data={{ host: { $id: HOST_ID } as never }}
      nodes={null}
      content={
        {
          collection: { $id: 'c1', slug: 'blog', displayName: 'Blog' },
          entries: [],
          entry: { $id: 'e1', title: 'Hello', body: '', ...entry },
        } as never
      }
    />,
  )
  // The article really committed, so a null `img` below is a dropped image
  // rather than a page that never rendered.
  expect(container.querySelector('h1')?.textContent).toBe('Hello')
  return container.querySelector('img')
}

describe('the entry cover’s authored alt (AGL-2418)', () => {
  it('renders the sentence the author typed', async () => {
    // The gap this issue was filed for: a cover carrying information the
    // title does not carry — a chart, a face — had no way to describe
    // itself to a reader who cannot see it.
    const img = await renderEntry({
      coverImage: COVER,
      coverImageAlt: 'Quarterly revenue climbing to 4.2M',
    })

    expect(img?.getAttribute('alt')).toBe('Quarterly revenue climbing to 4.2M')
  })

  it('emits an EMPTY alt, not a missing one, for an entry authored before the field existed', async () => {
    // Every entry that already exists takes this branch. The attribute must
    // be present and empty — "skip me, the heading names it" — because an
    // absent `alt` makes a screen reader announce the file name instead.
    const img = await renderEntry({ coverImage: COVER })

    expect(img?.hasAttribute('alt')).toBe(true)
    expect(img?.getAttribute('alt')).toBe('')
  })

  it('treats a whitespace-only alt as decorative rather than announcing blanks', async () => {
    const img = await renderEntry({ coverImage: COVER, coverImageAlt: '   ' })

    expect(img?.hasAttribute('alt')).toBe(true)
    expect(img?.getAttribute('alt')).toBe('')
  })

  it('never invents alt text from the file name', async () => {
    // `inheritedMediaAlt` refuses to fabricate for the same reason:
    // "IMG_4021.jpg" read aloud is worse than silence.
    const img = await renderEntry({
      coverImage: 'https://images.example.com/IMG_4021.jpg',
    })

    expect(img?.getAttribute('alt')).toBe('')
  })
})
