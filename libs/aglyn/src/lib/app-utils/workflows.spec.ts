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

import type { HostFunction } from './functions'
import {
  resolveComputedVariables,
  runWorkflow,
} from './workflows'

const sum: HostFunction = {
  name: 'Sum',
  parameters: [
    { name: 'P1', type: 'number', required: true },
    { name: 'P2', type: 'number', required: true },
  ],
  variables: [{ name: 'P3', type: 'number' }],
  operations: [
    {
      if: { left: 'P1', comparator: '<=', right: 'P2' },
      then: [{ set: 'P3', expression: 'P1 + P2' }],
      otherwise: [{ set: 'P3', expression: 'P1 - P2' }],
    },
  ],
  returnValue: 'P3',
}

const double: HostFunction = {
  name: 'Double',
  parameters: [{ name: 'X', type: 'number', required: true }],
  variables: [{ name: 'Y', type: 'number' }],
  operations: [
    {
      if: { left: '1', comparator: '==', right: '1' },
      then: [{ set: 'Y', expression: 'X * 2' }],
      otherwise: [],
    },
  ],
  returnValue: 'Y',
}

const functions = { Sum: sum, Double: double }

describe('runWorkflow', () => {
  it('pipes step results and variables through subsequent steps', () => {
    const result = runWorkflow(
      {
        name: 'Total',
        steps: [
          { functionName: 'Sum', args: ['base', '7'], resultName: 'total' },
          { functionName: 'Double', args: ['total'] },
        ],
        returnValue: 'step2',
      },
      functions,
      { base: { name: 'base', type: 'number', value: '3' } },
    )
    expect(result).toMatchObject({ ok: true, value: 20 })
    expect((result as any).results).toEqual({ total: 10, step2: 20 })
  })

  it('defaults the return to the last step result', () => {
    const result = runWorkflow(
      { name: 'w', steps: [{ functionName: 'Double', args: ['4'] }] },
      functions,
    )
    expect(result).toMatchObject({ ok: true, value: 8 })
  })

  it('fails safely with the failing step index', () => {
    expect(
      runWorkflow(
        { name: 'w', steps: [{ functionName: 'Nope', args: [] }] },
        functions,
      ),
    ).toMatchObject({ ok: false, step: 1 })
    expect(
      runWorkflow(
        {
          name: 'w',
          steps: [{ functionName: 'Double', args: ['unknown_ref'] }],
        },
        functions,
      ),
    ).toMatchObject({ ok: false, step: 1 })
  })

  it('seeds event payload extraScope ahead of the steps (AGL-128)', () => {
    const result = runWorkflow(
      {
        name: 'OnEvent',
        steps: [{ functionName: 'Double', args: ['visits'] }],
      },
      functions,
      {},
      { visits: 21 },
    )
    expect(result).toMatchObject({ ok: true, value: 42 })
  })

  it('lets function operations invoke workflows with a depth guard (AGL-129)', () => {
    const caller: any = {
      name: 'Caller',
      parameters: [{ name: 'X', type: 'number', required: true }],
      variables: [{ name: 'Y', type: 'number' }],
      operations: [
        {
          if: { left: '1', comparator: '==', right: '1' },
          then: [{ set: 'Y', expression: '', workflow: 'Inner' }],
          otherwise: [],
        },
      ],
      returnValue: 'Y',
    }
    const inner = {
      name: 'Inner',
      steps: [{ functionName: 'Double', args: ['X'] }],
    }
    const outer = {
      name: 'Outer',
      steps: [{ functionName: 'Caller', args: ['5'] }],
    }
    const allFunctions = { ...functions, Caller: caller }
    const workflows = { Inner: inner, Outer: outer }
    const result = runWorkflow(outer, allFunctions, {}, {}, { workflows })
    expect(result).toMatchObject({ ok: true, value: 10 })

    // Self-recursive workflow terminates at the depth cap.
    const loopFn: any = {
      ...caller,
      name: 'LoopFn',
      operations: [
        {
          if: { left: '1', comparator: '==', right: '1' },
          then: [{ set: 'Y', expression: '', workflow: 'Loop' }],
          otherwise: [],
        },
      ],
    }
    const loop = { name: 'Loop', steps: [{ functionName: 'LoopFn', args: ['1'] }] }
    const looped = runWorkflow(
      loop,
      { ...allFunctions, LoopFn: loopFn },
      {},
      {},
      { workflows: { Loop: loop } },
    )
    expect(looped.ok).toBe(false)
  })

  it('resolves computed variables from workflows with fallback (AGL-129)', () => {
    const wf = { name: 'Answer', steps: [{ functionName: 'Double', args: ['21'] }] }
    const variables: any = {
      answer: {
        name: 'answer',
        type: 'number',
        value: '0',
        workflowName: 'Answer',
      },
      missing: {
        name: 'missing',
        type: 'number',
        value: '7',
        workflowName: 'Nope',
      },
    }
    const resolved = resolveComputedVariables(variables, functions, {
      Answer: wf,
    })
    expect(resolved['answer'].value).toBe('42')
    expect(resolved['missing'].value).toBe('7')
  })
})
