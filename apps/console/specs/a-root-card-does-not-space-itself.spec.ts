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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * A card that is a component's ROOT does not space itself (AGL-693).
 *
 * ## The bug this exists to stop coming back
 *
 * Settings was one page holding eight panels, and four of its cards carried
 * `sx={{ mt: 3 }}` to separate themselves from whatever the page rendered
 * above them. When the panels became routes, each of those cards became the
 * first and only thing in its section — and the margin became a band of empty
 * space between the section rail's top edge and the card beside it, on four of
 * eight sections. Reported as "weird spacing above some of the cards", which
 * is exactly how it reads: a gap with nothing in it.
 *
 * The rule is about OWNERSHIP, not about the number. Whoever renders a
 * component decides what sits above it — a grid with `spacing`, a `Stack`, a
 * routed section — and a root that also has an opinion is a second answer to
 * a question that already had one. The two only agree by luck, and they stop
 * agreeing the moment the component is reused somewhere else.
 *
 * ## What is NOT flagged, deliberately
 *
 * A card that is not the root: the profile section's second card separates
 * itself from the first one above it, which is a sibling relationship it can
 * see and is entitled to have an opinion about.
 *
 * Nested elements inside a component — a divider, a helper line, a dialog's
 * own offset. `MediaFieldSection` is the sharp case: in its embedded mode it
 * pairs `mt: 3` with a `<Divider />` to break up a form that has no other
 * separators. That margin is content, not layout, and it is not a root.
 */
const ROOT_CARD = /\n {2}return \(\n\s*<CardDisplay\b((?:[^<>]|\{[^{}]*\})*?)>/gs
const TOP_MARGIN = /\b(mt|marginTop|my|marginY)\s*:\s*([0-9.]+)/

/**
 * Cards that own their top margin for a stated reason. Empty on purpose —
 * an entry here is a claim that a component knows better than every parent
 * that will ever render it, which has not been true yet.
 */
const ALLOWED: Readonly<Record<string, string>> = {}

const sources = (): Array<[string, string]> =>
  execFileSync('git', ['ls-files', '--', 'apps/console', 'libs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter((path) => path.endsWith('.tsx') && !path.includes('.spec.'))
    .map((path) => [path, readFileSync(join(REPO_ROOT, path), 'utf8')])

describe('a root CardDisplay leaves its own spacing to its parent', () => {
  const offenders = () => {
    const found: string[] = []
    for (const [path, source] of sources()) {
      for (const match of source.matchAll(ROOT_CARD)) {
        const margin = TOP_MARGIN.exec(match[1])
        if (!margin || margin[2] === '0') continue
        if (ALLOWED[path]) continue
        const line = source.slice(0, match.index).split('\n').length + 1
        found.push(`${path}:${line} sets ${margin[1]}: ${margin[2]}`)
      }
    }
    return found
  }

  it('THE CONTROL: there are root CardDisplays to check', () => {
    // Otherwise the assertion below passes because the pattern matches
    // nothing — the shape of this file changing out from under it.
    const roots = sources().filter(([, source]) =>
      new RegExp(ROOT_CARD.source, 's').test(source),
    )
    expect(roots.length).toBeGreaterThan(10)
  })

  it('finds none', () => {
    expect(offenders()).toEqual([])
  })

  it('the allowlist names files that EXIST and still set one', () => {
    // A stale exemption silently widens the rule.
    for (const path of Object.keys(ALLOWED)) {
      const source = readFileSync(join(REPO_ROOT, path), 'utf8')
      const match = new RegExp(ROOT_CARD.source, 's').exec(source)
      expect(match && TOP_MARGIN.test(match[1])).toBe(true)
    }
  })
})
