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
 * The list-query planner's cases for the native ports
 * (docs/mobile/native-architecture.md §5). Each case is a declaration, a
 * request and the plan the console's `planListQuery` makes of it; every
 * platform's port replays all of them, so a port that drifts from the console
 * fails its own unit tests.
 *
 * The requests cover every operator of every field with a value of its kind,
 * then the shapes the planner composes or refuses: each declared sort, the
 * search alone and with a clause, two array clauses, and a list's base scope.
 */

import { GENERATED_BY } from './native-contracts.mjs'

/** A representative value per field kind, and for operators that take a list or nothing. */
const SAMPLE = {
  text: 'Acme Widgets',
  exact: 'alpha',
  boolean: 'true',
  number: '42',
  date: '2026-03-14',
  id: 'doc-1',
}

/** Typed words the normalizers are replayed over: case, accents, punctuation, length, emptiness. */
export const NORMALIZER_SAMPLES = [
  'Acme Widgets',
  '  ÉCOLE   Café  ',
  'o’Brien-Smith & Co.',
  'shop@example.com',
  'Supercalifragilisticexpialidocious',
  '#1042',
  '',
]

const valueFor = (field, op) => {
  if (op === 'isEmpty' || op === 'isNotEmpty') return ''
  if (op === 'isAnyOf' || op === 'isNoneOf') return field.kind === 'number' ? '1,2' : 'alpha,beta'
  return SAMPLE[field.kind] ?? 'alpha'
}

/** A Date in a plan is written as `{ "$date": ISO }`; everything else is plain JSON. */
const wire = (value) => {
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Array.isArray(value)) return value.map(wire)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]))
  return value
}

export function listQueryCases({ declarations, plan, operators }) {
  const cases = []
  for (const [name, { declaration, base }] of Object.entries(declarations)) {
    const add = (label, request) => {
      const full = base ? { ...request, base } : request
      cases.push({ declaration: name, label, request: wire(full), plan: wire(plan(declaration, full)) })
    }
    add('no clauses', { clauses: [] })
    for (const field of declaration.fields) {
      for (const op of operators(field)) {
        add(`${field.column} ${op}`, { clauses: [{ field: field.column, op, value: valueFor(field, op) }] })
      }
    }
    for (const sort of declaration.sorts) {
      add(`sort ${sort.path} ${sort.direction}`, { clauses: [], sort })
      add(`sort ${sort.path} reversed`, {
        clauses: [],
        sort: { ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' },
      })
    }
    add('an undeclared sort is ignored', { clauses: [], sort: { path: 'undeclared', direction: 'asc' } })
    if (declaration.search) {
      add('search one word', { clauses: [], search: ['Acme'] })
      add('search two words', { clauses: [], search: ['acme', 'widgets'] })
    }
    const arrayFields = declaration.fields.filter((f) => f.tokensPath && operators(f).includes('contains'))
    const exact = declaration.fields.find((f) => operators(f).includes('equals') && f.kind === 'exact')
    if (declaration.search && exact) {
      add('search with an exact clause', {
        clauses: [{ field: exact.column, op: 'equals', value: 'alpha' }],
        search: ['acme'],
      })
    }
    if (declaration.search && arrayFields.length) {
      add('search with a contains clause', {
        clauses: [{ field: arrayFields[0].column, op: 'contains', value: 'widget' }],
        search: ['acme'],
      })
    }
    if (arrayFields.length >= 2) {
      add('two contains clauses', {
        clauses: arrayFields.slice(0, 2).map((f) => ({ field: f.column, op: 'contains', value: 'widget' })),
      })
    }
    add('an unknown field is refused', { clauses: [{ field: 'nope', op: 'equals', value: 'x' }] })
  }
  return cases
}

export function listQueryCasesContent({ cases, normalizers }) {
  return `${JSON.stringify(
    {
      '//': [
        GENERATED_BY,
        "Each case: a declaration (by its contracts.generated.json name), a request, and the plan the console's planListQuery made of it with nameSearchNormalizers. Dates are { \"$date\": ISO }.",
      ],
      timeZone: 'UTC',
      normalizers,
      cases,
    },
    null,
    2,
  )}\n`
}
