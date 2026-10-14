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
 * The `submit_dataset` check (AGL-3616): a site's dataset is published as
 * the site's own words the day it goes live, so it says nothing nobody said —
 * no review, rating or testimonial, no price the brief does not state, no gap
 * in brackets — and keeps the fields its pages were planned around.
 */

import { aiDatasetDraftContent, aiDatasetPrompt, AI_DATASET_INSTRUCTIONS } from '../runtime/ai-dataset-generation'
import { AI_DATASET_LIMITS, AI_DATASET_TOOL, checkAiDataset } from './ai-dataset-tool'

const BRIEF = 'A trattoria in Bologna. Margherita is €9. We serve fresh pasta and wood-fired pizza.'

const FIELDS = [
  { name: 'Dish', type: 'text' },
  { name: 'Description', type: 'text' },
  { name: 'Course', type: 'text' },
]

const answer = (records: string[][], fields: Array<{ name: string; type: string }> = FIELDS) => ({
  fields,
  records: records.map((values) => ({ values })),
})

const GOOD = [
  ['Margherita', 'Tomato, fior di latte and basil.', 'Pizza'],
  ['Tagliatelle al ragù', 'Fresh egg pasta with a slow-cooked ragù.', 'Pasta'],
  ['Tiramisù', 'Mascarpone, espresso and cocoa.', 'Dessert'],
]

const codes = (result: ReturnType<typeof checkAiDataset>) => result.violations.map((violation) => violation.code)

describe('a site’s dataset', () => {
  const planned = ['Dish', 'Description']

  it('passes a dataset that keeps its planned fields and says only what the brief supports', () => {
    const result = checkAiDataset(answer(GOOD), { planned, merchantWords: BRIEF })
    expect(result.violations).toEqual([])
    expect(result.value).toEqual({ fields: FIELDS, records: GOOD })
  })

  it('keeps the planned fields, the first a text field that names each record', () => {
    expect(codes(checkAiDataset(answer(GOOD, FIELDS.slice(1)), { planned, merchantWords: BRIEF }))).toContain('planned-field')
    const numberFirst = [{ name: 'Dish', type: 'number' }, ...FIELDS.slice(1)]
    expect(codes(checkAiDataset(answer(GOOD, numberFirst), { planned, merchantWords: BRIEF }))).toContain('first-field')
  })

  it('holds what customers say to them: no reviews field and no rating', () => {
    const reviews = [...FIELDS, { name: 'Review', type: 'text' }]
    expect(codes(checkAiDataset(answer(GOOD.map((row) => [...row, '']), [...FIELDS, { name: 'Notes', type: 'text' }]), { planned, merchantWords: BRIEF }))).toEqual([])
    expect(codes(checkAiDataset(answer(GOOD.map((row) => [...row, 'Loved it']), reviews), { planned, merchantWords: BRIEF }))).toContain('said-field')
    const rated = GOOD.map((row, index) => (index ? row : [row[0], 'Rated 5 stars by our guests.', row[2]]))
    expect(codes(checkAiDataset(answer(rated), { planned, merchantWords: BRIEF }))).toContain('rating-invented')
  })

  it('states a price only where the brief does, and marks no gap in brackets', () => {
    const priced = [...FIELDS, { name: 'Price', type: 'text' }]
    const stated = GOOD.map((row, index) => [...row, index === 0 ? '€9' : ''])
    expect(codes(checkAiDataset(answer(stated, priced), { planned, merchantWords: BRIEF }))).toEqual([])
    const invented = GOOD.map((row) => [...row, '€14'])
    expect(codes(checkAiDataset(answer(invented, priced), { planned, merchantWords: BRIEF }))).toContain('price-invented')
    const gap = GOOD.map((row, index) => (index ? row : [row[0], '[describe the dish]', row[2]]))
    expect(codes(checkAiDataset(answer(gap), { planned, merchantWords: BRIEF }))).toContain('bracket')
  })

  it('holds the record count, one value per field, distinct names and typed values', () => {
    expect(codes(checkAiDataset(answer(GOOD.slice(0, 2)), { planned, merchantWords: BRIEF }))).toContain('count')
    expect(
      codes(checkAiDataset(answer(Array.from({ length: AI_DATASET_LIMITS.recordsMax + 1 }, (_, index) => [`Dish ${index}`, '', ''])), { planned, merchantWords: BRIEF })),
    ).toContain('count')
    expect(codes(checkAiDataset(answer([...GOOD.slice(0, 2), ['Margherita', '', '']]), { planned, merchantWords: BRIEF }))).toContain('duplicate')
    expect(codes(checkAiDataset(answer([...GOOD.slice(0, 2), ['Gelato', '']]), { planned, merchantWords: BRIEF }))).toContain('values')
    const seats = [...FIELDS, { name: 'Seats', type: 'integer' }, { name: 'Spicy', type: 'boolean' }]
    const typed = GOOD.map((row) => [...row, 'many', 'very'])
    expect(codes(checkAiDataset(answer(typed, seats), { planned, merchantWords: BRIEF }))).toEqual(expect.arrayContaining(['number', 'boolean']))
  })

  it('is a strict tool whose every property is required', () => {
    expect(AI_DATASET_TOOL.strict).toBe(true)
    expect(AI_DATASET_TOOL.inputSchema['required']).toEqual(['fields', 'records'])
  })
})

describe('asking for a dataset, and handing it to the data plugin', () => {
  it('keeps the site out of the cached rules and puts the dataset in the user turn', () => {
    const rules = AI_DATASET_INSTRUCTIONS.map((block) => block.text).join('\n')
    expect(rules).not.toContain('trattoria')
    expect(rules).toContain('no review, testimonial, rating or quote')
    const prompt = aiDatasetPrompt({
      brief: BRIEF,
      name: 'Menu',
      why: 'the dishes',
      fields: ['Dish', 'Description'],
      shownIn: ['Menu › The whole menu (12 items)'],
      recordPages: true,
    })
    expect(prompt).toContain('Dataset: “Menu” — the dishes')
    expect(prompt).toContain('Planned fields: “Dish”, “Description”')
    expect(prompt).toContain('Listed on: Menu › The whole menu (12 items).')
    expect(prompt).toContain('Each record also gets a page of its own')
  })

  it('turns the answer into the writer’s values by field name, a list split and an empty value left out', () => {
    const content = aiDatasetDraftContent(
      'Team',
      {
        fields: [
          { name: 'Role', type: 'text' },
          { name: 'Years', type: 'integer' },
          { name: 'Specialties', type: 'list' },
        ],
        records: [
          ['Head chef', '1,200', 'pasta; bread'],
          ['Pastry chef', '', ''],
        ],
      },
      { recordPages: false },
    )
    expect(content).toEqual({
      name: 'Team',
      fields: [
        { name: 'Role', type: 'text' },
        { name: 'Years', type: 'integer' },
        { name: 'Specialties', type: 'list' },
      ],
      records: [{ Role: 'Head chef', Years: '1200', Specialties: ['pasta', 'bread'] }, { Role: 'Pastry chef' }],
    })
  })
})
