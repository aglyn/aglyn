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

/** The contracts codegen over a fixture program: the type model, both sources, the values and the planner cases. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  buildContractModel,
  camelFromConstant,
  kotlinContractsContent,
  plainValue,
  swiftContractsContent,
} from './native-contracts.mjs'
import { functionCases, listQueryCases } from './native-list-query-cases.mjs'

const ts = createRequire(import.meta.url)('typescript')

const FIXTURE = {
  'pure/order.ts': `
    import type { Risk } from './risk'
    import type { Hidden } from '../web/hidden'
    export type Status = 'paid' | 'partially_refunded' | 'default'
    export type Op = '==' | '<='
    export interface Line { sku: string; quantity: number; note?: string | null }
    export interface Order {
      id: string
      status: Status
      previous?: Status | null
      lines: readonly Line[]
      totals: Record<string, number>
      byStatus: Record<Status, string>
      meta: { source: 'pos' | 'web'; tags?: string[] }
      extra: unknown
      code: 301 | 302
      risk?: Risk
      cents: number
      secret?: string
    }
    export interface WithDate { at: Date }
    export interface WithFn { run(): void }
    export interface WithHidden { hidden: Hidden }
    export interface Mixed { value: string | number }
    export const LIMIT = 30
    export const LABELS: Record<Status, string> = { paid: 'Paid', partially_refunded: 'Partly refunded', default: 'Default' }
  `,
  'pure/risk.ts': `export interface Risk { kind: 'fraud' | 'review' }`,
  'web/hidden.ts': `export interface Hidden { x: string }`,
}

function fixtureProgram() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-contracts-')))
  for (const [file, source] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
  const program = ts.createProgram({
    rootNames: [join(root, 'pure/order.ts')],
    options: { strictNullChecks: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2022 },
  })
  return { root, program }
}

const pure = new Set(['pure/order.ts', 'pure/risk.ts'])
const build = (modules, extra = {}) => {
  const { root, program } = fixtureProgram()
  return buildContractModel({ ts, program, root, pure, config: { modules: { 'pure/order.ts': modules }, ...extra } })
}

test('the model: enums, structs, maps, inline shapes, nullability, ints, json and omissions', () => {
  const model = build(
    { types: ['Order', 'Op'], values: ['LIMIT', 'LABELS'] },
    { ints: ['Order.cents'], json: [], omit: ['Order.secret'] },
  )
  const byName = Object.fromEntries(model.types.map((t) => [t.name, t]))
  assert.deepEqual(byName.Status, { kind: 'enum', name: 'Status', cases: ['default', 'paid', 'partially_refunded'] })
  assert.deepEqual(byName.Op.cases, ['<=', '=='])
  assert.deepEqual(byName.OrderMetaSource.cases, ['pos', 'web'])
  const fields = Object.fromEntries(byName.Order.fields.map((f) => [f.name, f]))
  assert.equal(fields.secret, undefined)
  assert.deepEqual(fields.status, { name: 'status', type: { kind: 'named', name: 'Status' }, optional: false })
  assert.equal(fields.previous.optional, true)
  assert.equal(fields.previous.type.name, 'Status')
  assert.deepEqual(fields.lines.type, { kind: 'array', of: { kind: 'named', name: 'Line' } })
  assert.deepEqual(fields.totals.type, { kind: 'map', of: { kind: 'double' } })
  assert.deepEqual(fields.byStatus.type, { kind: 'map', of: { kind: 'string' } })
  assert.deepEqual(fields.meta.type, { kind: 'named', name: 'OrderMeta' })
  assert.deepEqual(fields.extra.type, { kind: 'json' })
  assert.deepEqual(fields.code.type, { kind: 'int' })
  assert.deepEqual(fields.cents.type, { kind: 'int' })
  assert.equal(fields.risk.type.name, 'Risk')
  assert.equal(Object.fromEntries(byName.Line.fields.map((f) => [f.name, f.optional])).note, true)
  assert.deepEqual(
    model.values.map((v) => [v.name, v.type.kind]),
    [
      ['LABELS', 'map'],
      ['LIMIT', 'int'],
    ],
  )
})

test('refusals name the type and why', () => {
  const refuse = (modules, pattern, extra) => assert.throws(() => build(modules, extra), pattern)
  refuse({ types: ['WithDate'] }, /WithDate\.at: Date has no stable wire form/)
  refuse({ types: ['WithFn'] }, /WithFn\.run: a (method|function) has no native form/)
  refuse({ types: ['WithHidden'] }, /the type Hidden is declared in web\/hidden\.ts, which is not on mobile-pure-modules\.json/)
  refuse({ types: ['Mixed'] }, /Mixed\.value: the union string \| number has no native form/)
  refuse({ types: ['Nope'] }, /does not export Nope/)
  refuse({ types: ['Line'] }, /names fields no emitted type has:\nints: Order\.cents/, { ints: ['Order.cents'] })
  const { root, program } = fixtureProgram()
  assert.throws(
    () => buildContractModel({ ts, program, root, pure, config: { modules: { 'web/hidden.ts': { types: ['Hidden'] } } } }),
    /web\/hidden\.ts is not on tools\/scripts\/mobile-pure-modules\.json/,
  )
})

test('Swift: Codable, Hashable, Sendable types with an unknown fallback and keyword-safe names', () => {
  const swift = swiftContractsContent(build({ types: ['Order', 'Op'], values: ['LIMIT', 'LABELS'] }, { ints: ['Order.cents'] }))
  assert.match(swift, /public enum Status: String, Codable, CaseIterable, Hashable, Sendable \{/)
  assert.match(swift, /case `default` = "default"/)
  assert.match(swift, /case partiallyRefunded = "partially_refunded"/)
  assert.match(swift, /case unknown = ""/)
  assert.match(swift, /self = Self\(rawValue: raw\) \?\? \.unknown/)
  assert.match(swift, /case lessThanOrEqual = "<="/)
  assert.match(swift, /public var previous: Status\?/)
  assert.match(swift, /public var totals: \[String: Double\]/)
  assert.match(swift, /public var extra: ContractJSON\n/)
  assert.match(swift, /public var cents: Int\n/)
  assert.match(swift, /public let limit: Int/)
  assert.match(swift, /case limit = "LIMIT"/)
})

test('Kotlin: serializable data classes and raw-string enums with an UNKNOWN fallback', () => {
  const kotlin = kotlinContractsContent(build({ types: ['Order'], values: ['LABELS'] }))
  assert.match(kotlin, /@Serializable\(with = StatusSerializer::class\)\nenum class Status\(val raw: String\) \{/)
  assert.match(kotlin, /PARTIALLY_REFUNDED\("partially_refunded"\),/)
  assert.match(kotlin, /UNKNOWN\(""\),/)
  assert.match(kotlin, /RawEnumSerializer<Status>\("com\.aglyn\.contracts\.Status", Status\.entries, Status\.UNKNOWN, \{ it\.raw \}\)/)
  assert.match(kotlin, /val previous: Status\? = null,/)
  assert.match(kotlin, /val lines: List<Line>,/)
  assert.match(kotlin, /val extra: JsonElement,/)
  assert.match(kotlin, /@SerialName\("LABELS"\) val labels: Map<String, String>,/)
})

test('values are plain JSON or refused', () => {
  assert.deepEqual(plainValue({ b: 1, a: [true, null, 'x'], skip: undefined }, 'v'), { a: [true, null, 'x'], b: 1 })
  assert.throws(() => plainValue({ at: new Date(0) }, 'v'), /v\.at: Date is not plain JSON/)
  assert.throws(() => plainValue({ f: () => 1 }, 'v'), /v\.f: function is not plain JSON/)
  assert.throws(() => plainValue(Number.NaN, 'v'), /is not a JSON number/)
  assert.equal(camelFromConstant('ORDER_LIST_QUERY'), 'orderListQuery')
})

test('planner cases cover every operator, sort and refusal shape, with dates on the wire', () => {
  const declaration = {
    fields: [
      { column: 'name', kind: 'text', path: 'name', tokensPath: 'nameTokens' },
      { column: 'tag', kind: 'exact', path: 'tag', tokensPath: 'tags' },
      { column: 'at', kind: 'date', path: 'at' },
    ],
    sorts: [{ path: 'name', direction: 'asc' }],
    search: { tokensPath: 'searchTokens' },
  }
  const operators = (field) => (field.kind === 'date' ? ['is'] : ['contains', 'equals'])
  const cases = listQueryCases({
    declarations: { LIST: { declaration, base: [{ path: 'deleted', op: '==', value: null }] } },
    plan: (_d, request) => ({ filters: [{ path: 'at', op: '>=', value: new Date(Date.UTC(2026, 2, 14)) }], request }),
    operators,
  })
  const labels = cases.map((c) => c.label)
  for (const label of ['no clauses', 'name contains', 'tag equals', 'at is', 'sort name asc', 'sort name reversed', 'search two words', 'two contains clauses', 'an unknown field is refused']) {
    assert.ok(labels.includes(label), label)
  }
  assert.deepEqual(cases[0].plan.filters[0].value, { $date: '2026-03-14T00:00:00.000Z' })
  assert.deepEqual(cases[0].request.base, [{ path: 'deleted', op: '==', value: null }])
})

test('function cases: listed inputs and every combination, with plain results', () => {
  const module = { add: (a, b) => a + b, label: (o) => `#${o.n}`, set: () => new Set([1]) }
  const load = () => module
  const out = functionCases(
    { label: { module: 'm.ts', args: [[{ n: 7 }]] }, add: { module: 'm.ts', argsProduct: [[1, 2], [10]] } },
    load,
    plainValue,
  )
  assert.deepEqual(Object.keys(out), ['add', 'label'])
  assert.deepEqual(out.add.cases, [
    { args: [1, 10], result: 11 },
    { args: [2, 10], result: 12 },
  ])
  assert.deepEqual(out.label.cases, [{ args: [{ n: 7 }], result: '#7' }])
  assert.throws(() => functionCases({ set: { module: 'm.ts', args: [[]] } }, load, plainValue), /set case 0: Set is not plain JSON/)
  assert.throws(() => functionCases({ nope: { module: 'm.ts', args: [[]] } }, load, plainValue), /exports no function nope/)
  assert.throws(() => functionCases({ add: { module: 'm.ts' } }, load, plainValue), /lists no inputs/)
})
