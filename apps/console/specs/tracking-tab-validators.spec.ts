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
 * The Tracking tab rejects a malformed id AT THE FIELD (AGL-2486).
 *
 * Both ids land inside an inline script on a published page, so the tenant
 * refuses anything that is not the exact shape (`GA_MEASUREMENT_ID_PATTERN`,
 * `GTM_CONTAINER_ID_PATTERN`) — and without a message at the field, that
 * refusal reads as "I saved it and nothing happened": the console accepts the
 * value, stores it, reports success, and the tag never appears.
 *
 * That the form stack DISPLAYS a schema validator is settled one library over,
 * in `jsx-forms/mapper/pattern-validation.spec.tsx`, against the real field
 * component. What this pins is the half that lives here: that the two fields
 * still declare one, and that they declare it from the SHARED constants rather
 * than re-spelling the id shape. A second spelling is how the console and the
 * tenant come to disagree about what a valid id looks like — and the console
 * is the half nobody tests against a real Google account.
 *
 * Read from source because the schema is module-scope in a Next page: it is
 * not exported, and exporting it to satisfy a test would put an unused public
 * name on a route module.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GA_MEASUREMENT_ID_PATTERN, GTM_CONTAINER_ID_PATTERN } from '@aglyn/aglyn'

const SOURCE = readFileSync(
  join(
    __dirname,
    '..',
    'app',
    '(app)',
    '[orgSlug]',
    'hosts',
    '[host]',
    // The scope both settings hubs mount, which is where the form schemas
    // live. The Setup and Admin sections layouts each provide it; neither
    // declares a schema of its own.
    'host-settings-scope.tsx',
  ),
  'utf8',
)

/** The `validate` block belonging to one field, by field name. */
const validatorsFor = (name: string): string => {
  const at = SOURCE.indexOf(`name: '${name}'`)
  expect(at).toBeGreaterThan(-1)
  // Up to the next field in the array — a validator declared after that one
  // belongs to the next field, not this one.
  const next = SOURCE.indexOf('component: FieldComponentType', at)
  return SOURCE.slice(at, next === -1 ? undefined : next)
}

describe('the Tracking tab validates both ids (AGL-2486)', () => {
  it('declares a PATTERN validator on the GA measurement id', () => {
    const block = validatorsFor('analytics.gaMeasurementId')
    expect(block).toContain('FieldValidatorType.PATTERN')
    expect(block).toContain('GA_MEASUREMENT_ID_PATTERN')
  })

  it('declares a PATTERN validator on the GTM container id', () => {
    const block = validatorsFor('analytics.gtmContainerId')
    expect(block).toContain('FieldValidatorType.PATTERN')
    expect(block).toContain('GTM_CONTAINER_ID_PATTERN')
  })

  it('passes the expression as `.source`, not the RegExp object', () => {
    // The validator takes the expression as a STRING and validates nothing at
    // all when handed the object — a validator that silently never fires is
    // worse than none, because the field looks guarded.
    expect(SOURCE).toContain('GA_MEASUREMENT_ID_PATTERN.source')
    expect(SOURCE).toContain('GTM_CONTAINER_ID_PATTERN.source')
  })

  it('re-spells NEITHER id shape', () => {
    // The whole point of the shared constants. A literal `^G-` or `^GTM-` in
    // this page is a second definition of "valid", and the tenant would keep
    // the first one.
    expect(SOURCE).not.toMatch(/'\^G-/)
    expect(SOURCE).not.toMatch(/'\^GTM-/)
  })

  it('THE CONTROL: the patterns agree with the ids the tenant accepts', () => {
    // Guards the guard: if these constants ever stopped describing real ids,
    // every assertion above would still pass while the field rejected
    // everything a customer could type.
    expect(GA_MEASUREMENT_ID_PATTERN.test('G-YW5PG16YTM')).toBe(true)
    expect(GTM_CONTAINER_ID_PATTERN.test('GTM-ABCDE12')).toBe(true)
    expect(GTM_CONTAINER_ID_PATTERN.test('not-a-container')).toBe(false)
  })
})
