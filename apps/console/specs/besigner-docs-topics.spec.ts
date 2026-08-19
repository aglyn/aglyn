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
 * Every besigner docs topic has a surface that links to it (AGL-2130).
 *
 * The editor gets its own generated topic subset, because
 * `libs/besigner/feature/designer` cannot import console constants. It is
 * generated, type-checked, and anchor-validated — everything the console's
 * registry is — and none of that says whether anything ever renders a link.
 *
 * It didn't. `BESIGNER_TOPICS` declared **nine** topics and the whole besigner
 * referenced exactly **one** of them, `responsiveStyling`. The other eight —
 * `besigner`, `dragDropHierarchy`, `textEditing`, `reusableComponents`,
 * `interactions`, `bindings`, `screens`, `seo` — were a promise of contextual
 * help that no surface in the product could deliver, and the only symptom was
 * its absence. That is the `API_SCOPES` failure in another costume (AGL-899,
 * AGL-2127): a declaration nobody enforces reads as a shipped feature.
 *
 * So this guard holds the generator and the call sites together, in the
 * direction that matters: a topic exists **because** something links to it.
 * Adding one means adding its call site in the same change.
 *
 * `help-coverage.spec.ts` deliberately does not cover the editor — those pages
 * render neither `DashboardLayout` nor `CardDisplay`, so counting them there
 * would report a hole that is not one. This is the editor's half.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')
const GENERATOR = join(REPO_ROOT, 'tools/scripts/generate-docs-help.mjs')
const BESIGNER_LIB = join(REPO_ROOT, 'libs/besigner')
const CONSOLE_ROOT = join(REPO_ROOT, 'apps/console')

/** Topic keys declared in the generator's `BESIGNER_TOPICS` literal. */
function declaredTopics(): string[] {
  const source = readFileSync(GENERATOR, 'utf8')
  const start = source.indexOf('const BESIGNER_TOPICS = {')
  if (start < 0) return []
  const open = source.indexOf('{', start)
  const close = source.indexOf('}', open)
  return [...source.slice(open, close).matchAll(/^\s*([A-Za-z]+):/gm)].map(
    (match) => match[1],
  )
}

/** Topic keys any `besignerDocsUrl('…')` call site actually asks for. */
function referencedTopics(): string[] {
  const referenced = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry) || /\.spec\.tsx?$/.test(entry)) continue
      // The util's own file declares the function; its doc comment names a
      // topic by way of example, which is not a call site.
      if (full.endsWith('utils/docs-help.ts')) continue
      const source = readFileSync(full, 'utf8')
      for (const match of source.matchAll(/besignerDocsUrl\(\s*'([A-Za-z]+)'/g)) {
        referenced.add(match[1])
      }
    }
  }
  walk(BESIGNER_LIB)
  walk(CONSOLE_ROOT)
  return [...referenced]
}

const declared = declaredTopics()
const referenced = referencedTopics()

describe('besigner docs topics (AGL-2130)', () => {
  // Anti-vacuity, both halves. Each list is parsed out of source, so a rename
  // or a move turns this into a comparison of two empty sets — which passes,
  // loudly says nothing, and is exactly the failure mode the guard exists to
  // stop somewhere else.
  it('parsed both the declarations and the call sites', () => {
    expect(declared.length).toBeGreaterThan(0)
    expect(referenced.length).toBeGreaterThan(0)
  })

  it('links every declared topic from a real surface', () => {
    const unused = declared.filter((topic) => !referenced.includes(topic))
    if (unused.length > 0) {
      throw new Error(
        `BESIGNER_TOPICS declares ${unused.join(
          ', ',
        )}, which no besignerDocsUrl() call site asks for. A topic nobody links is a help link the product promises and cannot deliver. Either add the call site, or remove the topic from BESIGNER_TOPICS in tools/scripts/generate-docs-help.mjs — a topic belongs there in the same change that ships the surface using it.`,
      )
    }
  })

  it('declares every topic a call site asks for', () => {
    // The other direction. `besignerDocsUrl` is typed against the generated
    // keys, so an undeclared one is already a compile error — this catches the
    // case where somebody widens the type to make it compile.
    const undeclared = referenced.filter((topic) => !declared.includes(topic))
    expect(undeclared).toEqual([])
  })
})
