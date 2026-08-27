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
 * Deleting something that is referenced elsewhere breaks those references, so
 * the confirmation has to name them — and it may not claim there are none
 * unless it actually looked.
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

const dependent = (
  name: string,
  relation?: ArtifactDependent['relation'],
): ArtifactDependent => ({
  type: 'screen',
  id: `id-${name}`,
  name,
  ...(relation ? { relation } : {}),
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
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => dependent(n))
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

  /**
   * SCREENS (AGL-703) — the kind where "nothing goes down" is sometimes a lie.
   *
   * A screen is referenced three unrelated ways and only one of them takes a
   * live route off the site: a collection renders its list and entry pages
   * THROUGH a screen, so deleting that screen is not a degraded link, it is a
   * missing page. The other two — a dead nav link, a re-parented child — leave
   * everything serving.
   *
   * So the screen sentence is built from the dependents rather than picked
   * per kind, and these pin the seam. Averaging the three into one reassuring
   * sentence is the failure mode; so is leading with the worst case on the far
   * more common path.
   */
  it('promises nothing goes down when only links and children point at it', () => {
    const note = deleteConfirmationNote(
      {
        dependents: [dependent('Home', 'link'), dependent('About', 'child')],
        complete: true,
      },
      'screen',
    )
    expect(note).toMatch(/nothing goes down/i)
    expect(note).toMatch(/links stop working/i)
    expect(note).toMatch(/keeps its own published path/i)
    expect(note).not.toMatch(/does break/i)
  })

  it('REFUSES that promise when a collection renders through it', () => {
    const note = deleteConfirmationNote(
      {
        dependents: [
          dependent('Home', 'link'),
          { type: 'collection', id: 'blog', name: 'Blog', relation: 'template' },
        ],
        complete: true,
      },
      'screen',
    )
    // The one dependent that costs a page must not be softened by the two
    // that do not.
    expect(note).not.toMatch(/nothing goes down/i)
    expect(note).toMatch(/does break/i)
    expect(note).toMatch(/Blog/)
    expect(note).toMatch(/stop resolving/i)
    // And the reassuring half is still there — it is still true of the links.
    expect(note).toMatch(/links stop working/i)
  })

  it('states every screen consequence when the scan could not run', () => {
    // No list to reason from: the worst case has to be on the page, or a
    // reader infers safety from a scan that never happened.
    const note = deleteConfirmationNote(null, 'screen')
    expect(note).toMatch(/could not check/i)
    expect(note).toMatch(/loses them until another screen is picked/i)
    expect(note).not.toMatch(/nothing goes down/i)
  })

  it('names Screens, not a card, in the screen lead', () => {
    expect(deleteConfirmationLead('screen', 'Pricing')).toContain('"Pricing"')
    expect(deleteConfirmationLead('screen', 'Pricing')).toMatch(
      /published path stops resolving/i,
    )
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
