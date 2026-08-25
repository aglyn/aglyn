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
 * A delete confirmation may not promise safety it did not verify (AGL-703).
 *
 * Zach: *"When we delete anything we need to make sure we show the user where
 * it is referenced (used by) … meaning things are going to break. Make sure
 * the break friendly too."*
 *
 * The media library learned the general lesson first (AGL-1413): a panel that
 * reads `references.length === 0` and prints "not used anywhere" throws the
 * information away at the last step. Artifacts had the same hole with a worse
 * root cause — `/api/hosts/where-used` reads ONE DOCUMENT past its 200-row cap
 * specifically so it can report whether there were more, and the route
 * discarded that flag before answering. Every caller was therefore reasoning
 * from a number that could not distinguish "none" from "stopped looking".
 *
 * The invariant these pin is one sentence: **the unqualified claim is
 * reachable only from a complete scan.** Everything else is phrasing.
 */
import {
  consequenceNote,
  deleteConfirmationLead,
  deleteConfirmationNote,
  scanIsComplete,
  USAGE_NAME_LIMIT,
  type ArtifactDependent,
} from '../components/artifacts/artifact-usage-copy'

const dependent = (name: string): ArtifactDependent => ({
  type: 'screen',
  id: `id-${name}`,
  name,
})

describe('artifact delete copy respects what the scan actually read', () => {
  it('claims "nothing else references it" ONLY from a complete scan', () => {
    expect(
      deleteConfirmationNote({ dependents: [], complete: true }, 'component'),
    ).toMatch(/nothing else references it/i)
  })

  it('REFUSES that claim when the scan was truncated', () => {
    // The case the endpoint could not previously express at all. Everything
    // about it looks like a clean bill except that it is not one.
    const note = deleteConfirmationNote(
      { dependents: [], complete: false },
      'component',
    )
    expect(note).not.toMatch(/nothing else references it/i)
    expect(note).toMatch(/more content than the check reads/i)
  })

  it('REFUSES that claim when the scan failed outright', () => {
    const note = deleteConfirmationNote(null, 'layout')
    expect(note).not.toMatch(/nothing else references it/i)
    expect(note).toMatch(/could not check/i)
  })

  it('treats an ABSENT completeness flag as incomplete', () => {
    // An older deployment, a changed response shape, a proxy that dropped the
    // field. Every one of those has to degrade to "we could not determine
    // this" — the alternative is a delete confirmation promising safety on
    // the strength of a field that was not there.
    expect(scanIsComplete(undefined)).toBe(false)
    expect(scanIsComplete(null)).toBe(false)
    expect(scanIsComplete('true')).toBe(false)
    expect(scanIsComplete(1)).toBe(false)
    expect(scanIsComplete(true)).toBe(true)
  })

  it('names the dependents it found, and counts the rest', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(dependent)
    const note = deleteConfirmationNote(
      { dependents: many, complete: true },
      'component',
    )
    expect(note).toMatch(/used by 7 things/i)
    for (const name of many.slice(0, USAGE_NAME_LIMIT)) {
      expect(note).toContain(name.name)
    }
    // The cap never hides how much there is: the total leads the sentence and
    // the remainder is counted rather than dropped.
    expect(note).toMatch(/and 2 more/)
  })

  it('says "at least" when a truncated scan still found something', () => {
    // Everything listed is real even when the list is a lower bound, so the
    // names are still worth showing — the COUNT is the part that has to be
    // hedged.
    const note = deleteConfirmationNote(
      { dependents: [dependent('Home')], complete: false },
      'layout',
    )
    expect(note).toMatch(/used by at least 1 thing/i)
    expect(note).toContain('Home')
  })

  it('singularises one dependent', () => {
    const note = deleteConfirmationNote(
      { dependents: [dependent('Home')], complete: true },
      'layout',
    )
    expect(note).toMatch(/1 thing:/)
    expect(note).not.toMatch(/1 things/)
  })

  /**
   * The FRIENDLY BREAK half.
   *
   * Both sentences describe behaviour the runtime actually has, and both are
   * asserted here so that a change to either is a change to a test rather than
   * a lie told at the moment somebody decides whether to proceed:
   *
   * - `composeReusableComponentNodes`: *"Unresolvable refIds leave the
   *   instance untouched — a deleted definition must never take a published
   *   screen down."*
   * - a screen whose `layoutId` no longer resolves renders without the shared
   *   chrome rather than failing.
   */
  it('tells the author what SURVIVES, not just what breaks', () => {
    for (const kind of ['component', 'layout'] as const) {
      expect(consequenceNote(kind)).toMatch(/nothing goes down/i)
    }
    expect(consequenceNote('component')).toMatch(/empty space/i)
    expect(consequenceNote('layout')).toMatch(/without the shared chrome/i)
  })

  it('carries the consequence on every answer that is not a clean bill', () => {
    // A clean bill needs no consequence — nothing references it, so nothing
    // changes. Every other outcome must say what happens next, because that is
    // the half the author cannot look up.
    const outcomes = [
      deleteConfirmationNote(null, 'component'),
      deleteConfirmationNote({ dependents: [], complete: false }, 'component'),
      deleteConfirmationNote(
        { dependents: [dependent('Home')], complete: true },
        'component',
      ),
    ]
    for (const note of outcomes) {
      expect(note).toMatch(/nothing goes down/i)
    }
    expect(
      deleteConfirmationNote({ dependents: [], complete: true }, 'component'),
    ).not.toMatch(/nothing goes down/i)
  })

  it('names the artifact in the lead so the dialog is about one thing', () => {
    expect(deleteConfirmationLead('component', 'Site nav')).toContain(
      '"Site nav"',
    )
    expect(deleteConfirmationLead('layout', 'Marketing base')).toMatch(
      /Layouts/,
    )
  })
})
