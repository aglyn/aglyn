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

/**
 * The `variable` and `function` draft writers (AGL-3616), against the real
 * function grammar and the real plan table: only the Admin SDK is a double,
 * one that honors transactions, counts a collection and projects one.
 *
 *  - THE DOCUMENT is the one the Variables and Functions cards create.
 *  - THE REFUSAL is the resources route's: role, then allowance; a taken
 *    name is refused, never overwritten.
 *  - THE WRITE is idempotent under its id.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { evaluateHostFunction, type HostFunction } from '@aglyn/aglyn/app-utils/functions'
import { formatVariableValue } from '@aglyn/aglyn/app-utils/variables'
import {
  checkFunctionDraftContent,
  checkVariableDraftContent,
} from './logic-draft-content'
import {
  createFunctionDraftWriter,
  createVariableDraftWriter,
  LOGIC_DRAFT_ROLE_REFUSAL,
  logicDraftLimitRefusal,
  logicDraftNameTaken,
} from './logic-drafts'

const NOW = new Date('2026-10-07T15:00:00.000Z')

// ── Firestore double ─────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>()
let commits: string[] = []

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

const childrenOf = (path: string) =>
  [...store.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  return {
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    count: () => ({ kind: 'count', get: async () => ({ data: () => ({ count: childrenOf(path).length }) }) }),
    select: () => ({ kind: 'query', get: async () => ({ docs: childrenOf(path).map(snapshotOf) }) }),
  }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'doc' ? snapshotOf(target.path) : target.get(),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const variables = createVariableDraftWriter({ firestore: () => firestore })
const functions = createFunctionDraftWriter({ firestore: () => firestore })

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Free: three variables, one function. */
const FREE = { plan: 'free' }
/** Pro: well past what these cases make. */
const PRO = { plan: 'pro' }

const VARIABLE = { name: 'hourly_rate', type: 'number', value: '85' }

/** A function as the AI step's check hands it over: price × hours, with a floor. */
const FUNCTION: HostFunction = {
  name: 'quote',
  parameters: [
    { name: 'hours', type: 'number', required: true, label: 'Hours', defaultValue: '2' },
    {
      name: 'tier',
      type: 'text',
      required: false,
      options: [{ value: 'basic', label: 'Basic' }, { value: 'rush' }],
    },
  ],
  variables: [{ name: 'total', type: 'number' }],
  operations: [
    {
      if: { left: '1', comparator: '==', right: '1' },
      then: [{ set: 'total', expression: 'hours * hourly_rate' }],
      otherwise: [],
    },
    {
      if: { left: 'total', comparator: '<', right: '100' },
      then: [{ set: 'total', expression: '100' }],
      otherwise: [],
    },
  ],
  returnValue: 'total',
}

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: PRO as Record<string, unknown>,
  now: NOW,
  id: 'draft-1',
  name: 'Hourly rate',
  content: VARIABLE as Record<string, unknown>,
  ...patch,
})

const context = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: PRO as Record<string, unknown>,
  now: NOW,
  ...patch,
})

