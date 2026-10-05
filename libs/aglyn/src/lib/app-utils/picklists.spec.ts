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
 * The picklist engine (AGL-3510): standard values built into every
 * organization's effective list, the organization's own beside them, and a
 * judge that a restricted list holds and an unrestricted one does not.
 */

import {
  effectivePicklistValueSet,
  groupPicklistOptions,
  isStandardPicklistValueId,
  judgePicklistValue,
  mergePicklistStandard,
  mintPicklistValueId,
  normalizePicklistValueSet,
  picklistOptions,
  type PicklistSpec,
} from './picklists'

/** A spec with groups and meanings, as a status field would declare it. */
const SPEC: PicklistSpec = {
  restricted: true,
  groups: [
    { id: 'in', label: 'In' },
    { id: 'out', label: 'Out' },
  ],
  meanings: ['open', 'closed'],
  defaultValueId: 'fresh',
  standardValues: [
    { id: 'fresh', label: 'Fresh', group: 'in', meaning: 'open' },
    { id: 'done', label: 'Done', group: 'out', meaning: 'closed' },
    { id: 'misc', label: 'Misc', meaning: 'open' },
  ],
}

describe('the picklist engine', () => {
  it('answers the standard values, grouped, with the spec’s default, for a list never stored', () => {
    expect(effectivePicklistValueSet(SPEC, undefined)).toEqual({
      values: [
        { id: 'fresh', label: 'Fresh', active: true, group: 'in', meaning: 'open' },
        { id: 'done', label: 'Done', active: true, group: 'out', meaning: 'closed' },
        { id: 'misc', label: 'Misc', active: true, group: null, meaning: 'open' },
      ],
      defaultValueId: 'fresh',
    })
  })

  it('keeps the stored order and appends the standard values it lacks, active', () => {
    const list = effectivePicklistValueSet(SPEC, {
      values: [
        { id: 'mine', label: 'Mine', group: 'out', meaning: 'closed' },
        { id: 'done', label: 'Finished', active: false, group: null, meaning: 'open' },
      ],
      defaultValueId: null,
    })
    expect(list.values).toEqual([
      { id: 'mine', label: 'Mine', active: true, group: 'out', meaning: 'closed' },
      // An override keeps its label, its state and its group — but never
      // its meaning, which is the spec's.
      { id: 'done', label: 'Finished', active: false, group: null, meaning: 'closed' },
      { id: 'fresh', label: 'Fresh', active: true, group: 'in', meaning: 'open' },
      { id: 'misc', label: 'Misc', active: true, group: null, meaning: 'open' },
    ])
    // A stored list that cleared its default keeps it cleared.
    expect(list.defaultValueId).toBeNull()
    expect(isStandardPicklistValueId(SPEC, 'done')).toBe(true)
    expect(isStandardPicklistValueId(SPEC, 'mine')).toBe(false)
  })

  it('drops a group or a meaning the spec does not know, and a standard value takes its group when none is stored', () => {
    const list = effectivePicklistValueSet(SPEC, {
      values: [
        { id: 'mine', label: 'Mine', group: 'sideways', meaning: 'maybe' },
        { id: 'fresh', label: 'Fresh' },
      ],
    })
    expect(list.values[0]).toEqual({ id: 'mine', label: 'Mine', active: true, group: null, meaning: null })
    expect(list.values[1].group).toBe('in')
  })

  it('adopts an added value carrying a missing standard value’s label, moving the default with it', () => {
    const list = effectivePicklistValueSet(SPEC, {
      values: [{ id: 'old-done', label: 'DONE', group: 'in' }],
      defaultValueId: 'old-done',
    })
    expect(list.values.map((value) => value.id)).toEqual(['done', 'fresh', 'misc'])
    expect(list.values[0]).toMatchObject({ label: 'DONE', meaning: 'closed', group: 'in' })
    expect(list.defaultValueId).toBe('done')
    // Labels stay unique even when one standard value was renamed onto another's.
    const clash = effectivePicklistValueSet(SPEC, { values: [{ id: 'fresh', label: 'Done' }] })
    expect(clash.values.map((value) => value.label)).toEqual(['Done', 'Misc'])
  })

  it('reads without a spec exactly as stored, with no group or meaning', () => {
    expect(normalizePicklistValueSet({ values: [{ id: 'a', label: 'A', group: 'in' }] })).toEqual({
      values: [{ id: 'a', label: 'A', active: true }],
      defaultValueId: null,
    })
    expect(mergePicklistStandard({ restricted: false, standardValues: [] }, null)).toEqual({
      values: [],
      defaultValueId: null,
    })
  })

  it('mints an added id clear of the ids it is told are taken', () => {
    expect(mintPicklistValueId('Done', ['done'])).toBe('done-2')
    // A stored value with no id is minted clear of every standard id too.
    const list = normalizePicklistValueSet({ values: [{ label: 'Fresh!' }] }, SPEC)
    expect(list?.values[0].id).toBe('fresh-2')
  })

  it('refuses outside a restricted list, and stores what it is given on an unrestricted one', () => {
    const list = effectivePicklistValueSet(SPEC, {
      values: [{ id: 'gone', label: 'Gone', active: false }],
    })
    const refusal = () => 'Refused.'
    expect(judgePicklistValue(list, ' fresh ', { restricted: true, refusal })).toEqual({
      ok: true,
      value: 'Fresh',
    })
    expect(judgePicklistValue(list, 'Elsewhere', { restricted: true, refusal })).toEqual({
      ok: false,
      error: 'Refused.',
    })
    expect(judgePicklistValue(list, 'gone', { restricted: true, refusal })).toMatchObject({ ok: false })
    expect(
      judgePicklistValue(list, 'gone', { restricted: true, current: 'Gone', refusal }),
    ).toEqual({ ok: true, value: 'Gone' })
    expect(judgePicklistValue(list, 'Elsewhere', { restricted: false, refusal })).toEqual({
      ok: true,
      value: 'Elsewhere',
    })
    expect(judgePicklistValue(list, 'GONE', { restricted: false, refusal })).toEqual({
      ok: true,
      value: 'Gone',
    })
    expect(judgePicklistValue(list, '  ', { restricted: true, refusal })).toEqual({
      ok: true,
      value: null,
    })
  })

  it('lists options under their groups in the spec’s order, ungrouped and kept values last', () => {
    const list = effectivePicklistValueSet(SPEC, {
      values: [
        { id: 'misc', label: 'Misc' },
        { id: 'done', label: 'Done' },
        { id: 'fresh', label: 'Fresh' },
      ],
    })
    const sections = groupPicklistOptions(picklistOptions(list, 'Legacy'), SPEC.groups ?? [])
    expect(sections.map((section) => [section.group?.label ?? null, section.options.map((o) => o.label)])).toEqual([
      ['In', ['Fresh']],
      ['Out', ['Done']],
      [null, ['Misc', 'Legacy']],
    ])
    expect(sections[2].options[1]).toEqual({ label: 'Legacy', inactive: false, unlisted: true })
  })
})
