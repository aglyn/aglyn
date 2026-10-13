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

import { CONTACT_FIELD_TYPES } from '@aglyn/aglyn/app-utils/contact-custom-fields'
import { CRM_FIELD_OBJECTS } from '@aglyn/aglyn/app-utils/crm'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
  type PluginAiCapabilityArgs,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  checkCrmFieldSetup,
  checkCrmPipelineSetup,
  CRM_FIELD_SETUP_RESOURCE,
  CRM_PIPELINE_SETUP_RESOURCE,
} from '../model/crm-setup-content'
import {
  checkCrmPicklistValuesSetup,
  CRM_PICKLIST_VALUES_LISTS,
  CRM_PICKLIST_VALUES_SETUP_RESOURCE,
} from '../model/crm-picklist-setup-content'
import {
  CRM_FIELD_AI_OP,
  CRM_PICKLIST_VALUES_AI_OP,
  CRM_PIPELINE_AI_OP,
  crmFieldAiCapability,
  crmPicklistValuesAiCapability,
  crmPipelineAiCapability,
  registerCrmSetupAiCapabilities,
} from './crm-setup-ai-capabilities'

const context = { hostId: 'h1', dependencies: {} }

beforeEach(() => resetPluginServicesForTests())

describe('the CRM setup build operations (AGL-3746)', () => {
  it('are well-formed and registered by the CRM, saved live by its writers, at no credit', () => {
    registerCrmSetupAiCapabilities()
    for (const [op, capability, resource] of [
      [CRM_PIPELINE_AI_OP, crmPipelineAiCapability, CRM_PIPELINE_SETUP_RESOURCE],
      [CRM_FIELD_AI_OP, crmFieldAiCapability, CRM_FIELD_SETUP_RESOURCE],
      [CRM_PICKLIST_VALUES_AI_OP, crmPicklistValuesAiCapability, CRM_PICKLIST_VALUES_SETUP_RESOURCE],
    ] as const) {
      expect(pluginAiCapabilityProblem(capability)).toBeNull()
      expect(pluginAiCapability(op)).toEqual({ pluginId: 'crm', capability })
      expect(capability).toMatchObject({ draftResource: resource, live: true, feature: 'crm', freeAllowed: false })
      expect(capability.estimateCredits({})).toBe(0)
      expect(capability.pageBlocks).toBeUndefined()
    }
    // Registering again replaces its own.
    expect(() => registerCrmSetupAiCapabilities()).not.toThrow()
  })

  it('offers only the objects and field types the CRM has', () => {
    expect(crmFieldAiCapability.argsSchema.properties['object'].enum).toEqual(CRM_FIELD_OBJECTS)
    expect(crmFieldAiCapability.argsSchema.properties['type'].enum).toEqual(CONTACT_FIELD_TYPES)
  })

  it('turns the typical asks into content its writers accept', () => {
    const agency = {
      name: 'Agency sales',
      stages: ['Discovery', 'Proposal', 'Negotiation'],
      wonStage: 'Won',
      lostStage: 'Lost',
    }
    expect(pluginAiCapabilityArgsProblems(crmPipelineAiCapability.argsSchema, agency)).toEqual([])
    const pipeline = crmPipelineAiCapability.draftContent?.({ name: 'p', args: agency }, context) ?? {}
    expect(checkCrmPipelineSetup(pipeline)).toEqual({
      ok: true,
      facts: { name: 'Agency sales', stages: ['Discovery', 'Proposal', 'Negotiation'] },
    })

    const budget = { object: 'deal', label: 'Budget', type: 'number' }
    expect(pluginAiCapabilityArgsProblems(crmFieldAiCapability.argsSchema, budget)).toEqual([])
    const field = crmFieldAiCapability.draftContent?.({ name: 'f', args: budget }, context) ?? {}
    expect(checkCrmFieldSetup(field)).toEqual({ ok: true, facts: { object: 'deal', key: 'budget', type: 'number' } })
  })

  it('holds the planner to the schema: no invented type or object', () => {
    expect(pluginAiCapabilityArgsProblems(crmFieldAiCapability.argsSchema, { object: 'opportunity', label: 'Budget', type: 'money' })).toEqual([
      `"object" must be one of ${CRM_FIELD_OBJECTS.join(', ')}`,
      `"type" must be one of ${CONTACT_FIELD_TYPES.join(', ')}`,
    ])
  })
})

describe('the picklist values build operation (AGL-3756)', () => {
  it('offers every list the Fields page extends, and a custom Choice field', () => {
    expect(crmPicklistValuesAiCapability.argsSchema.properties['list'].enum).toEqual(CRM_PICKLIST_VALUES_LISTS)
    expect(CRM_PICKLIST_VALUES_LISTS).toEqual(expect.arrayContaining(['leadStatus', 'leadSource', 'opportunityType', 'custom']))
  })

  it('turns the typical asks into content its writer accepts', () => {
    const asks: Array<[PluginAiCapabilityArgs, Record<string, unknown>]> = [
      [{ list: 'leadStatus', values: ['Contacted'], meaning: 'working' }, { list: 'leadStatus', values: ['Contacted'] }],
      [{ list: 'leadSource', values: ['Podcast'], group: 'inbound' }, { list: 'leadSource', values: ['Podcast'] }],
      [{ list: 'opportunityType', values: ['Renewal'] }, { list: 'opportunityType', values: ['Renewal'] }],
      [
        { list: 'custom', object: 'company', field: 'Tier', values: ['Platinum'] },
        { list: 'custom', object: 'company', field: 'Tier', values: ['Platinum'] },
      ],
    ]
    for (const [args, facts] of asks) {
      expect(pluginAiCapabilityArgsProblems(crmPicklistValuesAiCapability.argsSchema, args)).toEqual([])
      const content = crmPicklistValuesAiCapability.draftContent?.({ name: 'v', args }, context) ?? {}
      expect(checkCrmPicklistValuesSetup(content)).toEqual({ ok: true, facts })
    }
  })

  it('holds the planner to the schema: no invented list or group', () => {
    expect(pluginAiCapabilityArgsProblems(crmPicklistValuesAiCapability.argsSchema, { list: 'dealStage', values: ['x'], group: 'sideways' })).toEqual([
      `"list" must be one of ${CRM_PICKLIST_VALUES_LISTS.join(', ')}`,
      '"group" must be one of inbound, outbound',
    ])
  })
})
