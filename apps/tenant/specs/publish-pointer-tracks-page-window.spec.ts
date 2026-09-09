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
  '[scheme]',
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
  /**
   * ⚑ This asserted EQUALITY until AGL-2690, and the loosening is deliberate.
   *
   * The principle `render-cache.ts` states is *"the pointer should never be
   * staler than the HTML that reads it"* — which is `<=`, not `==`. The two
   * coincided while the page window was 600s, so equality was a faithful
   * encoding and the tighter one. At 3600s they come apart, and equality is
   * now the WORSE half:
   *
   *   - the loader runs only when the page regenerates, so a pointer TTL below
   *     the window costs nothing extra — the same one read per regeneration,
   *     which is a cache miss instead of a hit;
   *   - at that regeneration it is the difference between rebuilding from a
   *     pointer up to ten minutes old and one up to an hour old. With the
   *     publish announce down — the AGL-2573 failure, which ran for eleven
   *     days — worst-case staleness is ~1.2h at 600 and ~2h at 3600.
   *
   * So `<=` is what the principle actually says, and what the numbers want.
   * The direction that must never happen is still refused below: a pointer
   * staler than the window means a page regenerates and faithfully rebuilds
   * itself from data the publish already replaced.
   */
  it('is never staler than the catch-all page ISR window', () => {
    expect(pointerTtlSeconds()).toBeLessThanOrEqual(pageRevalidateSeconds())
  })

  it('reads real numbers from both files, not defaults', () => {
    // Guards the guard: a zero or a NaN on either side would make the
    // assertion above pass against nothing.
    expect(pageRevalidateSeconds()).toBeGreaterThan(0)
    expect(pointerTtlSeconds()).toBeGreaterThan(0)
  })
})
