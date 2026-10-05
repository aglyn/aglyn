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

/*==========================================
 * THE CRM'S TRANSFER RESOURCES, REGISTERED LIGHT (AGL-3527).
 *
 * The server half of every resource `plugins.config.json` declares for the
 * CRM, registered at the console's boot from its console-server
 * declarations. Boot pays for the match keys and the header dictionaries —
 * data — and nothing else: each hook loads its resource's module with the
 * first transfer that asks, and keeps it; the plan gate loads the CRM's
 * `suite-gate.ts` the same way.
 *=========================================*/

import type {
  PluginTransferResource,
  TransferLookupTargetHooks,
  TransferPlanGateHooks,
  TransferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { registerPluginTransferResource } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import type { MatchKeySpec, TransferAliasDictionary } from '@aglyn/aglyn/data-transfer'
import { COMPANY_ALIASES, CONTACT_ALIASES, DEAL_ALIASES, LEAD_ALIASES, TASK_ALIASES } from './aliases'
import {
  CRM_ACTIVITIES_RESOURCE,
  CRM_COMPANIES_RESOURCE,
  CRM_CONTACTS_RESOURCE,
  CRM_DEALS_RESOURCE,
  CRM_FIELDS_RESOURCE,
  CRM_LEADS_RESOURCE,
  CRM_MEMBERS_TARGET,
  CRM_PIPELINES_RESOURCE,
  CRM_TASKS_RESOURCE,
} from './fields'

/** What a resource is registered with before its module loads. */
interface LazyResource {
  key: string
  /** What the records are called inside a refusal's sentence ("Exporting companies"). */
  noun: string
  matchKeys: readonly MatchKeySpec[]
  aliases?: readonly TransferAliasDictionary[]
  /** Lookup targets the resource answers itself, by key. */
  targets?: readonly string[]
  /** The hooks its module answers, beyond the required reads; every one by default. */
  hooks?: readonly (typeof HOOKS)[number][]
  load: () => Promise<Partial<TransferRecordsHooks>>
}

/** The hooks an exported-only resource answers: its reads. */
const EXPORT_HOOKS = ['fields', 'count', 'readPage', 'lookup'] as const

/** The member target's keys, known before the module loads. */
const MEMBER_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'email', normalizer: 'email' },
  { fieldId: 'name', normalizer: 'caseless' },
]

/** Every hook a records resource may answer with, besides its data. */
const HOOKS = [
  'fields',
  'count',
  'readPage',
  'lookup',
  'suggest',
  'picklists',
  'addPicklistValues',
  'plan',
  'lockedRules',
  'apply',
  'revert',
] as const

/**
 * The CRM's plan question for a transfer (AGL-3555), in the words of every
 * other CRM route: `suite-gate.ts`'s refusal, 403 `plan_required` / `crm`.
 * The declaration (`featureFlag: "crm"`) decides which intents ask — every
 * one, but the contacts and leads exports — and this answers them.
 */
export function crmTransferPlanGate(noun: string): NonNullable<TransferPlanGateHooks['planGate']> {
  return async (subject, intent) =>
    (await import('../server/suite-gate')).crmSuiteRefusal(
      subject.org,
      `${intent === 'export' ? 'Exporting' : 'Importing'} ${noun}`,
    )
}

/** A resource whose hooks load its module with the first call, once. */
export function lazyCrmTransferResource(resource: LazyResource): PluginTransferResource {
  let loaded: Promise<Partial<TransferRecordsHooks>> | null = null
  const hooks = () => (loaded ??= resource.load())
  const impl: Record<string, unknown> = {
    matchKeys: resource.matchKeys,
    planGate: crmTransferPlanGate(resource.noun),
    ...(resource.aliases ? { aliases: resource.aliases } : {}),
  }
  for (const name of resource.hooks ?? HOOKS) {
    impl[name] = async (...args: unknown[]) => {
      const hook = (await hooks())[name] as ((...args: unknown[]) => unknown) | undefined
      if (!hook) throw new Error(`transfer resource "${resource.key}" has no "${name}"`)
      return hook(...args)
    }
  }
  if (resource.targets?.length) {
    impl['lookupTargets'] = Object.fromEntries(
      resource.targets.map((target): [string, TransferLookupTargetHooks] => {
        const own = async () => {
          const found = (await hooks()).lookupTargets?.[target]
          if (!found) throw new Error(`transfer resource "${resource.key}" answers no "${target}"`)
          return found
        }
        return [
          target,
          {
            matchKeys: MEMBER_KEYS,
            lookup: async (ctx, requests) => (await own()).lookup(ctx, requests),
            suggest: async (ctx, request) => (await (await own()).suggest?.(ctx, request)) ?? {},
          },
        ]
      }),
    )
  }
  return impl as PluginTransferResource
}

