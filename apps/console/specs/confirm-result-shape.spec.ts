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
 * AGL-3509 · NOBODY READS `confirm`'S RESOLVED VALUE AS AN ANSWER.
 *
 * The console's `confirm` (`ConfirmationProviderComponent`) resolves with NO
 * value on OK and REJECTS on Cancel. A caller that writes
 *
 *     const ok = await confirm({ … })
 *     if (!ok) return
 *
 * therefore returns on OK — the dialog asks, the member agrees, and nothing
 * happens — and throws an unhandled rejection on Cancel. Three surfaces did
 * exactly that (an entry's discard-and-leave, deleting an author, deleting a
 * task), and their specs passed because they mocked `confirm` resolving
 * `true`/`false`, which is not the contract.
 *
 * So wherever the outcome is USED — bound, negated, or tested — the call must
 * turn it into one with `.then(() => true).catch(() => false)` (or its own
 * `.then`/`.catch`). A bare `await confirm(…)` statement inside a `try` is a
 * different, legal shape: the rejection IS the answer there.
 */

import { readCode, trackedSources } from './document-writes'

/** Index just past the `)` closing the call opened at `open`, string-aware. */
function closeOf(source: string, open: number): number {
  let depth = 0
  let at = open
  let quote: string | null = null
  while (at < source.length) {
    const char = source[at]
    if (quote) {
      if (char === '\\') at += 1
      else if (char === quote) quote = null
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0) return at + 1
    }
    at += 1
  }
  return source.length
}

/** Every `await confirm(…)` whose outcome is read without `.then`/`.catch`. */
function misreadConfirms(code: string): number[] {
  const found: number[] = []
  const call = /await\s+confirm\s*\(/g
  let match: RegExpExecArray | null
  while ((match = call.exec(code))) {
    const before = code.slice(0, match.index).trimEnd()
    // A statement on its own (`{`, `;`, `)` of a prior line, or start): the
    // rejection is how Cancel arrives, and a surrounding `try` handles it.
    const valueUsed = /(?:=|\(|!|&&|\|\||\?|:|return)$/.test(before)
    if (!valueUsed) continue
    const tail = code.slice(closeOf(code, match.index + match[0].length - 1)).trimStart()
    if (tail.startsWith('.then') || tail.startsWith('.catch')) continue
    found.push(code.slice(0, match.index).split('\n').length)
  }
  return found
}

describe('AGL-3509 · a confirm whose answer is used turns it into one', () => {
  const callers = trackedSources().filter(
    (file) => /\.tsx?$/.test(file) && readCode(file).includes('useConfirmationContext'),
  )

  it('finds the callers it is meant to hold, so a silent pass means something', () => {
    for (const file of [
      'apps/console/components/content/entry-detail-page.component.tsx',
      'apps/console/components/content/collection-entries-page.component.tsx',
      'libs/plugins/crm/src/lib/components/task-edit-drawer.tsx',
    ]) {
      expect([file, callers.includes(file)]).toEqual([file, true])
    }
  })

  it('finds no `await confirm(…)` read as a boolean', () => {
    const offenders: string[] = []
    for (const file of callers) {
      for (const line of misreadConfirms(readCode(file))) offenders.push(`${file}:${line}`)
    }
    expect(offenders).toEqual([])
  })

  it('refuses the shapes the three callers had, and passes the fixed and statement ones', () => {
    const refused = [
      "const ok = await confirm({ title: 'Leave?' })\nif (!ok) return",
      "if (!(await confirm({ title: 'Delete (1)?' }))) return",
      "const confirmed = await confirm({ title: 'x', description: `a ) b` })",
    ]
    for (const code of refused) expect([code, misreadConfirms(code).length]).toEqual([code, 1])

    const passed = [
      "const ok = await confirm({ title: 'Leave?' })\n  .then(() => true)\n  .catch(() => false)",
      "const ok = await confirm({ title: 'Delete (1)?' }).catch(() => false)",
      "try {\n  await confirm({ title: 'Delete?' })\n} catch {\n  return\n}",
    ]
    for (const code of passed) expect([code, misreadConfirms(code).length]).toEqual([code, 0])
  })
})
