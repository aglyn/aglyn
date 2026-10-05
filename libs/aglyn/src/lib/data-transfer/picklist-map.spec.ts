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

import { effectivePicklistValueSet } from '../app-utils/picklists'
import type { PicklistSpec } from '../app-utils/picklists'
import {
  collectPicklistValues,
  matchPicklistValues,
  picklistChoiceProblems,
  proposePicklistChoice,
  resolveMultiPicklistCell,
  resolvePicklistCell,
  resolvePicklistChoices,
} from './picklist-map'

const plain: PicklistSpec = {
  restricted: false,
  standardValues: [
    { id: 'hot', label: 'Hot' },
    { id: 'warm', label: 'Warm' },
    { id: 'cold', label: 'Cold' },
  ],
}

const semantic: PicklistSpec = {
  restricted: true,
  standardValues: [
    { id: 'open', label: 'Open', meaning: 'open', group: 'active' },
    { id: 'closed', label: 'Closed', meaning: 'done', group: 'finished' },
  ],
  meanings: ['open', 'done'],
  groups: [
    { id: 'active', label: 'Active' },
    { id: 'finished', label: 'Finished' },
  ],
}

describe('collectPicklistValues', () => {
  it('counts distinct values caselessly, keeping the first spelling and sample rows', () => {
    const values = collectPicklistValues([
      { row: 0, value: 'Hot' },
      { row: 1, value: ' hot ' },
      { row: 2, value: ['Lukewarm', 'HOT'] },
      { row: 3, value: '' },
    ])
    expect(values).toEqual([
      { value: 'Hot', key: 'hot', count: 3, rows: [0, 1, 2] },
      { value: 'Lukewarm', key: 'lukewarm', count: 1, rows: [2] },
    ])
  })
})

describe('matchPicklistValues', () => {
  const set = effectivePicklistValueSet(plain, {
    values: [
      { id: 'hot', label: 'Hot', active: true },
      { id: 'warm', label: 'Warm', active: false },
    ],
    defaultValueId: null,
  })

  it('matches by label in any case, by id, and notes an inactive match', () => {
    const result = matchPicklistValues(
      set,
      collectPicklistValues([
        { row: 0, value: 'HOT' },
        { row: 1, value: 'warm' },
        { row: 2, value: 'cold' },
      ]),
    )
    expect(result.matched.map((entry) => [entry.value, entry.valueId, entry.label, entry.inactive])).toEqual([
      ['HOT', 'hot', 'Hot', false],
      ['warm', 'warm', 'Warm', true],
      ['cold', 'cold', 'Cold', false],
    ])
    expect(result.unmatched).toEqual([])
  })

  it('matches an id that is not a label', () => {
    const renamed = effectivePicklistValueSet(plain, {
      values: [{ id: 'hot', label: 'Very hot', active: true }],
      defaultValueId: null,
    })
    const [entry] = matchPicklistValues(renamed, collectPicklistValues([{ row: 0, value: 'hot' }])).matched
    expect(entry).toMatchObject({ valueId: 'hot', label: 'Very hot', byId: true })
  })

  it('suggests the closest active values for an unmatched one', () => {
    const result = matchPicklistValues(set, collectPicklistValues([{ row: 0, value: 'Coldd' }, { row: 1, value: 'Purple' }]))
    expect(result.unmatched[0]?.suggestions[0]).toMatchObject({ valueId: 'cold', label: 'Cold' })
    expect(result.unmatched[1]?.suggestions).toEqual([])
  })
})

