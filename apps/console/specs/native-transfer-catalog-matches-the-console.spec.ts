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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildTransferFieldCatalog,
  groupTransferFields,
  moveTransferField,
  resolveTransferFieldSelection,
  resolveTransferPreset,
  searchTransferFields,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferField,
  TransferFieldGroup,
  TransferPresetHints,
  TransferPresetId,
  TransferSavedPreset,
} from '@aglyn/aglyn/data-transfer'

/**
 * The native export sheet and dialog pick their fields the way the console's do (AGL-3671): the same catalog order and
 * groups, the same search, the same three presets and the saved ones, the same reorder. The Swift and Kotlin ports replay
 * `libs/native/contracts/transfer-catalog-cases.json` (AglynCoreTests, native-core desktopTest); this replays it against
 * the console's own functions, so a change there fails here until the ports and the cases follow.
 */
const root = join(__dirname, '../../..')
const cases = JSON.parse(readFileSync(join(root, 'libs/native/contracts/transfer-catalog-cases.json'), 'utf8')) as {
  fields: TransferField[]
  groups: TransferFieldGroup[]
  catalog: { fieldIds: string[]; groups: TransferFieldGroup[] }
  withoutId: { fieldIds: string[] }
  withId: { standard: TransferField[]; fieldIds: string[]; groups: TransferFieldGroup[] }
  search: Array<{ query: string; ids: string[] }>
  group: Array<{ fieldIds: string[] | null; groups: Array<{ group: TransferFieldGroup; ids: string[] }> }>
  selection: Array<{ selected: string[]; ensure: string[]; expect: unknown }>
  preset: Array<{ preset?: TransferPresetId; saved?: TransferSavedPreset; hints: TransferPresetHints; expect: unknown }>
  move: Array<{ ids: string[]; from: number; to: number; expect: string[] }>
}
const ids = (list: readonly { id: string }[]) => list.map((field) => field.id)
const catalog = buildTransferFieldCatalog({ standard: cases.fields, groups: cases.groups })

describe('native export field picking', () => {
  it('lists the fields in the console order, under the console groups', () => {
    expect(ids(catalog.fields)).toEqual(cases.catalog.fieldIds)
    expect(catalog.groups).toEqual(cases.catalog.groups)
    expect(ids(buildTransferFieldCatalog({ standard: cases.fields.filter((field) => field.id !== 'id'), groups: cases.groups }).fields)).toEqual(
      cases.withoutId.fieldIds,
    )
    const withId = buildTransferFieldCatalog({ standard: cases.withId.standard, groups: cases.groups })
    expect(ids(withId.fields)).toEqual(cases.withId.fieldIds)
    expect(withId.groups).toEqual(cases.withId.groups)
  })

  it('searches, groups, resolves a selection and a preset, and moves a field as the console does', () => {
    for (const one of cases.search) expect([one.query, ids(searchTransferFields(catalog, one.query))]).toEqual([one.query, one.ids])
    for (const one of cases.group) {
      expect(groupTransferFields(catalog, one.fieldIds ?? undefined).map((entry) => ({ group: entry.group, ids: ids(entry.fields) }))).toEqual(one.groups)
    }
    for (const one of cases.selection) expect(resolveTransferFieldSelection(catalog, one.selected, one.ensure)).toEqual(one.expect)
    for (const one of cases.preset) expect(resolveTransferPreset(catalog, (one.saved ?? one.preset) as TransferPresetId, one.hints)).toEqual(one.expect)
    for (const one of cases.move) expect(moveTransferField(one.ids, one.from, one.to)).toEqual(one.expect)
    expect(cases.preset.length).toBeGreaterThan(4)
  })
})
