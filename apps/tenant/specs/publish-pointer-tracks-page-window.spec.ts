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
 * THE POINTER MUST NOT OUTLIVE THE HTML THAT READS IT (AGL-2573).
 *
 * `PUBLISH_POINTER_TTL_SECONDS` is not a tuned number — it is the catch-all
 * page's own ISR window, restated. The reasoning only holds while the two
 * agree, and they live in different projects, so nothing but this keeps them
 * together:
 *
 *  - ABOVE the window, the page regenerates on schedule and faithfully
 *    rebuilds itself from a version pointer that is still stale. That is the
 *    exact failure the shorter TTL exists to close, and raising the page
 *    window alone would silently reopen it.
 *  - BELOW the window, the shorter TTL buys nothing at all: a page served
 *    from the ISR cache never re-runs the loader, so a fresher pointer is not
 *    read by anyone. It would be paying for reads that change no outcome.
 *
 * Both numbers are read as source text rather than imported. The page module
 * cannot be imported outside a Next server context, and importing the constant
 * pulls `next/cache` in through `render-cache`, which does not load under this
 * project's test environment either. Reading the two declarations is what the
 * check is about anyway: whether the files still agree.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CATCH_ALL_PAGE = join(
  __dirname,
  '..',
  'app',
  '[host]',
  '[[...slug]]',
  'page.tsx',
)

const RENDER_CACHE = join(
  __dirname,
  '..',
  '..',
  '..',
  'libs',
  'tenant',
  'data',
  'admin',
  'src',
  'lib',
  'render-cache.ts',
)

/** The pointer backstop, read from the module that declares it. */
function pointerTtlSeconds(): number {
  const source = readFileSync(RENDER_CACHE, 'utf8')
  const match = source.match(
    /^export const PUBLISH_POINTER_TTL_SECONDS = (\d+)$/m,
  )
  if (!match) {
    throw new Error('no `PUBLISH_POINTER_TTL_SECONDS` in render-cache.ts')
  }
  return Number(match[1])
}

/** The route segment's own ISR window, read from the page that declares it. */
function pageRevalidateSeconds(): number {
  const source = readFileSync(CATCH_ALL_PAGE, 'utf8')
  const match = source.match(/^export const revalidate = (\d+)$/m)
  // A premise guard: if the declaration is ever renamed or computed, this
  // spec must fail loudly rather than pass by finding nothing to compare.
  if (!match) throw new Error('no `export const revalidate` in the catch-all page')
  return Number(match[1])
}

describe('the publish pointer TTL tracks the page window (AGL-2573)', () => {
  it('matches the catch-all page ISR window exactly', () => {
    expect(pointerTtlSeconds()).toBe(pageRevalidateSeconds())
  })

  it('reads real numbers from both files, not defaults', () => {
    // Guards the guard: a zero or a NaN on either side would make the
    // assertion above pass against nothing.
    expect(pageRevalidateSeconds()).toBeGreaterThan(0)
    expect(pointerTtlSeconds()).toBeGreaterThan(0)
  })
})