/** The CRM's resources: what each is found by, how other products name its columns, and where it loads from. */
export const CRM_TRANSFER_RESOURCES: readonly LazyResource[] = [
  {
    key: CRM_CONTACTS_RESOURCE,
    noun: 'contacts',
    matchKeys: [
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'email', normalizer: 'email' },
    ],
    aliases: CONTACT_ALIASES,
    targets: [CRM_MEMBERS_TARGET],
    load: async () => (await import('./contacts')).contactsTransferResource(),
  },
  {
    key: CRM_COMPANIES_RESOURCE,
    noun: 'companies',
    matchKeys: [
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'domain', normalizer: 'domain' },
      { fieldId: 'name', normalizer: 'caseless' },
    ],
    aliases: COMPANY_ALIASES,
    targets: [CRM_MEMBERS_TARGET],
    load: async () => (await import('./companies')).companiesTransferResource(),
  },
  {
    key: CRM_LEADS_RESOURCE,
    noun: 'leads',
    matchKeys: [
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'email', normalizer: 'email' },
    ],
    aliases: LEAD_ALIASES,
    targets: [CRM_MEMBERS_TARGET],
    hooks: ['fields', 'count', 'readPage', 'lookup', 'picklists', 'addPicklistValues', 'plan', 'lockedRules', 'apply', 'revert'],
    load: async () => (await import('./leads')).leadsTransferResource(),
  },
  {
    key: CRM_DEALS_RESOURCE,
    noun: 'deals',
    matchKeys: [
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'externalId', normalizer: 'externalId' },
    ],
    aliases: DEAL_ALIASES,
    targets: [CRM_MEMBERS_TARGET],
    load: async () => (await import('./deals')).dealsTransferResource(),
  },
  {
    key: CRM_TASKS_RESOURCE,
    noun: 'tasks',
    matchKeys: [
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'externalId', normalizer: 'externalId' },
    ],
    aliases: TASK_ALIASES,
    targets: [CRM_MEMBERS_TARGET],
    hooks: ['fields', 'count', 'readPage', 'lookup', 'picklists', 'addPicklistValues', 'plan', 'lockedRules', 'apply', 'revert'],
    load: async () => (await import('./tasks')).tasksTransferResource(),
  },
  {
    key: CRM_ACTIVITIES_RESOURCE,
    noun: 'activities',
    matchKeys: [{ fieldId: 'id', normalizer: 'aglynId' }],
    hooks: EXPORT_HOOKS,
    load: async () => (await import('./activities')).activitiesTransferResource(),
  },
  {
    key: CRM_PIPELINES_RESOURCE,
    noun: 'pipelines and stages',
    matchKeys: [{ fieldId: 'id', normalizer: 'aglynId' }],
    hooks: EXPORT_HOOKS,
    load: async () => (await import('./pipelines')).pipelinesTransferResource(),
  },
  {
    key: CRM_FIELDS_RESOURCE,
    noun: 'custom fields',
    matchKeys: [{ fieldId: 'id', normalizer: 'aglynId' }],
    hooks: EXPORT_HOOKS,
    load: async () => (await import('./pipelines')).fieldDefinitionsTransferResource(),
  },
]

/** Registers the server half of every CRM transfer resource. Registering again replaces them. */
export function registerCrmTransferResources(pluginId: string): void {
  for (const resource of CRM_TRANSFER_RESOURCES) {
    registerPluginTransferResource(resource.key, lazyCrmTransferResource(resource), { pluginId })
  }
}
