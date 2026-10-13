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

import { pluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  lazyCrmFieldSetupWriter,
  lazyCrmPicklistValuesSetupWriter,
  lazyCrmPipelineSetupWriter,
  registerCrmConsoleServerDeclarations,
} from './declarations.console-server'
import { CRM_PICKLIST_VALUES_SETUP_RESOURCE } from './model/crm-picklist-setup-content'
import { CRM_FIELD_SETUP_RESOURCE, CRM_PIPELINE_SETUP_RESOURCE } from './model/crm-setup-content'

beforeEach(() => resetPluginServicesForTests())

describe('the CRM’s console-server declarations (AGL-3746)', () => {
  it('register the setup writers and the build operations they execute', () => {
    registerCrmConsoleServerDeclarations()
    expect(pluginResourceDraftWriter(CRM_PIPELINE_SETUP_RESOURCE)).toEqual({ pluginId: 'crm', writer: lazyCrmPipelineSetupWriter })
    expect(pluginResourceDraftWriter(CRM_FIELD_SETUP_RESOURCE)).toEqual({ pluginId: 'crm', writer: lazyCrmFieldSetupWriter })
    expect(pluginAiCapability('crm-pipeline')?.pluginId).toBe('crm')
    expect(pluginAiCapability('crm-field')?.pluginId).toBe('crm')
    // AGL-3756: values added to a picklist or a Choice field.
    expect(pluginResourceDraftWriter(CRM_PICKLIST_VALUES_SETUP_RESOURCE)).toEqual({
      pluginId: 'crm',
      writer: lazyCrmPicklistValuesSetupWriter,
    })
    expect(pluginAiCapability('crm-picklist-values')?.pluginId).toBe('crm')
    expect(() => registerCrmConsoleServerDeclarations()).not.toThrow()
  })

  it('check content at boot without loading the Admin SDK half', () => {
    expect(lazyCrmPipelineSetupWriter.check({ name: 'Agency', stages: ['Won'] }, { hostId: 'h1' })).toEqual({
      ok: true,
      facts: { name: 'Agency', stages: [] },
    })
    expect(lazyCrmFieldSetupWriter.check({ object: 'deal', label: 'Budget', type: 'money' }, { hostId: 'h1' }).ok).toBe(false)
    expect(lazyCrmPicklistValuesSetupWriter.check({ list: 'opportunityType', values: ['Renewal'] }, { hostId: 'h1' })).toEqual({
      ok: true,
      facts: { list: 'opportunityType', values: ['Renewal'] },
    })
  })
})