describe('choices', () => {
  const set = effectivePicklistValueSet(plain, null)
  const result = matchPicklistValues(
    set,
    collectPicklistValues([
      { row: 0, value: 'Hot!' },
      { row: 1, value: 'Lukewarm' },
      { row: 2, value: 'Purple' },
      { row: 3, value: 'Spam' },
      { row: 4, value: 'Warm' },
    ]),
  )

  it('proposes mapping a near-certain value and adding to an open list', () => {
    const [hotBang, lukewarm] = result.unmatched
    expect(proposePicklistChoice(plain, hotBang as never)).toEqual({ action: 'mapTo', valueId: 'hot' })
    expect(proposePicklistChoice(plain, lukewarm as never)).toEqual({ action: 'addValue' })
    expect(proposePicklistChoice(semantic, { ...lukewarm, suggestions: [] } as never)).toEqual({ action: 'leaveBlank' })
  })

  it('reports a missing choice, a bad target, and an added label that already exists', () => {
    expect(
      picklistChoiceProblems(plain, set, result.unmatched, {
        'hot!': { action: 'mapTo', valueId: 'nope' },
        lukewarm: { action: 'addValue', label: 'warm' },
        purple: { action: 'leaveBlank' },
      }),
    ).toEqual([
      '"Hot!" is mapped to a value the list does not hold.',
      '"warm" is already in the list or added twice.',
      'Choose what to do with "Spam".',
    ])
  })

  it('requires a known meaning and group on a semantic list', () => {
    const semanticSet = effectivePicklistValueSet(semantic, null)
    const unmatched = matchPicklistValues(semanticSet, collectPicklistValues([{ row: 0, value: 'Parked' }])).unmatched
    expect(picklistChoiceProblems(semantic, semanticSet, unmatched, { parked: { action: 'addValue' } })).toEqual([
      '"Parked" needs a meaning to be added.',
    ])
    expect(
      picklistChoiceProblems(semantic, semanticSet, unmatched, {
        parked: { action: 'addValue', meaning: 'paused', group: 'limbo' },
      }),
    ).toEqual(['"Parked" names an unknown meaning.', '"Parked" names an unknown group.'])
  })

  it('applies choices: maps, adds with a fresh id, blanks and refuses', () => {
    const resolution = resolvePicklistChoices(plain, set, result, {
      'hot!': { action: 'mapTo', valueId: 'hot' },
      lukewarm: { action: 'addValue', label: 'Lukewarm' },
      purple: { action: 'leaveBlank' },
      spam: { action: 'refuseRow' },
    })
    expect(resolution.added).toEqual([{ id: 'lukewarm', label: 'Lukewarm', active: true }])
    expect(resolution.set.values.map((value) => value.label)).toEqual(['Hot', 'Warm', 'Cold', 'Lukewarm'])
    expect(resolvePicklistCell(resolution, 'hot!')).toEqual({ kind: 'value', label: 'Hot', valueId: 'hot' })
    expect(resolvePicklistCell(resolution, 'LUKEWARM')).toEqual({ kind: 'value', label: 'Lukewarm', valueId: 'lukewarm' })
    expect(resolvePicklistCell(resolution, 'warm')).toEqual({ kind: 'value', label: 'Warm', valueId: 'warm' })
    expect(resolvePicklistCell(resolution, 'Purple')).toEqual({ kind: 'blank' })
    expect(resolvePicklistCell(resolution, 'Spam')).toEqual({ kind: 'refuse' })
    expect(resolvePicklistCell(resolution, '')).toEqual({ kind: 'blank' })
    expect(resolveMultiPicklistCell(resolution, ['Hot!', 'Hot', 'Purple', 'Lukewarm'])).toEqual({
      kind: 'values',
      labels: ['Hot', 'Lukewarm'],
    })
    expect(resolveMultiPicklistCell(resolution, ['Hot', 'Spam'])).toEqual({ kind: 'refuse' })
  })

  it('never mints an added id that a standard value owns', () => {
    const custom = effectivePicklistValueSet(plain, { values: [{ id: 'hot', label: 'Scorching', active: true }], defaultValueId: null })
    const unmatched = matchPicklistValues(custom, collectPicklistValues([{ row: 0, value: 'Cool' }]))
    const resolution = resolvePicklistChoices(plain, custom, unmatched, { cool: { action: 'addValue', label: 'Hot' } })
    expect(resolution.added[0]?.id).toBe('hot-2')
  })

  it('records a group and meaning on a semantic list', () => {
    const semanticSet = effectivePicklistValueSet(semantic, null)
    const unmatched = matchPicklistValues(semanticSet, collectPicklistValues([{ row: 0, value: 'Parked' }]))
    const resolution = resolvePicklistChoices(semantic, semanticSet, unmatched, {
      parked: { action: 'addValue', meaning: 'open', group: 'active' },
    })
    expect(resolution.added).toEqual([{ id: 'parked', label: 'Parked', active: true, group: 'active', meaning: 'open' }])
  })
})