beforeEach(() => {
  store.clear()
  commits = []
  store.set('hosts/host-1', { memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer' } })
})

describe('the variable writer', () => {
  it('writes the document the Variables card creates, under the id asked for', async () => {
    const written = await variables.write(request())
    expect(written).toEqual({
      ok: true,
      replayed: false,
      id: 'draft-1',
      name: 'hourly_rate',
      versionId: null,
      facts: { type: 'number' },
    })
    expect(store.get('hosts/host-1/variables/draft-1')).toEqual({
      name: 'hourly_rate',
      type: 'number',
      value: '85',
      workflowId: '',
      workflowName: '',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    expect(formatVariableValue(store.get('hosts/host-1/variables/draft-1') as never)).toBe('85')
  })

  it('reports what it wrote when asked again under the same id, and writes nothing', async () => {
    await variables.write(request())
    commits = []
    const again = await variables.write(request({ content: { ...VARIABLE, value: '90' } }))
    expect(again).toEqual({
      ok: true,
      replayed: true,
      id: 'draft-1',
      name: 'hourly_rate',
      versionId: null,
      facts: { type: 'number' },
    })
    expect(commits).toEqual([])
    expect(store.get('hosts/host-1/variables/draft-1')).toMatchObject({ value: '85' })
    await expect(variables.read({ hostId: 'host-1', id: 'draft-1' })).resolves.toEqual({
      id: 'draft-1',
      name: 'hourly_rate',
      versionId: null,
      facts: { type: 'number' },
    })
    await expect(variables.read({ hostId: 'host-1', id: 'nope' })).resolves.toBeNull()
  })

  it('refuses a name a live variable carries, in any case, and never overwrites it', async () => {
    store.set('hosts/host-1/variables/v-1', { name: 'Hourly_Rate', type: 'number', value: '70' })
    await expect(variables.write(request())).resolves.toEqual({
      ok: false,
      status: 409,
      error: logicDraftNameTaken('variable', 'hourly_rate'),
    })
    expect(commits).toEqual([])
    expect(store.get('hosts/host-1/variables/v-1')).toMatchObject({ value: '70' })
  })

  it('lets a deleted variable’s name be used again', async () => {
    store.set('hosts/host-1/variables/v-1', { name: 'hourly_rate', type: 'number', value: '70', deletedAt: NOW })
    await expect(variables.write(request())).resolves.toMatchObject({ ok: true, replayed: false })
  })

  it('takes the request’s name only where the content has none', async () => {
    const written = await variables.write(
      request({ name: 'phone', content: { type: 'text', value: '555-0100' } }),
    )
    expect(written).toMatchObject({ ok: true, name: 'phone' })
  })

  it('refuses a member who may not write the site, in the resources route’s words', async () => {
    await expect(variables.refusal(context({ uid: 'uid-2' }))).resolves.toEqual({
      status: 403,
      error: LOGIC_DRAFT_ROLE_REFUSAL,
    })
    await expect(variables.write(request({ uid: 'uid-2' }))).resolves.toEqual({
      ok: false,
      status: 403,
      error: LOGIC_DRAFT_ROLE_REFUSAL,
    })
    expect(commits).toEqual([])
  })

  it('meets the plan’s allowance, counting every variable as the route does', async () => {
    store.set('hosts/host-1/variables/a', { name: 'a', type: 'text', value: '' })
    store.set('hosts/host-1/variables/b', { name: 'b', type: 'text', value: '' })
    // Soft-deleted, and still counted, as `/api/hosts/resources` counts it.
    store.set('hosts/host-1/variables/c', { name: 'c', type: 'text', value: '', deletedAt: NOW })
    const refusal = { status: 403, error: logicDraftLimitRefusal('variable', 3) }
    await expect(variables.refusal(context({ org: FREE }))).resolves.toEqual(refusal)
    await expect(variables.write(request({ org: FREE }))).resolves.toEqual({ ok: false, ...refusal })
    await expect(variables.refusal(context())).resolves.toBeNull()
    expect(logicDraftLimitRefusal('function', 1)).toBe('Your plan includes 1 function — upgrade in Billing for more')
  })

  it('answers an unknown site', async () => {
    await expect(variables.refusal(context({ hostId: 'host-x' }))).resolves.toEqual({ status: 404, error: 'Unknown site' })
    await expect(variables.write(request({ hostId: 'host-x' }))).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Unknown site',
    })
  })

  it('refuses content that is not a variable, before any read', async () => {
    await expect(variables.write(request({ content: { ...VARIABLE, value: 'eighty' } }))).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'A number variable’s value is a number, such as 49 or 0.5',
    })
    expect(commits).toEqual([])
  })
})

describe('the variable check', () => {
  it.each([
    [{ name: 'open', type: 'boolean', value: 'true' }],
    [{ name: 'opens_on', type: 'date', value: '2026-11-01' }],
    [{ name: 'opens_at', type: 'time', value: '09:30' }],
    [{ name: 'plans', type: 'dictionary', value: '{"starter":19,"pro":49}' }],
    [{ name: 'colors', type: 'collection', value: '["red","green"]' }],
    [{ name: 'tagline', type: 'text', value: 'Fresh every morning' }],
  ])('keeps %j as stored', (content) => {
    expect(checkVariableDraftContent(content)).toEqual({ ok: true, facts: { type: content.type } })
  })

  it.each([
    [{ name: '1st', type: 'text', value: '' }, 'The variable name must start with a letter or _, then letters, digits or _; at most 40 characters'],
    [{ name: '', type: 'text', value: '' }, 'The variable needs a name'],
    [{ name: 'x', type: 'money', value: '' }, 'A variable’s type is one of text, number, boolean, date, time, dictionary, collection'],
    [{ name: 'x', type: 'number', value: '' }, 'A number variable’s value is a number, such as 49 or 0.5'],
    [{ name: 'x', type: 'boolean', value: 'yes' }, 'A boolean variable’s value is true or false'],
    [{ name: 'x', type: 'date', value: 'soon' }, 'A date variable’s value is a date, such as 2026-10-01'],
    [{ name: 'x', type: 'time', value: '9.30' }, 'A time variable’s value is HH:MM, such as 09:30'],
    [{ name: 'x', type: 'dictionary', value: '[1]' }, 'A dictionary’s value is a JSON object, such as {"starter":19,"pro":49}'],
    [{ name: 'x', type: 'collection', value: '{}' }, 'A collection’s value is a JSON list, such as ["red","green"]'],
    [{ name: 'x', type: 'text', value: '<script>alert(1)</script>' }, 'The value holds markup'],
    [{ name: 'x', type: 'text', value: 'a'.repeat(2_001) }, 'The value is longer than 2000 characters'],
  ])('refuses %j', (content, problem) => {
    expect(checkVariableDraftContent(content)).toEqual({ ok: false, problems: [problem] })
  })
})

