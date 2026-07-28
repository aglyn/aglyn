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

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DOCS_HELP_TOPICS } from '../constants/docs-links'

/**
 * Every first-party plugin surface points its help `?` at its own docs page
 * (AGL-1074).
 *
 * `help-coverage.spec.ts` asserts a DashboardLayout page mentions `help=`
 * somewhere, and the generic plugin route does — which is how twelve surfaces
 * came to share one Plugins & Marketplace tooltip and still pass. Presence is
 * not correctness when one file stands in for twelve pages, so this guard
 * checks the other end: the nav item that owns the surface.
 *
 * Source scan rather than an import, deliberately — importing every plugin
 * bundle drags the whole console UI into a spec that only wants to read a
 * declaration, and the registrations are static object literals.
 */

const REPO_ROOT = join(__dirname, '../../..')
const PLUGINS_ROOT = join(REPO_ROOT, 'libs/plugins')

/**
 * Surfaces with no docs page yet, so they knowingly keep the Plugins &
 * Marketplace fallback. Keyed `<plugin dir>:<header title>`, and the value is
 * the reason — an entry here is a claim that the docs do not cover it, not
 * that the topic was hard to pick.
 */
const NO_TOPIC_YET: Record<string, string> = {
  'events-calendar:Events':
    'No events-calendar page exists under apps/docs/docs — tracked in AGL-1075.',
}

/** The balanced `{...}` starting at `from`, braces included. */
function braceBlock(source: string, from: number): string {
  let depth = 0
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from, index + 1)
    }
  }
  return source.slice(from)
}

interface Surface {
  plugin: string
  file: string
  title: string
  docsTopic?: string
}

function readSurfaces(): Surface[] {
  const surfaces: Surface[] = []
  for (const entry of readdirSync(PLUGINS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(PLUGINS_ROOT, entry.name, 'src/lib/plugin.ts')
    if (!existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
    const marker = /header:\s*\{/g
    let match: RegExpExecArray | null
    while ((match = marker.exec(source)) !== null) {
      const block = braceBlock(source, match.index + match[0].length - 1)
      surfaces.push({
        plugin: entry.name,
        file: relative(REPO_ROOT, file),
        title: /title:\s*'([^']*)'/.exec(block)?.[1] ?? '(untitled)',
        docsTopic: /docsTopic:\s*'([^']*)'/.exec(block)?.[1],
      })
    }
  }
  return surfaces
}

describe('first-party plugin help topics (AGL-1074)', () => {
  const surfaces = readSurfaces()

  it('finds the plugin nav headers to check', () => {
    // Without this the two checks below pass vacuously the day the scan
    // stops matching — a renamed field or a moved plugin.ts.
    expect(surfaces.length).toBeGreaterThanOrEqual(10)
  })

  it('every plugin surface declares a docs topic', () => {
    const missing = surfaces
      .filter((surface) => !surface.docsTopic)
      .filter((surface) => !(`${surface.plugin}:${surface.title}` in NO_TOPIC_YET))
      .map((surface) => `${surface.file} — ${surface.title}`)
    if (missing.length) {
      throw new Error(
        'These plugin surfaces inherit the Plugins & Marketplace help tooltip. ' +
          "Add `docsTopic: '<key>'` to the nav item's header (keys: " +
          'apps/console/constants/docs-help.generated.ts), or add it to ' +
          `NO_TOPIC_YET with a reason:\n  ${missing.join('\n  ')}`,
      )
    }
  })

  it('every declared topic exists in the docs registry', () => {
    const unknown = surfaces
      .filter((surface) => surface.docsTopic && !(surface.docsTopic in DOCS_HELP_TOPICS))
      .map((surface) => `${surface.file} — ${surface.title} → ${surface.docsTopic}`)
    // The console falls back rather than throwing on an unknown topic, so a
    // typo here is silent at runtime: it renders the marketplace tooltip,
    // the exact bug this issue fixed.
    expect(unknown).toEqual([])
  })
})
