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
 * Every icon-only console button has a name (AGL-2128).
 *
 * The console has a guard for the docs-topic registry (`docs-links.spec.ts`),
 * a guard for plugin help topics (`plugin-help-topics.spec.ts`), and a guard
 * for page/card `help=` (`help-coverage.spec.ts`) — and, until now, nothing at
 * all for the affordance a user actually hovers or a screen reader actually
 * announces. An `<IconButton>` with no name is announced as "button" and
 * nothing else, which in a list of them (a folder rail, a row of ⋮ menus) is
 * indistinguishable from every sibling.
 *
 * A name can arrive four legitimate ways, and the guard accepts all four
 * rather than mandating one — they are genuinely different tools:
 *
 *  1. a wrapping `<Tooltip title=…>` (MUI forwards it as `aria-label`),
 *  2. `title=` on the button itself,
 *  3. `aria-label` / `aria-labelledby`,
 *  4. visually-hidden text inside — `<SrOnly>close drawer</SrOnly>`, which is
 *     what the drawer close buttons use and is a perfectly good name.
 *
 * That fourth case is the reason this is a source scan and not a lint rule:
 * `jsx-a11y` sees an empty-looking button and an SrOnly child it cannot
 * evaluate. It is also the case a naive version of this guard gets WRONG in
 * the expensive direction — an earlier count of this same population reported
 * five nameless buttons because it only looked for `aria-label`, and three of
 * the five were already named by SrOnly text. A guard that over-reports sends
 * someone to "fix" code that was correct.
 *
 * Deliberately NOT asserted: that every button has a hover tooltip. A tooltip
 * is documentation and belongs where the icon is ambiguous; on an obvious
 * close X it is noise. The invariant here is the accessible NAME, which is
 * never optional.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const CONSOLE_ROOT = join(__dirname, '..')

/**
 * Files where an `IconButton` is rendered by a generic pass-through whose
 * props come from a caller this file cannot see. Each needs a reason, and
 * each is re-checked below so a stale one cannot linger.
 */
const EXCEPTIONS: Record<string, string> = {
  // Currently EMPTY, and that is the finding rather than an oversight. The one
  // candidate — `components/layouts/main.layout.tsx`, a generic renderer whose
  // props arrive through `...rest` from a caller this file cannot see — turned
  // out not to need exempting: it derives a fallback `aria-label` from the
  // item's own label/id, so an unnamed quick action cannot ship anonymous. The
  // reaper below said so, by refusing the entry once the fallback landed.
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.tsx') && !entry.endsWith('.spec.tsx')) out.push(full)
  }
  return out
}

interface Occurrence {
  file: string
  line: number
  named: boolean
}

/** The `<IconButton …>` opening tag and the full element, from its start. */
function readElement(source: string, start: number): [string, string] {
  let cursor = start
  while (cursor < source.length && source[cursor] !== '>') cursor += 1
  const openingTag = source.slice(start, cursor + 1)
  if (source[cursor - 1] === '/') return [openingTag, openingTag]
  const close = source.indexOf('</IconButton>', cursor)
  return [
    openingTag,
    source.slice(start, close > 0 ? close + '</IconButton>'.length : cursor + 1),
  ]
}

function collect(): Occurrence[] {
  const found: Occurrence[] = []
  for (const file of [
    ...walk(join(CONSOLE_ROOT, 'app')),
    ...walk(join(CONSOLE_ROOT, 'components')),
  ]) {
    const source = readFileSync(file, 'utf8')
    let index = source.indexOf('<IconButton')
    while (index >= 0) {
      const [openingTag, element] = readElement(source, index)
      const before = source.slice(Math.max(0, index - 600), index)
      // A `<Tooltip>` still open at this point wraps the button. MUI's
      // Tooltip forwards `title` to its child as `aria-label`, so this is a
      // real name, not just a hover affordance.
      const insideTooltip =
        before.lastIndexOf('<Tooltip') > before.lastIndexOf('</Tooltip>')
      const named =
        insideTooltip ||
        /\stitle=/.test(openingTag) ||
        openingTag.includes('aria-label') ||
        element.includes('<SrOnly')
      found.push({
        file: relative(CONSOLE_ROOT, file),
        line: source.slice(0, index).split('\n').length,
        named,
      })
      index = source.indexOf('<IconButton', index + 1)
    }
  }
  return found
}

const occurrences = collect()

describe('icon-only buttons carry an accessible name (AGL-2128)', () => {
  // Anti-vacuity. Every assertion below is over a population found by string
  // search, so a rename of the component, a move of the directories, or a
  // broken walker turns this into a guard over nothing — and "no unnamed
  // buttons" is trivially true of an empty list. If this fails, the collector
  // has rotted; fix the collector, never this number.
  it('found a real population of IconButtons', () => {
    expect(occurrences.length).toBeGreaterThan(20)
    expect(new Set(occurrences.map((o) => o.file)).size).toBeGreaterThan(10)
  })

  it('names every one of them', () => {
    const unnamed = occurrences.filter(
      (occurrence) => !occurrence.named && !EXCEPTIONS[occurrence.file],
    )
    if (unnamed.length > 0) {
      throw new Error(
        `These <IconButton>s have no accessible name — a screen reader announces them as "button" and nothing else:\n` +
          unnamed.map((o) => `  ${o.file}:${o.line}`).join('\n') +
          `\nGive each one a wrapping <Tooltip title=…>, a title=, an aria-label, or visually-hidden <SrOnly> text. If it is a generic pass-through whose props come from a caller, add it to EXCEPTIONS in this file with a reason.`,
      )
    }
  })

  it('keeps every exception real and still necessary', () => {
    // The stale-exemption reaper. An exception whose file has gone, or whose
    // buttons are now all named, is an exception that quietly widens the hole
    // for whatever gets added to that file next.
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length).toBeGreaterThan(20)
      const inFile = occurrences.filter((occurrence) => occurrence.file === file)
      if (inFile.length === 0) {
        throw new Error(
          `EXCEPTIONS names ${file}, which has no <IconButton> any more. Delete the entry.`,
        )
      }
      if (inFile.every((occurrence) => occurrence.named)) {
        throw new Error(
          `EXCEPTIONS names ${file}, but every <IconButton> in it is now named. Delete the entry so the file is guarded again.`,
        )
      }
    }
  })

  it('has retired the tooltip component that never opened', () => {
    // `osfa-tooltip.tsx` was a tippy.js global tooltip whose whole body was
    // commented out — `setAnchorEl` was never called, so the Popper never
    // opened — mounted in the root provider, re-running a
    // `querySelectorAll('[data-aglyn-tooltip]')` on every render (no
    // dependency array) against zero matching elements. Nothing in apps/ or
    // libs/ ever carried that attribute. Asserted so it cannot come back
    // under cover of "there's already a global tooltip".
    const providers = readFileSync(join(CONSOLE_ROOT, 'app/providers.tsx'), 'utf8')
    expect(providers).not.toContain('OsfaTooltip')
    const markers = [
      ...walk(join(CONSOLE_ROOT, 'app')),
      ...walk(join(CONSOLE_ROOT, 'components')),
    ].filter((file) => readFileSync(file, 'utf8').includes('data-aglyn-tooltip'))
    expect(markers).toEqual([])
  })
})
