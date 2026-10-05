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

import type {
  PluginTransferResource,
  TransferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

/**
 * The `data.dataset` server half (AGL-3530) as the console registers it at
 * boot: every hook loads `dataset-transfer.server.ts` — and the Admin SDK and
 * the job engine with it — on its first call, so a console process that
 * never imports or exports a dataset pays nothing for it.
 */
const hooks = async (): Promise<TransferRecordsHooks> =>
  (await import('./dataset-transfer.server')).datasetTransferHooks()

export const DATASET_TRANSFER_HOOKS: PluginTransferResource = {
  fields: async (ctx) => (await hooks()).fields(ctx),
  matchKeys: async (ctx) => {
    const matchKeys = (await hooks()).matchKeys
    return typeof matchKeys === 'function' ? matchKeys(ctx) : { keys: matchKeys }
  },
  count: async (ctx, options) => ((await hooks()).count as NonNullable<TransferRecordsHooks['count']>)(ctx, options),
  readPage: async (ctx, cursor, fieldIds, options) => (await hooks()).readPage(ctx, cursor, fieldIds, options),
  lookup: async (ctx, requests) => (await hooks()).lookup(ctx, requests),
  suggest: async (ctx, request) =>
    ((await hooks()).suggest as NonNullable<TransferRecordsHooks['suggest']>)(ctx, request),
  picklists: async (ctx, picklistIds) =>
    ((await hooks()).picklists as NonNullable<TransferRecordsHooks['picklists']>)(ctx, picklistIds),
  addPicklistValues: async (ctx, picklistId, values) =>
    ((await hooks()).addPicklistValues as NonNullable<TransferRecordsHooks['addPicklistValues']>)(ctx, picklistId, values),
  plan: async (ctx, input) => ((await hooks()).plan as NonNullable<TransferRecordsHooks['plan']>)(ctx, input),
  apply: async (ctx, chunk, writer) => (await hooks()).apply(ctx, chunk, writer),
  revert: async (ctx, snapshot, decisions) => (await hooks()).revert(ctx, snapshot, decisions),
}