describe('the function writer', () => {
  const fnRequest = (patch: Record<string, unknown> = {}) =>
    request({ name: 'quote', content: FUNCTION as unknown as Record<string, unknown>, ...patch })

  it('writes the definition the Functions card saves, and the evaluator runs it', async () => {
    const written = await functions.write(fnRequest())
    expect(written).toEqual({
      ok: true,
      replayed: false,
      id: 'draft-1',
      name: 'quote',
      versionId: null,
      facts: { parameters: 2, operations: 2, reads: ['hourly_rate'] },
    })
    const stored = store.get('hosts/host-1/functions/draft-1') as Record<string, unknown>
    expect(stored).toEqual({ ...FUNCTION, createdAt: NOW, updatedAt: NOW, createdBy: 'uid-1' })
    const run = evaluateHostFunction(stored as unknown as HostFunction, { hours: 3 }, { globals: { hourly_rate: 85 } })
    expect(run).toMatchObject({ ok: true, value: 255 })
  })

  it('reports what it wrote when asked again, and refuses a taken name', async () => {
    await functions.write(fnRequest())
    commits = []
    await expect(functions.write(fnRequest())).resolves.toMatchObject({ ok: true, replayed: true, name: 'quote' })
    await expect(functions.write(fnRequest({ id: 'draft-2', content: { ...FUNCTION, name: 'QUOTE' } }))).resolves.toEqual({
      ok: false,
      status: 409,
      error: logicDraftNameTaken('function', 'QUOTE'),
    })
    expect(commits).toEqual([])
  })

  it('meets the Free plan’s one function', async () => {
    store.set('hosts/host-1/functions/f-1', { name: 'other' })
    const refusal = { status: 403, error: logicDraftLimitRefusal('function', 1) }
    await expect(functions.refusal(context({ org: FREE }))).resolves.toEqual(refusal)
    await expect(functions.write(fnRequest({ org: FREE }))).resolves.toEqual({ ok: false, ...refusal })
  })
})

describe('the function check', () => {
  const problemsOf = (patch: Record<string, unknown>) => {
    const checked = checkFunctionDraftContent({ ...FUNCTION, ...patch })
    return checked.ok === false ? checked.problems : []
  }

  it('keeps a definition the evaluator can run, reporting the site variables it reads', () => {
    expect(checkFunctionDraftContent(FUNCTION as never)).toEqual({
      ok: true,
      facts: { parameters: 2, operations: 2, reads: ['hourly_rate'] },
    })
  })

  it('refuses a name a binding cannot read', () => {
    expect(problemsOf({ name: 'Quote calculator' })).toEqual([
      'The function name must start with a letter or _, then letters, digits or _; at most 40 characters',
    ])
  })

  it('refuses an expression the evaluator cannot parse', () => {
    const problems = problemsOf({
      operations: [{ if: { left: '1', comparator: '==', right: '1' }, then: [{ set: 'total', expression: 'hours *' }], otherwise: [] }],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^Operation 1 \(then\), assignment 1 cannot be read: /)
  })

  it('refuses an assignment to anything but its own names, and a return value it does not own', () => {
    expect(
      problemsOf({
        operations: [{ if: { left: '1', comparator: '==', right: '1' }, then: [{ set: 'hourly_rate', expression: '1' }], otherwise: [] }],
        returnValue: 'nothing',
      }),
    ).toEqual([
      "Operation 1 (then), assignment 1 sets hourly_rate, which is not one of the function's parameters or locals",
      'The return value names one of the function’s own parameters or locals',
    ])
  })

  it('refuses a repeated name, a bad comparator, and a function with no operations', () => {
    expect(problemsOf({ variables: [{ name: 'total', type: 'number' }, { name: 'hours', type: 'number' }] })).toEqual([
      'The name hours is used twice; each parameter and local needs its own',
    ])
    expect(
      problemsOf({ operations: [{ if: { left: '1', comparator: '=>', right: '1' }, then: [], otherwise: [] }] }),
    ).toEqual(['Operation 1\'s condition compares with one of == != < <= > >='])
    expect(problemsOf({ operations: [] })).toEqual(['A function has between 1 and 1000 operations'])
  })

  it('refuses markup in what a visitor reads', () => {
    expect(
      problemsOf({ parameters: [{ name: 'hours', type: 'number', label: '<script>x</script>' }, FUNCTION.parameters[1]] }),
    ).toEqual(["Parameter 1's label holds markup"])
  })
})
