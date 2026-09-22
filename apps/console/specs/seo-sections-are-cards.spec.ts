/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The SEO section is a stack of cards, and every proposal still lands in one
 * (AGL-3258).
 *
 * Entity, its Address and the AI-agent guidance were `SUB_FORM` groups inside
 * the SEO card, under headings of their own; the console groups with CARDS
 * everywhere else. Splitting them is cheap to undo by accident and expensive
 * to notice, because the page still renders either way.
 *
 * ## The one that fails silently
 *
 * A plugin zone proposes values by FIELD NAME and `proposeFormDraft` routes
 * each to the card that declares it. A name no card declares is dropped —
 * deliberately, because the alternative is marking some default card dirty
 * over a value nothing renders. So the AI SEO tool naming a field the forms
 * do not is a proposal that vanishes: the reader presses "Put in the form",
 * the form does not change, and nothing anywhere reports a problem.
 *
 * Read as source. The tool is a plugin lib and this is the console, so it is
 * parsed as TEXT rather than imported — the same thing the AGL-1361 coverage
 * guards do, and for the same reason: a guard must not invert the dependency
 * graph to hold a property about it.
 */
const SCOPE = join(
  __dirname,
  '..',
  'app',
  '(app)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'host-settings-scope.tsx',
)
const SEO_PAGE = join(
  __dirname,
  '..',
  'app',
  '(app)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'setup',
  '(sections)',
  'seo',
  'page.tsx',
)
const AI_SEO_TOOL = join(
  __dirname,
  '..',
  '..',
  '..',
  'libs',
  'plugins',
  'ai',
  'src',
  'lib',
  'tools',
  'ai-seo-tool.ts',
)

const read = (path: string) => readFileSync(path, 'utf8')

/** Every `name:` the settings schemas declare. */
const declaredFieldNames = (): string[] => [
  ...new Set(
    [...read(SCOPE).matchAll(/^\s*name: '([^']+)',$/gm)].map((m) => m[1]),
  ),
]

/** Every `seo.*` path the AI SEO tool proposes into the form. */
const proposedFieldNames = (): string[] => [
  ...new Set(
    [...read(AI_SEO_TOOL).matchAll(/'(seo\.[A-Za-z.]+)'/g)].map((m) => m[1]),
  ),
]

describe('the SEO section is a stack of cards (AGL-3258)', () => {
  it('THE CONTROL: the four schemas exist and the page renders each once', () => {
    const scope = read(SCOPE)
    const page = read(SEO_PAGE)
    for (const id of [
      'hostSeo',
      'hostSeoEntity',
      'hostSeoAddress',
      'hostSeoAgent',
    ]) {
      expect([id, scope.includes(`id: '${id}'`)]).toEqual([id, true])
      const rendered = [
        ...page.matchAll(new RegExp(`schemaId="${id}"`, 'g')),
      ].length
      expect([id, rendered]).toEqual([id, 1])
    }
  })

  it('has no sub-form left to group with', () => {
    // The shape this replaced. A `SUB_FORM` reappearing here is somebody
    // adding a headed group back inside a card, which is the thing that made
    // this section look like nothing else in the console.
    expect(read(SCOPE)).not.toContain('FieldComponentType.SUB_FORM')
  })

  it('draws each media control as a card, not inside another one', () => {
    /*
     * `embedded` renders a media control as a titled section inside a
     * surrounding card — which is what the bespoke SEO form template needed
     * while the sections around it were sub-forms. On a page that stacks
     * cards it would put a card's worth of content inside a neighbour.
     */
    const page = read(SEO_PAGE)
    for (const card of [
      'FaviconCard',
      'AppIconCard',
      'SocialImageCard',
      'EntityLogoCard',
    ]) {
      expect([card, page.includes(`<${card} hostId={hostId} />`)]).toEqual([
        card,
        true,
      ])
    }
    expect(page).not.toContain('embedded')
  })

  it('keeps the entity logo next to the entity it belongs to', () => {
    // AGL-2486's finding, restated for cards: the favicon sitting between the
    // entity's fields and the entity's logo is what made the two read as
    // separate things.
    const page = read(SEO_PAGE)
    const entityForm = page.indexOf('schemaId="hostSeoEntity"')
    const logo = page.indexOf('<EntityLogoCard')
    const address = page.indexOf('schemaId="hostSeoAddress"')
    expect(entityForm).toBeGreaterThan(-1)
    expect(logo).toBeGreaterThan(entityForm)
    expect(address).toBeGreaterThan(logo)
  })

  it('declares every field the AI SEO tool proposes', () => {
    // The silent one. An unrouted name is dropped, so the reader presses
    // "Put in the form" and nothing happens.
    const declared = declaredFieldNames()
    // THE CONTROL: the parse still sees the schemas at all.
    expect(declared).toEqual(
      expect.arrayContaining(['seo.title', 'seo.entity.name']),
    )
    const proposed = proposedFieldNames()
    expect(proposed.length).toBeGreaterThanOrEqual(8)
    expect(proposed.filter((name) => !declared.includes(name))).toEqual([])
  })

  it('routes a proposal by field name rather than by a schema the caller picks', () => {
    // A caller naming one schema would have to know which of four owns each
    // value, and would drop whatever it guessed wrong about.
    const scope = read(SCOPE)
    expect(scope).toContain('const fieldOwner')
    expect(scope).toMatch(/proposeFormDraft:\s*\(values: Record<string, string>\) => void/)
    expect(read(SEO_PAGE)).toContain('proposeFormDraft(values)')
  })
})
