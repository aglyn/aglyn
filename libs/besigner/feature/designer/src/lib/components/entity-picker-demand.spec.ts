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
 * Which entity lists the attributes panel asks the provider to load
 * (AGL-703).
 *
 * `EntityPickerProvider` used to read four Firestore collections the moment
 * the besigner mounted — up to 900 documents on a site with a catalog — for
 * pickers most editing sessions never open. It is demand-driven now, and this
 * is the demand: the selected node's own schema.
 *
 * Which makes this switch the load-bearing part. A picker missing from it
 * renders as a permanently EMPTY dropdown — indistinguishable, to the person
 * looking at it, from a site that genuinely has no products. So the mapping
 * is derived from `FieldComponentType` here rather than hand-listed, and the
 * last case fails if a new picker type is added without a home.
 */
import * as Aglyn from '@aglyn/aglyn'
import { entityKindsForAttributes } from './element-props-form.component'

const field = (component: Aglyn.FieldComponentType) =>
  ({ name: 'x', component }) as Aglyn.AglynAttributeSchema

describe('entity picker demand (AGL-703)', () => {
  it('asks for nothing when the node has no picker', () => {
    expect(entityKindsForAttributes(undefined)).toEqual([])
    expect(
      entityKindsForAttributes([field(Aglyn.FieldComponentType.TEXT)]),
    ).toEqual([])
  })

  it('maps each picker to the list it displays', () => {
    const cases: Array<[Aglyn.FieldComponentType, string]> = [
      [Aglyn.FieldComponentType.PRODUCT_SELECT, 'products'],
      [Aglyn.FieldComponentType.COLLECTION_SELECT, 'collections'],
      [Aglyn.FieldComponentType.CATEGORY_SELECT, 'categories'],
      [Aglyn.FieldComponentType.DATASET_SELECT, 'datasets'],
    ]
    for (const [component, kind] of cases) {
      expect(entityKindsForAttributes([field(component)])).toEqual([kind])
    }
  })

  it('routes DATASET_FIELD_SELECT to the dataset list', () => {
    // Its options are the model fields of the dataset an ANCESTOR chose, so
    // it cannot resolve one without the dataset list to resolve against.
    expect(
      entityKindsForAttributes([
        field(Aglyn.FieldComponentType.DATASET_FIELD_SELECT),
      ]),
    ).toEqual(['datasets'])
  })

  it('asks once per list, however many fields declare it', () => {
    const kinds = entityKindsForAttributes([
      field(Aglyn.FieldComponentType.DATASET_SELECT),
      field(Aglyn.FieldComponentType.DATASET_FIELD_SELECT),
      field(Aglyn.FieldComponentType.PRODUCT_SELECT),
    ])
    expect(kinds.sort()).toEqual(['datasets', 'products'])
  })

  it('EVERY entity picker type has a list — none renders empty forever', () => {
    // Derived, not hand-listed: a new `*_SELECT` that lists entities and is
    // never wired here would show an empty dropdown on a site full of data,
    // and nothing else in the suite would notice.
    const ENTITY_PICKERS = [
      Aglyn.FieldComponentType.PRODUCT_SELECT,
      Aglyn.FieldComponentType.COLLECTION_SELECT,
      Aglyn.FieldComponentType.CATEGORY_SELECT,
      Aglyn.FieldComponentType.DATASET_SELECT,
      Aglyn.FieldComponentType.DATASET_FIELD_SELECT,
    ]
    for (const component of ENTITY_PICKERS) {
      expect(entityKindsForAttributes([field(component)])).toHaveLength(1)
    }
    // The guard on the guard: the list above must still name every picker
    // the enum declares.
    const declared = Object.values(Aglyn.FieldComponentType).filter(
      (value) =>
        typeof value === 'string' &&
        /^(product|collection|category|dataset)/.test(value) &&
        value.endsWith('-select'),
    )
    expect(declared.sort()).toEqual([...ENTITY_PICKERS].sort())
  })
})
