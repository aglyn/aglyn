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
import { registerPluginEmailStreams } from '@aglyn/aglyn/plugin-manager/plugin-email-streams'
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import {
  registerPluginTransferResource,
  type TransferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { BUNDLE_ID } from './constants/bundle-common'
import {
  LIST_MEMBER_ALIASES,
  LIST_MEMBER_LOCKED_RULES,
  LIST_MEMBER_MATCH_KEYS,
  LIST_MEMBERS_RESOURCE,
  listMemberCatalog,
  SUPPRESSION_ALIASES,
  SUPPRESSION_LOCKED_RULES,
  SUPPRESSION_MATCH_KEYS,
  SUPPRESSIONS_RESOURCE,
  suppressionCatalog,
} from './transfer/email-transfer-catalog'

/**
 * A resource's reads and writes, loaded the first time a transfer asks: the
 * catalog, the keys and the rules are this light module's, and the hooks
 * that touch Firestore are imported on first use.
 */
function lazyTransferHooks(
  load: () => Promise<TransferRecordsHooks>,
): Pick<TransferRecordsHooks, 'count' | 'readPage' | 'lookup' | 'apply' | 'revert'> {
  return {
    count: async (ctx, options) => ((await load()).count?.(ctx, options) ?? 0),
    readPage: async (ctx, cursor, fieldIds, options) => (await load()).readPage(ctx, cursor, fieldIds, options),
    lookup: async (ctx, requests) => (await load()).lookup(ctx, requests),
    apply: async (ctx, chunk, writer) => (await load()).apply(ctx, chunk, writer),
    revert: async (ctx, snapshot, decisions) => (await load()).revert(ctx, snapshot, decisions),
  }
}

/**
 * What this plugin imports and exports (AGL-3529), declared in
 * `plugins.config.json` and answered here: one list's members, and a site's
 * suppression list. The console's transfer routes are the only callers, so
 * the tenant does not register them.
 */
export function registerEmailTransferResources(): void {
  registerPluginTransferResource(
    LIST_MEMBERS_RESOURCE,
    {
      fields: () => listMemberCatalog(),
      matchKeys: LIST_MEMBER_MATCH_KEYS,
      aliases: LIST_MEMBER_ALIASES,
      lockedRules: () => LIST_MEMBER_LOCKED_RULES,
      ...lazyTransferHooks(async () => (await import('./transfer/list-members.server')).listMembersTransferResource),
      // The list import's own dry run: the contact columns and the screening.
      plan: async (ctx, input) => (await import('./transfer/list-members.server')).planListMembers(ctx, input),
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginTransferResource(
    SUPPRESSIONS_RESOURCE,
    {
      fields: () => suppressionCatalog(),
      matchKeys: SUPPRESSION_MATCH_KEYS,
      aliases: SUPPRESSION_ALIASES,
      lockedRules: () => SUPPRESSION_LOCKED_RULES,
      ...lazyTransferHooks(async () => (await import('./transfer/suppressions.server')).suppressionsTransferResource),
    },
    { pluginId: BUNDLE_ID },
  )
}

/**
 * The email plugin's CONSOLE-ONLY server declarations (AGL-3305), named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot.
 *
 * It fills `plugin-email-streams`: when an account's answer about product
 * updates turns back to yes in the console, core asks this plugin to reopen
 * that one stream on the marketing site, over this plugin's topic catalog.
 * The only caller is a console route, so the tenant — which serves the public
 * internet — does not register it.
 *
 * Light at boot: the module that does the work is imported the first time a
 * stream is reopened.
 *
 * It also answers what this plugin imports and exports
 * ({@link registerEmailTransferResources}), whose only callers are the
 * console's transfer routes.
 */
export function registerEmailConsoleServerDeclarations(): void {
  // The registry replaces this plugin's earlier entry, so a second call (a
  // hot reload, a spec) is harmless.
  registerPluginEmailStreams(
    {
      rejoin: async (request) => (await import('./server')).rejoinStreamForAccount(request),
    },
    { pluginId: BUNDLE_ID },
  )
  // The email plugin's share of a person erasure (AGL-2623, AGL-3080): the
  // person comes off every audience list. Required, and loaded with the first
  // erasure.
  registerPluginPersonEraser(
    async (request) => (await import('./server/person-eraser')).emailPersonEraser(request),
    { pluginId: BUNDLE_ID },
  )
  registerEmailTransferResources()
}
