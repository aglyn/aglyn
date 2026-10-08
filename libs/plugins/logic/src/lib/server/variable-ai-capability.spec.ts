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
 * The `variable` AI capability (AGL-3616): it registers under its op, owned
 * by logic, points at this plugin's writer, costs nothing, and its arguments
 * are content the writer accepts.
 */

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { checkVariableDraftContent, VARIABLE_DRAFT_RESOURCE } from './logic-draft-content'
import { registerVariableAiCapability, VARIABLE_AI_OP, variableAiCapability } from './variable-ai-capability'

const ARGS = { name: 'hourly_rate', type: 'number', value: '85' }

const contentOf = (args: Record<string, unknown>) =>
  variableAiCapability.draftContent?.({ name: 'hourly rate', args: args as never }, { hostId: 'host-1', dependencies: {} }) ??
  {}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the variable capability', () => {
  it('is well-formed, and registers under its op owned by logic, written by its writer', () => {
    expect(pluginAiCapabilityProblem(variableAiCapability)).toBeNull()
    registerVariableAiCapability()
    registerVariableAiCapability()
    expect(pluginAiCapability(VARIABLE_AI_OP)).toEqual({ pluginId: 'logic', capability: variableAiCapability })
    expect(variableAiCapability).toMatchObject({
      draftResource: VARIABLE_DRAFT_RESOURCE,
      quota: 'variablesPerHost',
      freeAllowed: true,
      degrade: 'omit',
    })
    expect(variableAiCapability.feature).toBeUndefined()
    expect(variableAiCapability.runnerKind).toBeUndefined()
    expect(variableAiCapability.estimateCredits(ARGS)).toBe(0)
  })

  it('turns arguments the schema admits into a variable the writer accepts', () => {
    expect(pluginAiCapabilityArgsProblems(variableAiCapability.argsSchema, ARGS)).toEqual([])
    expect(contentOf(ARGS)).toEqual(ARGS)
    expect(checkVariableDraftContent(contentOf(ARGS))).toEqual({ ok: true, facts: { type: 'number' } })
  })

  it('offers every type the writer stores, and requires all three arguments', () => {
    expect(pluginAiCapabilityArgsProblems(variableAiCapability.argsSchema, { name: 'x' })).toEqual([
      '"type" is required',
      '"value" is required',
    ])
    for (const type of variableAiCapability.argsSchema.properties['type'].enum ?? []) {
      const value = { number: '1', boolean: 'true', date: '2026-10-01', time: '09:30', dictionary: '{}', collection: '[]' }[
        type as string
      ] ?? 'text'
      expect(checkVariableDraftContent({ name: 'x', type, value })).toMatchObject({ ok: true })
    }
  })

  it('hands a value its type cannot hold on for the writer to refuse by name', () => {
    expect(checkVariableDraftContent(contentOf({ ...ARGS, value: 'eighty-five' }))).toEqual({
      ok: false,
      problems: ['A number variable’s value is a number, such as 49 or 0.5'],
    })
  })
})
