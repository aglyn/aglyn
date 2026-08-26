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
 * The four site-structure surfaces each explain a different thing (AGL-2486).
 *
 * did. `/hosts/{host}/screens` and `/hosts/{host}/layouts` both resolved to
 * the one combined "Screens & Layouts" docs page, so both `?` tips opened with
 * the same title and the same body. Two surfaces, one answer, and the reader
 * cannot tell which half of the page was meant for them.
 *
 * Counting help props does not catch that — `help-coverage.spec.ts` was happy,
 * because both surfaces HAD help. It is the AGL-1074 shape: presence is not
 * distinctness. So this guard reads the RESOLVED tooltip content, the strings
 * a user actually sees, and fails when any two of the four collide.
 *
 * An anchor is deliberately not enough to make them distinct. A deep link
 * changes where the "Open documentation" button lands; it does not change one
 * character of the title or the excerpt in the tip itself, which is the thing
 * that was reported.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  docsHelp,
  type DocsHelpTopicKey,
} from '../constants/docs-links'

const REPO_ROOT = join(__dirname, '../../..')
const HOST = 'apps/console/app/(app)/[orgSlug]/hosts/[host]'

/**
 * Each console surface and the topic it must resolve to. The topic is what
 * fills the tip; the file is what proves the surface asks for it, so a
 * renamed page cannot leave this passing against nothing.
 */
const SURFACES: ReadonlyArray<{
  surface: string
  file: string
  topic: DocsHelpTopicKey
  reference: string
}> = [
  {
    surface: 'Screens',
    file: `${HOST}/screens/page.tsx`,
    topic: 'screens',
    reference: 'help="screens"',
  },
  {
    surface: 'Layouts',
    file: `${HOST}/layouts/page.tsx`,
    topic: 'layouts',
    reference: 'help="layouts"',
  },
  {
    surface: 'Reusable Components',
    file: `${HOST}/components/page.tsx`,
    topic: 'components',
    reference: 'help="components"',
  },
  {
    surface: 'Templates',
    file: `${HOST}/templates/page.tsx`,
    topic: 'templatesLibrary',
    reference: 'help="templatesLibrary"',
  },
]

describe('site-structure help tips are distinct (AGL-2486)', () => {
  it.each(SURFACES)(
    'the $surface page asks for the $topic topic',
    ({ file, reference }) => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      expect(source).toContain(reference)
    },
  )

  it('gives each of the four surfaces its own docs page', () => {
    const paths = SURFACES.map(({ topic }) => docsHelp(topic).href)
    expect(new Set(paths).size).toBe(SURFACES.length)
  })

  it('gives each of the four surfaces its own tooltip title', () => {
    const titles = SURFACES.map(({ topic }) => docsHelp(topic).title)
    expect(titles.every((title) => title.trim().length > 0)).toBe(true)
    expect(new Set(titles).size).toBe(SURFACES.length)
  })

  it('gives each of the four surfaces its own tooltip excerpt', () => {
    // The excerpt is the docs page's frontmatter `description`, verbatim. Four
    // pages with four near-identical descriptions would leave the reported bug
    // half-fixed, so this reads the resolved strings rather than the wiring.
    const excerpts = SURFACES.map(({ topic }) => docsHelp(topic).excerpt)
    expect(excerpts.every((excerpt) => excerpt.trim().length > 0)).toBe(true)
    expect(new Set(excerpts).size).toBe(SURFACES.length)
  })

  it('keeps the pre-split docs URL resolvable', () => {
    // The deployed console (v1.0.0-beta.16) links every screens/layouts tip at
    // `/building-sites/screens-and-layouts/overview`, and the docs deploy
    // independently of the console. There is no client-redirects plugin, so
    // that page has to keep existing as a hub until the console promotion
    // catches up — deleting it 404s the live product for every customer.
    expect(docsHelp('screensAndLayouts').href).toContain(
      '/building-sites/screens-and-layouts/overview',
    )
  })
})
