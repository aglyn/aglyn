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
 *
 * **Presence is not correctness (AGL-2167).** Counting call sites answers
 * "is this topic linked from somewhere", which every topic satisfies if the
 * whole editor points at the same page — the exact shape of AGL-1074, where
 * twelve plugin surfaces shared one "Plugins & Marketplace" tooltip and the
 * coverage guard was happy. So the second half of this file pins each topic
 * to the SURFACE it belongs beside: a file, a marker that identifies the
 * panel inside it, and a proximity window. Repointing the SEO panel at the
 * `screens` page leaves both topics referenced in that file and still fails,
 * because `seo` no longer appears next to the SEO heading.
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

/**
 * Where each topic's help affordance must live: the file rendering the
 * panel, and a marker naming that panel inside it. The marker has to be a
 * string only that surface contains — a heading label, the control it
 * captions — so that "the right file" cannot stand in for "the right
 * panel" in a file rendering several.
 *
 * `NEAR_LINES` is the window a `besignerDocsUrl('<topic>')` call has to
 * fall inside, measured from the marker. It is deliberately tight: wide
 * enough for the JSX a `HelpTip` needs, too narrow for the next panel down.
 */
const NEAR_LINES = 18

const DESIGNER = 'libs/besigner/feature/designer/src/lib/components'
const SCREEN_EDITOR =
  "apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx"

const TOPIC_SURFACES: Record<string, { file: string; marker: string }> = {
  besigner: {
    file: `${DESIGNER}/app-bar-primary.component.tsx`,
    marker: '<BesignerSvgLogo',
  },
  bindings: {
    file: `${DESIGNER}/insert-token-menu.component.tsx`,
    marker: 'placeholder="Search data',
  },
  dragDropHierarchy: {
    file: `${DESIGNER}/aside-panel.component.tsx`,
    marker: "{'Add Element'}",
  },
  elementCatalog: {
    file: `${DESIGNER}/element-detail.component.tsx`,
    marker: "{'Learn more'}",
  },
  // Its own panel tab since AGL-1486, out of the bottom of Attributes.
  interactions: {
    file: `${DESIGNER}/element-interactions-form.component.tsx`,
    marker: "{'Interactions'}",
  },
  layouts: { file: SCREEN_EDITOR, marker: "{'Shared layout'}" },
  responsiveStyling: {
    file: `${DESIGNER}/element-styles-form.component.tsx`,
    marker: '<BoxStyler',
  },
  reusableComponents: {
    file: `${DESIGNER}/component-accordion-list.tsx`,
    marker: 'item?.$id === REUSABLE_COMPONENT_CATEGORY',
  },
  seo: { file: SCREEN_EDITOR, marker: "{'SEO'}" },
  textEditing: {
    file: `${DESIGNER}/element-props-form.component.tsx`,
    marker: '<ElementPropsFormTemplate',
  },
}

describe('besigner docs topics point at the right panel (AGL-2167)', () => {
  it('names a surface for every declared topic, and declares every named one', () => {
    expect([...declared].sort()).toEqual(Object.keys(TOPIC_SURFACES).sort())
  })

  it.each(Object.entries(TOPIC_SURFACES))(
    '%s is linked from the panel it explains',
    (topic, { file, marker }) => {
      const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n')

      // A marker that stopped matching, or that now matches twice, makes
      // the proximity check meaningless — fail on the marker itself rather
      // than let it decide anything.
      const markerLines = lines.flatMap((line, index) =>
        line.includes(marker) ? [index] : [],
      )
      expect({ topic, marker, matches: markerLines.length }).toEqual({
        topic,
        marker,
        matches: 1,
      })

      const at = markerLines[0]
      const window = lines
        .slice(Math.max(0, at - NEAR_LINES), at + NEAR_LINES + 1)
        .join('\n')
      // Matched with the SAME regex the error message reports with, so the
      // two cannot disagree. A literal single-line match made this guard
      // formatting-sensitive: prettier splitting the call across lines —
      // which it does the moment the surrounding JSX gains a level of
      // indentation — read as "the topic is not linked here" while the
      // message underneath cheerfully printed the topic it had just found
      // (AGL-2486).
      const nearby = [
        ...window.matchAll(/besignerDocsUrl\(\s*'([A-Za-z]+)'/g),
      ].map((match) => match[1])
      if (!nearby.includes(topic)) {
        // What IS next to the marker, if anything — a wrong topic is the
        // failure this test exists for, so name it.
        const wrong = nearby
        throw new Error(
          `${file} should link besignerDocsUrl('${topic}') within ${NEAR_LINES} lines of ${marker} (line ${
            at + 1
          }) — the panel that topic describes. ${
            wrong.length
              ? `Found ${wrong.join(', ')} there instead, which sends the reader to the wrong page while every count-based check still passes.`
              : 'Found no help link there at all.'
          }`,
        )
      }
    },
  )
})
