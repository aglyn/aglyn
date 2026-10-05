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

// The registry's own module, not the `@aglyn/aglyn/server` barrel: boot needs
// one registry, not the whole server surface.
import {
  registerPluginTransferResource,
  type PluginTransferResource,
  type TransferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { BUNDLE_ID } from './constants/bundle-common'
import {
  REDIRECTS_ALIAS_DICTIONARIES,
  REDIRECTS_DEFAULT_POLICY,
  REDIRECTS_MATCH_KEYS,
  REDIRECTS_TRANSFER_KEY,
  redirectValuesEqual,
  redirectsTransferCatalog,
} from './transfer/redirects-transfer-fields'

/** The resource that reads and writes, loaded with the first import or export. */
async function load(): Promise<TransferRecordsHooks> {
  return (await import('./transfer/redirects-transfer-console')).redirectsTransferResource() as TransferRecordsHooks
}

/**
 * The redirects plugin's CONSOLE-ONLY server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime registers none of it.
 *
 * The `redirects` transfer resource: a site's redirect rules, imported and
 * exported through the data-transfer jobs, written through the same checks
 * as the redirects page and the create route (`transfer/redirects-transfer.ts`).
 * The catalog, the match keys, the alias dictionaries, the starting policy
 * and the value comparator are answered from here; every hook that reads or writes loads the Admin SDK with its first
 * call, so boot pays for none of it.
 */
export function registerRedirectsConsoleServerDeclarations(): void {
  const resource: PluginTransferResource = {
    fields: () => redirectsTransferCatalog(),
    matchKeys: REDIRECTS_MATCH_KEYS,
    aliases: REDIRECTS_ALIAS_DICTIONARIES,
    // A rule already on the site takes the file's values unless the person
    // chooses otherwise; the review compares values as the page stores them.
    defaultPolicy: REDIRECTS_DEFAULT_POLICY,
    valuesEqual: redirectValuesEqual,
    match: async (ctx, input) => {
      const hooks = await load()
      if (!hooks.match) throw new Error('The redirects resource has no matching.')
      return hooks.match(ctx, input)
    },
    count: async (ctx, options) => (await load()).count?.(ctx, options) ?? 0,
    readPage: async (ctx, cursor, fieldIds, options) => (await load()).readPage(ctx, cursor, fieldIds, options),
    lookup: async (ctx, requests) => (await load()).lookup(ctx, requests),
    plan: async (ctx, input) => {
      const hooks = await load()
      if (!hooks.plan) throw new Error('The redirects resource has no plan.')
      return hooks.plan(ctx, input)
    },
    apply: async (ctx, chunk, writer) => (await load()).apply(ctx, chunk, writer),
    revert: async (ctx, snapshot, decisions) => (await load()).revert(ctx, snapshot, decisions),
  }
  registerPluginTransferResource(REDIRECTS_TRANSFER_KEY, resource, { pluginId: BUNDLE_ID })
}
