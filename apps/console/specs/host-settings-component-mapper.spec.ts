/**
 * @license
 * Copyright 2022 Aglyn LLC
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
 * Every field type a Setup / Admin settings card names is in the mapper that
 * card renders with.
 *
 * The renderer does not skip a field whose type the mapper lacks; it refuses
 * the whole card with "invalid form schema". Hours on the Local business card
 * became a `weekly-hours` picker while the hub still rendered through
 * `simpleComponentMapper`, and Setup → SEO lost the card on every site —
 * business type, hours and areas served with it. Nothing failed until a
 * person opened the page, because the specs that render this hub mock the
 * forms library, mapper included.
 *
 * So this walks the REAL schemas against the REAL mapper, nested sub-form
 * fields included.
 */

import {
  FieldComponentType,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import {
  HOST_SETTINGS_SCHEMAS,
  hostSettingsComponentMapper,
} from '../app/(app)/[orgSlug]/hosts/[host]/host-settings-scope'

type Field = { name?: string; component?: unknown; fields?: readonly Field[] }

const fieldTypes = (fields: readonly Field[]): Array<[string, string]> =>
  fields.flatMap((field) => [
    ...(typeof field.component === 'string'
      ? [[field.name ?? '(unnamed)', field.component] as [string, string]]
      : []),
    ...(field.fields ? fieldTypes(field.fields) : []),
  ])

const usedTypes = HOST_SETTINGS_SCHEMAS.flatMap((schema) =>
  fieldTypes(schema.fields as readonly Field[]).map(
    ([name, type]) => [String(schema.id), name, type] as const,
  ),
)

describe('host settings component mapper', () => {
  it('walks every card and finds their fields', () => {
    expect(HOST_SETTINGS_SCHEMAS.length).toBeGreaterThan(0)
    expect(usedTypes.length).toBeGreaterThan(HOST_SETTINGS_SCHEMAS.length)
  })

  it('maps every field type a card names', () => {
    const missing = usedTypes
      .filter(([, , type]) => !(type in hostSettingsComponentMapper))
      .map(([schema, name, type]) => `${schema} › ${name}: ${type}`)
    expect(missing).toEqual([])
  })

  it('catches the Hours picker the simple mapper cannot draw', () => {
    // The premise the check above rests on: the Local business card names a
    // type outside the simple set, so the plain mapper would fail it.
    expect(usedTypes).toContainEqual([
      'hostSeoLocalBusiness',
      'seo.entity.openingHours',
      FieldComponentType.WEEKLY_HOURS,
    ])
    expect(FieldComponentType.WEEKLY_HOURS in simpleComponentMapper).toBe(
      false,
    )
  })
})
