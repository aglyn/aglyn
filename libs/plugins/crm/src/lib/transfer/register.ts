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
 * first transfer that asks, and keeps it.
 *=========================================*/

import type {
  PluginTransferResource,
  TransferLookupTargetHooks,
  TransferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { registerPluginTransferResource } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import type { MatchKeySpec, TransferAliasDictionary } from '@aglyn/aglyn/data-transfer'
import { COMPANY_ALIASES, CONTACT_ALIASES } from './aliases'
import { CRM_COMPANIES_RESOURCE, CRM_CONTACTS_RESOURCE, CRM_MEMBERS_TARGET } from './fields'

/** What a resource is registered with before its module loads. */
interface LazyResource {
  key: string
  matchKeys: readonly MatchKeySpec[]
  aliases?: readonly TransferAliasDictionary[]
  /** Lookup targets the resource answers itself, by key. */
  targets?: readonly string[]
  load: () => Promise<TransferRecordsHooks>
}

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

/** A resource whose hooks load its module with the first call, once. */
export function lazyCrmTransferResource(resource: LazyResource): PluginTransferResource {
  let loaded: Promise<TransferRecordsHooks> | null = null
  const hooks = () => (loaded ??= resource.load())
  const impl: Record<string, unknown> = {
    matchKeys: resource.matchKeys,
    ...(resource.aliases ? { aliases: resource.aliases } : {}),
  }
  for (const name of HOOKS) {
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
    matchKeys: [
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'domain', normalizer: 'domain' },
      { fieldId: 'name', normalizer: 'caseless' },
    ],
    aliases: COMPANY_ALIASES,
    targets: [CRM_MEMBERS_TARGET],
    load: async () => (await import('./companies')).companiesTransferResource(),
  },
]

/** Registers the server half of every CRM transfer resource. Registering again replaces them. */
export function registerCrmTransferResources(pluginId: string): void {
  for (const resource of CRM_TRANSFER_RESOURCES) {
    registerPluginTransferResource(resource.key, lazyCrmTransferResource(resource), { pluginId })
  }
}
