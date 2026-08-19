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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SX_ALIAS_PROPERTIES } from '@aglyn/shared-data-enums'

/**
 * One spelling in every besigner-document source (AGL-2210).
 *
 * MUI honours `bgcolor`/`p`/`px`/`py`/`m`/… as aliases of the CSS longhands,
 * so an alias in a preset RENDERS — and reaches no styles-panel field, since
 * every field is named for the longhand. The author sees the padding paint
 * and the Padding control read empty, and clearing the control deletes a key
 * that was never the one painting.
 *
 * The panel now expands aliases on read and write (AGL-2207) so LIVE
 * documents are editable, but nothing stopped the next preset from adding a
 * new one — and every occurrence this swept in was written AFTER AGL-1346
 * moved these records into `node.sx` specifically so the panel could reach
 * them. The alias half was simply invisible.
 *
 * Enumeration is from `git ls-files`, never a filesystem walk (AGL-2116): a
 * walk measures machine state — built output, another agent's scratch files
 * — rather than the repo.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..')

const tracked = (): string[] =>
  execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)

/** Files named outright because they author documents without presets. */
const NAMED_SOURCES = [
  'apps/console/constants/starter-templates.ts',
  'libs/tenant/runtime/src/lib/collection-fallback-nodes.ts',
]

/**
 * Every source that authors a besigner node `sx`: the plugin bundles'
 * element presets (what a drag from the elements drawer inserts), plus the
 * two named above (the starter sites a customer's first site is built from,
 * and the collection fallbacks the tenant renders when a site has no screen
 * document of its own).
 */
function documentSources(): Array<{ path: string; source: string }> {
  const files = tracked()
  const presetFiles = files.filter(
    (path) =>
      /^libs\/plugins\/[^/]+\/src\/.+\.tsx?$/.test(path) &&
      !path.includes('.spec.'),
  )
  const out: Array<{ path: string; source: string }> = []
  for (const path of [...presetFiles, ...NAMED_SOURCES]) {
    const source = readFileSync(join(REPO_ROOT, path), 'utf8')
    if (
      NAMED_SOURCES.includes(path) ||
      source.includes('NodeType.PRESET') ||
      source.includes('PresetSchema')
    ) {
      out.push({ path, source })
    }
  }
  return out
}

/** The body of every `sx: { … }` object literal in a source, with its line. */
function sxLiterals(source: string): Array<{ line: number; body: string }> {
  const out: Array<{ line: number; body: string }> = []
  const opener = /\bsx:\s*\{/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source))) {
    const start = match.index + match[0].length - 1
    let depth = 0
    let end = start
    for (let i = start; i < source.length; i += 1) {
      const char = source[i]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    out.push({
      line: source.slice(0, match.index).split('\n').length,
      body: source.slice(start, end + 1),
    })
  }
  return out
}

/**
 * Alias keys in one `sx` literal.
 *
 * Both spellings a key can take: `py: 4`, and the ES shorthand `{ py }`. A
 * shorthand must be preceded by the literal's `{` or a `,` — otherwise
 * `paddingTop: verticalPadding,` reads its own VALUE as a key.
 */
function aliasKeysIn(body: string): string[] {
  const found = new Set<string>()
  const keyed = /([A-Za-z]+)\s*:/g
  let match: RegExpExecArray | null
  while ((match = keyed.exec(body))) {
    if (SX_ALIAS_PROPERTIES.includes(match[1])) found.add(match[1])
  }
  const shorthand = /[{,]\s*([A-Za-z]+)\s*(?=[,}])/g
  while ((match = shorthand.exec(body))) {
    if (SX_ALIAS_PROPERTIES.includes(match[1])) found.add(match[1])
  }
  return [...found]
}

describe('besigner document sources speak one spelling (AGL-2210)', () => {
  const sources = documentSources()

  it('enumerated the sources it claims to guard', () => {
    // A guard that matched nothing would pass forever. Assert the sweep saw
    // the files the fix actually touched, and enough of them to be real.
    const paths = sources.map((entry) => entry.path)
    expect(paths).toContain('apps/console/constants/starter-templates.ts')
    expect(paths).toContain(
      'libs/tenant/runtime/src/lib/collection-fallback-nodes.ts',
    )
    expect(paths).toContain('libs/plugins/mui/src/lib/components/blocks.tsx')
    expect(paths).toContain('libs/plugins/mui/src/lib/components/box.tsx')
    expect(paths).toContain('libs/plugins/mui/src/lib/components/nav-menu.tsx')
    expect(paths.length).toBeGreaterThan(10)
  })

  it('reads an sx literal it can actually find alias keys in', () => {
    // The scanner itself, proved against a known-bad fixture — otherwise a
    // regex that matches nothing reports a clean repo.
    expect(aliasKeysIn("{ py: 4, px: 2, bgcolor: 'primary.main' }").sort()).toEqual([
      'bgcolor',
      'px',
      'py',
    ])
    expect(aliasKeysIn('{ py }')).toEqual(['py'])
    // …and does NOT read a value as a key.
    expect(aliasKeysIn('{ paddingTop: py, paddingBottom: py }')).toEqual([])
    expect(aliasKeysIn('{ paddingTop: 4, backgroundColor: "#fff" }')).toEqual(
      [],
    )
  })

  it('names no MUI system-prop alias in any node sx', () => {
    const violations: string[] = []
    for (const { path, source } of sources) {
      for (const { line, body } of sxLiterals(source)) {
        for (const alias of aliasKeysIn(body)) {
          violations.push(`${path}:${line} — ${alias}`)
        }
      }
    }
    // The message has to say what to do: the panel's fields are named for
    // the CSS longhands, so `py: 4` must be spelled
    // `paddingTop: 4, paddingBottom: 4` and `bgcolor` `backgroundColor`.
    expect(violations).toEqual([])
  })
})
