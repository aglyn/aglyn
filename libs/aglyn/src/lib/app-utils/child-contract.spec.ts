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

import { FEATURE_FLAG, LinealDirectiveFlag } from '../foundation'
import { auditComposeChildSurvival } from './child-contract-compose'
import {
  auditChildContract,
  type ChildContractEntry,
  listAcceptingComponentIds,
  schemaAcceptsChildren,
} from './child-contract'
import { REUSABLE_INSTANCE_COMPONENT_ID } from './compose-reusable-components'

const entry = (schema: ChildContractEntry['schema']): ChildContractEntry => ({
  schema,
})

describe('schemaAcceptsChildren (AGL-1389)', () => {
  it('accepts children by default — which is the whole problem', () => {
    // A component that declares nothing is a container as far as every
    // editor entry point is concerned. That default is why the audit below
    // has to exist: "nobody thought about it" and "it renders children" are
    // the same schema.
    expect(schemaAcceptsChildren({ $id: 'plain' })).toBe(true)
    expect(schemaAcceptsChildren(undefined)).toBe(true)
  })

  it.each([
    ['selfClosing', { selfClosing: FEATURE_FLAG.ENABLED }],
    ['textEditable', { textEditable: FEATURE_FLAG.ENABLED }],
    ['dropping DISABLED', { dropping: FEATURE_FLAG.DISABLED }],
  ])('refuses children when the schema declares %s', (_label, flags) => {
    expect(schemaAcceptsChildren({ $id: 'leaf', flags })).toBe(false)
  })

  it('refuses children on an empty restrictChildren allowlist', () => {
    // The Layout Slot's spelling. `confirmValidLinealRelationship` already
    // refuses every candidate against an empty allowlist, so the hierarchy
    // agreeing is the fix for a divergence, not a new restriction.
    expect(
      schemaAcceptsChildren({
        $id: 'slot',
        restrictChildren: [LinealDirectiveFlag.LIMIT_TO, { components: [] }],
      }),
    ).toBe(false)
    expect(
      schemaAcceptsChildren({
        $id: 'slot-bare',
        restrictChildren: [LinealDirectiveFlag.LIMIT_TO, []],
      }),
    ).toBe(false)
  })

  it('keeps accepting children on a restriction that still admits something', () => {
    // An empty DISALLOW list forbids nothing, and an allowlist naming
    // plugins still admits every component in them — reading either as "no
    // child slot" would take the drop away from a working container.
    expect(
      schemaAcceptsChildren({
        $id: 'tabs',
        restrictChildren: [LinealDirectiveFlag.DISALLOW, { components: [] }],
      }),
    ).toBe(true)
    expect(
      schemaAcceptsChildren({
        $id: 'byPlugin',
        restrictChildren: [
          LinealDirectiveFlag.LIMIT_TO,
          { plugins: ['mui'], components: [] },
        ],
      }),
    ).toBe(true)
    expect(
      schemaAcceptsChildren({
        $id: 'named',
        restrictChildren: [LinealDirectiveFlag.LIMIT_TO, { components: ['x'] }],
      }),
    ).toBe(true)
  })
})

describe('auditChildContract (AGL-1389)', () => {
  it('passes when every accepting component is declared', () => {
    const bundle = [
      entry({ $id: 'box' }),
      entry({ $id: 'icon', flags: { selfClosing: FEATURE_FLAG.ENABLED } }),
    ]
    expect(auditChildContract(bundle, ['box'])).toEqual([])
    expect(listAcceptingComponentIds(bundle)).toEqual(['box'])
  })

  it('reports a component that became a container without saying so', () => {
    // The AGL-1388 shape arriving again: someone adds a component, never
    // thinks about `children`, and the editor starts accepting drops that
    // the renderer throws away.
    const problems = auditChildContract([entry({ $id: 'newThing' })], [])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('newThing accepts a drop')
    expect(problems[0]).toContain('flags.dropping')
  })

  it('reports a declared container that has since been closed', () => {
    const problems = auditChildContract(
      [entry({ $id: 'wasBox', flags: { dropping: FEATURE_FLAG.DISABLED } })],
      ['wasBox'],
    )
    expect(problems).toEqual([expect.stringContaining('declared container')])
  })

  it('reports a declared id that is no longer registered', () => {
    // Left alone the list decays into a wish, and a guard checked against a
    // wish passes over anything.
    expect(auditChildContract([], ['ghost'])).toEqual([
      expect.stringContaining('not registered in this bundle'),
    ])
  })

  it('reports a schema with no $id at all', () => {
    expect(
      auditChildContract([entry({ displayName: 'Nameless' })], []),
    ).toEqual([expect.stringContaining('has no $id')])
  })
})

describe('auditComposeChildSurvival (AGL-1389)', () => {
  it('passes for an ordinary container', () => {
    expect(auditComposeChildSurvival(['muiStack'])).toEqual([])
  })

  it('catches the compose pass that REPLACES a child list', () => {
    // `reusableInstance` renders `{children}` — inspecting the component
    // would clear it — and `composeReusableComponentNodes` still throws the
    // dropped node away by replacing the instance's child list with the
    // grafted definition. It is `dropping: DISABLED` in the real bundle and
    // so is never probed; asked directly, the probe must see the loss.
    const problems = auditComposeChildSurvival([
      REUSABLE_INSTANCE_COMPONENT_ID,
    ])
    expect(problems).toEqual([
      expect.stringContaining('composeReusableComponentNodes'),
    ])
  })
})
