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
 * AGL-1139: every site block that WRITES must go through `useSiteFetch`.
 *
 * Preview now supplies a real `hostId`, which is what turns thirty
 * `if (!hostId)` placeholders into working blocks — and simultaneously what
 * would let a block place an order or book a table from a surface that exists
 * to answer "what will this look like". `useSiteFetch` refuses those, but only
 * for blocks that call it.
 *
 * So the guard is asserted at the DECLARATION rather than by testing each
 * block: thirteen files remembering is thirteen chances for the fourteenth to
 * forget, and the way that failure presents — a preview click quietly creating
 * real data — is invisible until someone finds the record.
 *
 * Scope is deliberately narrow. Only files under a plugin's `components/`
 * that read `useSite()`, i.e. things rendered INTO a site tree. Console cards
 * live under `components/console/` and never mount inside `SiteContext`, so
 * they are not in scope and must not be dragged in by a broader pattern.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, sep } from 'path'

/** Repo root, from `libs/aglyn/src/lib/app-utils`. */
const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const PLUGINS = join(ROOT, 'libs', 'plugins')

/**
 * Not yet migrated, and each one is a real gap rather than an exemption.
 *
 * `libs/plugins/mui` is being actively edited in a parallel workstream, so
 * these were left alone rather than risk a conflicting edit. `form.tsx` is the
 * one that matters most — a form submitted from Preview is a real submission —
 * and is called out on the issue. **This list must only ever shrink.**
 */
const NOT_YET_MIGRATED = [
  'mui/src/lib/components/form.tsx',
  'mui/src/lib/components/product.tsx',
]

const UNSAFE = /method:\s*'(?!GET|HEAD|OPTIONS|get|head|options)\w+'/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.spec.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** Site blocks: under a plugin's components/, outside console/, reading useSite. */
function siteBlocks(): string[] {
  return walk(PLUGINS)
    .filter((p) => p.includes(`${sep}components${sep}`))
    .filter((p) => !p.includes(`${sep}console${sep}`))
    .filter((p) => /\buseSite\(\)/.test(readFileSync(p, 'utf8')))
    .map((p) => p.slice(PLUGINS.length + 1))
}

/** Mutating `fetch(` calls not routed through a site-aware fetch. */
function bareWrites(relative: string): number {
  const source = readFileSync(join(PLUGINS, relative), 'utf8')
  let count = 0
  const pattern = /(\w*)\bfetch\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    // `siteFetch(` — already routed. Anything else named `*fetch(` is not.
    if (match[1] === 'site' || match[1] === 'Site') continue
    if (UNSAFE.test(source.slice(match.index, match.index + 400))) count += 1
  }
  return count
}

describe('preview write coverage (AGL-1139)', () => {
  const blocks = siteBlocks()

  it('CONTROL — the scan actually finds site blocks', () => {
    // Without this the suite passes vacuously the moment the directory layout
    // moves: zero files scanned is zero violations found.
    expect(blocks.length).toBeGreaterThan(10)
    expect(blocks).toContain('commerce/src/lib/components/cart.tsx')
  })

  it('CONTROL — the scan can still see a bare mutating fetch', () => {
    // The detector proved against the known-unmigrated files. If this ever
    // goes green because `bareWrites` stopped matching rather than because
    // those files were fixed, the whole guard would be silently dead.
    const stillBare = NOT_YET_MIGRATED.filter((p) => bareWrites(p) > 0)
    expect(stillBare).toEqual(NOT_YET_MIGRATED)
  })

  it('no site block writes with a bare fetch', () => {
    const offenders = blocks
      .filter((p) => !NOT_YET_MIGRATED.includes(p))
      .filter((p) => bareWrites(p) > 0)
    // If this fails, the block is one `const siteFetch = Aglyn.useSiteFetch()`
    // away — not an exemption on the list above.
    expect(offenders).toEqual([])
  })
})
