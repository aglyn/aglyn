/**
 * @jest-environment node
 */

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
 * The structural guard for AGL-1059, and the reason it is structural.
 *
 * Next resolves `title` by walking route segments. A segment that sets a
 * PLAIN STRING title carries no template of its own, so it consumes the
 * ancestor template and every titled route nested below it renders
 * unbranded — `/zgover/hosts/demo/media` came out as "Media · demo", with
 * no "· Aglyn", while `/signin` one level down from the root was fine.
 *
 * Nothing about that is loud. There is no error, no warning, no type
 * error; the only symptom is a browser tab, on some routes, that nobody
 * is looking at while they add a route. It regressed twice already
 * (AGL-1059 landed three times) and it will regress again the next time
 * somebody adds a titled page under a titled layout — which is the normal
 * way to add a page.
 *
 * So this asserts the invariant on the SOURCE rather than the rendered
 * output: any title-setting file with a titled descendant must re-declare
 * the template, which is exactly what `segmentTitle()` does. A rendered
 * check would need a running, authenticated console and would still only
 * cover the routes somebody remembered to list.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP_DIR = join(__dirname)

/** Files Next reads metadata from. */
const METADATA_FILES = new Set(['layout.tsx', 'page.tsx'])

interface TitledFile {
  /** Path relative to app/, for readable failures. */
  rel: string
  /** Directory owning it, relative to app/. */
  dir: string
  /** True when the title carries a template (object form or segmentTitle). */
  hasTemplate: boolean
}

function walk(dir: string, rel = ''): TitledFile[] {
  const found: TitledFile[] = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      found.push(...walk(abs, rel ? `${rel}/${entry}` : entry))
      continue
    }
    if (!METADATA_FILES.has(entry)) continue
    const source = readFileSync(abs, 'utf8')
    // Strip comments so prose about titles cannot register as a title.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    if (!/\btitle\s*:/.test(code)) continue
    found.push({
      rel: rel ? `${rel}/${entry}` : entry,
      dir: rel,
      hasTemplate:
        /\btitle\s*:\s*segmentTitle\s*\(/.test(code) ||
        /\btitle\s*:\s*\{[^}]*\btemplate\b/.test(code),
    })
  }
  return found
}

/** Whether `child` is nested strictly below `parent` in the route tree. */
const isBelow = (parent: string, child: string) =>
  parent === '' ? child !== '' : child.startsWith(`${parent}/`)

describe('console tab titles keep the brand (AGL-1059)', () => {
  const titled = walk(APP_DIR)

  it('finds the title-setting files at all', () => {
    // A guard that silently matches nothing passes forever. If a refactor
    // moves titles somewhere this walk cannot see, fail here rather than
    // reporting a clean run over an empty set.
    expect(titled.length).toBeGreaterThan(10)
    expect(titled.some((file) => file.rel === 'layout.tsx')).toBe(true)
  })

  it('re-declares the template on every layout with a titled route below it', () => {
    const offenders = titled
      // Only a LAYOUT hands its title down. A `page.tsx` is always a leaf:
      // it titles its own route and nothing else, even when sibling
      // directories nest below it on disk. Flagging pages would demand a
      // template that Next would never consult.
      .filter((file) => file.rel.endsWith('layout.tsx'))
      .filter((file) => !file.hasTemplate)
      .filter((file) =>
        titled.some(
          (other) => other !== file && isBelow(file.dir, other.dir),
        ),
      )
      .map((file) => file.rel)

    // Fix by returning `segmentTitle('…')` instead of a bare string. A LEAF
    // layout may keep the plain string — it has nothing below to hand the
    // template to, which is why this only flags files with descendants.
    expect(offenders).toEqual([])
  })

  it('uses one brand template, defined once', () => {
    const rootLayout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')
    const { TITLE_TEMPLATE } = require('./page-title') as {
      TITLE_TEMPLATE: string
    }
    expect(TITLE_TEMPLATE).toMatch(/^%s .+/)
    // The root declares the same template `segmentTitle` hands down. If
    // these drift, routes render under two different brand strings
    // depending on depth — the bug this file exists to prevent, wearing a
    // different hat.
    expect(rootLayout).toContain(TITLE_TEMPLATE)
  })
})
