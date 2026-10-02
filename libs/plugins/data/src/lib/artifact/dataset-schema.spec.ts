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
 *
 * @jest-environment node
 */

import { DATASET_FIELD_TYPES } from '@aglyn/aglyn'
import { PORTABLE_DATASET_FIELD_TYPES } from '@aglyn/aglyn/app-utils/node-definition-sanitizer'
import {
  resolveInstalledDatasetSchema,
  sanitizeDatasetSchema,
  summarizeSchemaChange,
} from './dataset-schema'

/**
 * A dataset's schema as it travels between workspaces (AGL-657): what publish
 * keeps, how an install relinks it, and how an update reads what a new
 * version does to existing records (AGL-1018). These cases came with the
 * model from the marketplace (AGL-3080), unchanged.
 */

describe('sanitizeDatasetSchema (AGL-657)', () => {
  it('accepts exactly the field types core defines', () => {
    // PORTABLE_DATASET_FIELD_TYPES is duplicated to keep the sanitizer module
    // dependency-free; this is the guard that keeps the copy honest, so a new
    // core field type can't become silently unpublishable.
    expect([...PORTABLE_DATASET_FIELD_TYPES].sort()).toEqual(
      [...DATASET_FIELD_TYPES].sort(),
    )
  })

  const model = {
    fields: {
      title: { name: 'Title', type: 'text', required: true },
      rating: {
        name: 'Rating',
        type: 'int32',
        validation: { min: 1, max: 5, junk: 'dropped' },
      },
      owner: {
        name: 'Owner',
        type: 'reference',
        reference: { datasetId: 'ds-people', displayFieldId: 'name' },
      },
    },
    order: ['title', 'rating', 'owner'],
  }

  it('keeps the model and drops unknown validation keys', () => {
    const result = sanitizeDatasetSchema(model)
    if (result.ok === false) throw new Error(result.error)
    expect(result.schema.order).toEqual(['title', 'rating', 'owner'])
    expect(result.schema.fields['rating'].validation).toEqual({ min: 1, max: 5 })
    expect(result.schema.fields['title'].required).toBe(true)
  })

  it('never carries records: only the field model is read', () => {
    const result = sanitizeDatasetSchema({
      ...model,
      // A records key on the input must not survive into the schema.
      records: [{ values: { title: 'secret customer row' } }],
    } as any)
    if (result.ok === false) throw new Error(result.error)
    expect(JSON.stringify(result.schema)).not.toContain('secret customer row')
    expect(Object.keys(result.schema)).toEqual(['fields', 'order'])
  })

  it('drops non-primitive defaults', () => {
    const result = sanitizeDatasetSchema({
      fields: {
        a: { name: 'A', type: 'text', default: 'ok' },
        b: { name: 'B', type: 'map', default: { nested: 'no' } },
      },
      order: ['a', 'b'],
    })
    if (result.ok === false) throw new Error(result.error)
    expect(result.schema.fields['a'].default).toBe('ok')
    expect(result.schema.fields['b'].default).toBeUndefined()
  })

  it('rejects unsupported field types and empty models', () => {
    expect(
      sanitizeDatasetSchema({
        fields: { a: { name: 'A', type: 'sqlInjection' } },
        order: ['a'],
      }),
    ).toEqual({ ok: false, error: 'Field "a" has an unsupported type' })
    expect(sanitizeDatasetSchema({ fields: {}, order: [] })).toEqual({
      ok: false,
      error: 'Dataset has no fields to publish',
    })
  })

  it('falls back to key order for models written before `order`', () => {
    const result = sanitizeDatasetSchema({
      fields: { a: { name: 'A', type: 'text' } },
    })
    if (result.ok === false) throw new Error(result.error)
    expect(result.schema.order).toEqual(['a'])
  })
})

describe('resolveInstalledDatasetSchema (AGL-657)', () => {
  const schema = {
    fields: {
      title: { name: 'Title', type: 'text' },
      owner: {
        name: 'Owner',
        type: 'reference',
        reference: { datasetId: 'ds-people', datasetLabel: 'People' },
      },
    },
    order: ['title', 'owner'],
  }

  it('relinks a reference onto the installing org’s dataset by label', () => {
    const result = resolveInstalledDatasetSchema(schema, {
      people: 'local-people-id',
    })
    expect(result.degradedFieldIds).toEqual([])
    expect(result.schema.fields['owner'].reference?.datasetId).toBe(
      'local-people-id',
    )
  })

  it('degrades an unmatched reference to text and reports it', () => {
    const result = resolveInstalledDatasetSchema(schema, {})
    // A dead FK renders as a broken picker, so the field becomes plain text
    // rather than installing something visibly broken.
    expect(result.degradedFieldIds).toEqual(['owner'])
    expect(result.schema.fields['owner'].type).toBe('text')
    expect(result.schema.fields['owner'].reference).toBeUndefined()
    expect(result.schema.fields['title']).toEqual({ name: 'Title', type: 'text' })
  })
})

describe('summarizeSchemaChange (AGL-1018)', () => {
  const shape = (fields: Record<string, { type: string }>) => ({
    order: Object.keys(fields),
    fields,
  })

  it('calls an added field additive', () => {
    const summary = summarizeSchemaChange(
      shape({ a: { type: 'text' } }),
      shape({ a: { type: 'text' }, b: { type: 'number' } }),
    )
    expect(summary.added).toEqual(['b'])
    expect(summary.additiveOnly).toBe(true)
  })

  it('refuses to call a removed field additive', () => {
    const summary = summarizeSchemaChange(
      shape({ a: { type: 'text' }, b: { type: 'number' } }),
      shape({ a: { type: 'text' } }),
    )
    expect(summary.removed).toEqual(['b'])
    expect(summary.additiveOnly).toBe(false)
  })

  it('treats a retype as destructive: existing values may not survive', () => {
    const summary = summarizeSchemaChange(
      shape({ a: { type: 'text' } }),
      shape({ a: { type: 'number' } }),
    )
    expect(summary.retyped).toEqual(['a'])
    expect(summary.additiveOnly).toBe(false)
  })

  it('separates a cosmetic field edit from a retype', () => {
    const summary = summarizeSchemaChange(
      { order: ['a'], fields: { a: { type: 'text', label: 'A' } as never } },
      { order: ['a'], fields: { a: { type: 'text', label: 'Name' } as never } },
    )
    expect(summary.edited).toEqual(['a'])
    expect(summary.additiveOnly).toBe(true)
  })
})
