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
 * Every tracking id the site setup can turn ON can also be turned OFF
 * (AGL-1608).
 *
 * ## The bug this exists to stop coming back
 *
 * The form renderer drops an empty text input from its submitted values
 * rather than reporting it as `''`, and the write is
 * `setDoc(..., { merge: true })`. So clearing a field submitted a payload that
 * did not mention it, merge left the stored value untouched, and the page said
 * "Saved!". Every id on that card could be switched on and never off — the
 * only way out of a tracker was a database edit.
 *
 * These ids load third-party tags and set third-party cookies. A control that
 * can grant but not withdraw is the wrong shape for that, whatever the
 * regulation says.
 *
 * ## What this actually guards
 *
 * Not the merge semantics — a spec cannot easily reproduce a form library
 * dropping a key. What it guards is the LIST going stale: the realistic
 * regression is a sixth tracking field added to the card by somebody who has
 * no reason to know that omitting it from `CLEARABLE_TRACKING_PATHS` makes it
 * permanent. The failure would be silent in exactly the same way as the
 * original.
 */
const PAGE = join(
  __dirname,
  '..',
  'app',
  '(app)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'setup',
  // The schemas moved with the page when Setup's tabs became routed sections
  // (AGL-693): the layout is where the shared scope — and the form schemas it
  // hands the sections — now lives.
  '(sections)',
  'layout.tsx',
)

const source = () => readFileSync(PAGE, 'utf8')

/** The `name:` of every field the tracking schema renders. */
const trackingFieldNames = (): string[] => {
  const text = source()
  const start = text.indexOf('const trackingSchema')
  expect(start).toBeGreaterThan(-1)
  // The schema ends where the next top-level `const` begins.
  const end = text.indexOf('\nconst ', start + 1)
  const block = text.slice(start, end === -1 ? undefined : end)
  return [...block.matchAll(/name: '([^']+)'/g)].map((match) => match[1])
}

const clearablePaths = (): string[] => {
  const text = source()
  const start = text.indexOf('const CLEARABLE_TRACKING_PATHS')
  expect(start).toBeGreaterThan(-1)
  const block = text.slice(start, text.indexOf(']', start))
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('the tracking card can withdraw every id it can set', () => {
  it('THE CONTROL: the schema renders tracking fields at all', () => {
    // Otherwise the comparison below passes on an empty list the day the
    // schema is renamed or moved.
    const names = trackingFieldNames()
    expect(names.length).toBeGreaterThanOrEqual(5)
    expect(names).toEqual(
      expect.arrayContaining([
        'analytics.gaMeasurementId',
        'analytics.gtmContainerId',
      ]),
    )
  })

  it('every field on the card is clearable', () => {
    const missing = trackingFieldNames().filter(
      (name) => !clearablePaths().includes(name),
    )
    expect(missing).toEqual([])
  })

  it('the clearable list names no field the card does not render', () => {
    // A stale path is not harmful the way a missing one is, but it is a claim
    // about a control that no longer exists.
    const names = trackingFieldNames()
    const stale = clearablePaths().filter((path) => !names.includes(path))
    expect(stale).toEqual([])
  })

  it('the deletion is buried as a nested value, never a dotted key', () => {
    /*
     * `setDoc` with `merge` treats a dotted key as a LITERAL field name —
     * only `updateDoc` reads it as a path. Writing
     * `{'analytics.gtmContainerId': deleteField()}` would store nothing and
     * delete nothing while still reporting success, which is the original bug
     * wearing the shape of its own fix.
     */
    const text = source()
    expect(text).toContain('deleteField()')
    expect(text).toMatch(/const bury = /)
    expect(text).not.toMatch(/\[path\]: deleteField\(\)/)
  })

  it('only the form that owns the fields treats absence as cleared', () => {
    /*
     * `handleBasicSave` serves the details and SEO cards too, and neither
     * submits an analytics field. If they passed the clearable list, saving a
     * page title would wipe every tracking id on the site.
     */
    const text = source()
    const forms = text.slice(text.indexOf('const forms = ['))
    const withList = [...forms.matchAll(/CLEARABLE_TRACKING_PATHS/g)]
    expect(withList.length).toBe(1)
    expect(forms.slice(0, forms.indexOf(']'))).toContain('trackingSchema')
  })
})
