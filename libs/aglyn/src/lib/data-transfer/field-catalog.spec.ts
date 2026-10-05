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

import {
  TRANSFER_CUSTOM_GROUP,
  buildTransferFieldCatalog,
  customTransferField,
  groupTransferFields,
  moveTransferField,
  resolveTransferFieldSelection,
  resolveTransferPreset,
  searchTransferFields,
} from './field-catalog'
import type { TransferField } from './resource'

const standard: TransferField[] = [
  { id: 'email', label: 'Email', type: 'email', group: 'identity', aliases: ['e-mail address'] },
  { id: 'firstName', label: 'First name', type: 'text', group: 'identity', required: true },
  { id: 'stage', label: 'Stage', type: 'picklist', picklistId: 'stage', group: 'status' },
  { id: 'notes', label: 'Notes', type: 'longText' },
  { id: 'tags', label: 'Tags', type: 'tags', group: 'status' },
]

const catalog = buildTransferFieldCatalog({
  standard,
  derived: [{ id: 'score', label: 'Score', type: 'integer', group: 'status' }],
  custom: [{ key: 'favorite_color', label: 'Favorite color' }, { key: 'size', label: 'Size', type: 'number' }],
  system: [
    { id: 'createdAt', label: 'Created', type: 'datetime', readOnly: true },
    { id: 'updatedAt', label: 'Updated', type: 'datetime', readOnly: true },
  ],
  groups: [
    { id: 'identity', label: 'Identity' },
    { id: 'status', label: 'Status' },
  ],
})

describe('buildTransferFieldCatalog', () => {
  it('orders fields group by group, declared groups first and the built-in tail last', () => {
    expect(catalog.groups.map((group) => group.id)).toEqual(['identity', 'status', 'custom', 'system', 'other'])
    expect(catalog.fields.map((field) => field.id)).toEqual([
      'email',
      'firstName',
      'stage',
      'tags',
      'score',
      'custom:favorite_color',
      'custom:size',
      'createdAt',
      'updatedAt',
      'id',
      'notes',
    ])
  })

  it('marks derived and system fields and adds the Aglyn id', () => {
    expect(catalog.byId.get('score')?.derived).toBe(true)
    expect(catalog.byId.get('createdAt')?.system).toBe(true)
    expect(catalog.byId.get('id')).toMatchObject({ system: true, readOnly: true, matchKey: true })
  })

  it('keeps the first declaration of a repeated id', () => {
    const repeated = buildTransferFieldCatalog({
      standard: [standard[0] as TransferField, { id: 'email', label: 'Second', type: 'text' }],
    })
    expect(repeated.byId.get('email')?.label).toBe('Email')
    expect(repeated.fields.filter((field) => field.id === 'email')).toHaveLength(1)
  })

  it('lists a field naming an undeclared group under that group, before the tail', () => {
    const loose = buildTransferFieldCatalog({ standard: [{ id: 'x', label: 'X', type: 'text', group: 'extra' }] })
    expect(loose.groups.map((group) => group.id)).toEqual(['extra', 'system'])
  })
})

describe('customTransferField', () => {
  it('names a custom field by its key with the custom prefix', () => {
    expect(customTransferField({ key: 'size', label: 'Shoe size', type: 'number', required: true })).toEqual({
      id: 'custom:size',
      label: 'Shoe size',
      group: TRANSFER_CUSTOM_GROUP.id,
      type: 'number',
      custom: true,
      aliases: ['size'],
      required: true,
    })
  })
})

describe('grouping and search', () => {
  it('groups a selection in catalog order and drops empty groups', () => {
    const groups = groupTransferFields(catalog, ['tags', 'email'])
    expect(groups.map((entry) => [entry.group.id, entry.fields.map((field) => field.id)])).toEqual([
      ['identity', ['email']],
      ['status', ['tags']],
    ])
  })

  it('finds fields by every word of the query across label, id and aliases', () => {
    expect(searchTransferFields(catalog, 'address').map((field) => field.id)).toEqual(['email'])
    expect(searchTransferFields(catalog, 'favorite COLOR').map((field) => field.id)).toEqual(['custom:favorite_color'])
    expect(searchTransferFields(catalog, '  ')).toHaveLength(catalog.fields.length)
  })
})

describe('presets', () => {
  it('exports everything in catalog order', () => {
    expect(resolveTransferPreset(catalog, 'everything').fieldIds).toEqual(catalog.fields.map((field) => field.id))
  })

  it('leads the re-importable preset with the id and match keys, then every writable field', () => {
    expect(resolveTransferPreset(catalog, 'reimportable', { matchKeyFieldIds: ['email'] }).fieldIds).toEqual([
      'id',
      'email',
      'firstName',
      'stage',
      'tags',
      'custom:favorite_color',
      'custom:size',
      'notes',
    ])
  })

  it('keeps the minimal preset to keys, required fields and the named minimum', () => {
    expect(
      resolveTransferPreset(catalog, 'minimal', { matchKeyFieldIds: ['email'], minimalFieldIds: ['stage', 'gone'] }),
    ).toEqual({ fieldIds: ['id', 'email', 'firstName', 'stage'], unknown: ['gone'] })
  })

  it('resolves a saved preset in its own order, reporting fields that no longer exist', () => {
    expect(
      resolveTransferPreset(catalog, { id: 'mine', label: 'Mine', fieldIds: ['tags', 'custom:deleted', 'email', 'tags'] }),
    ).toEqual({ fieldIds: ['tags', 'email'], unknown: ['custom:deleted'] })
  })

  it('adds ensured fields at the front in catalog order', () => {
    expect(resolveTransferFieldSelection(catalog, ['notes'], ['id', 'email'])).toEqual({
      fieldIds: ['email', 'id', 'notes'],
      unknown: [],
    })
  })
})

describe('moveTransferField', () => {
  it('moves one entry and clamps the destination', () => {
    expect(moveTransferField(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveTransferField(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b'])
    expect(moveTransferField(['a', 'b'], 9, 0)).toEqual(['a', 'b'])
  })
})
