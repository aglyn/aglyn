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

import { authorizedFetch, type MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import type { TransferStatusResponse } from '@aglyn/aglyn/data-transfer'

/*
 * WHAT A PRODUCT IMPORT LEFT FOR THE PRODUCTS HUB (AGL-3531).
 *
 * The `productImport` zone's options are set in the wizard's own step
 * (`ProductImportOptionsStep`) and the hub hands them to the `productsHub`
 * zone with the products the import CREATED — the AI copy option starts a
 * copy job for exactly those. The step files the job here; the hub takes it
 * when the wizard closes on its results and reads the created ids from the
 * job's results. Module state is enough: the step and the hub share one tab.
 */

export interface PendingProductImport {
  orgId: string
  jobId: string
  /** The options the `productImport` zone set, by key. */
  options: Record<string, boolean>
}

const pending = new Map<string, PendingProductImport>()

/** Files the import a site's wizard is running, with its options. */
export function rememberProductImport(hostId: string, entry: PendingProductImport): void {
  pending.set(hostId, entry)
}

/** The import the site's wizard last ran, once: the hub takes it when the wizard closes. */
export function takeProductImport(hostId: string): PendingProductImport | null {
  const entry = pending.get(hostId) ?? null
  pending.delete(hostId)
  return entry
}

/** The products an applied import created, from the job's results (`api/transfer/status`). */
export async function createdProductIds(user: MaybeTokenSource, entry: PendingProductImport): Promise<string[]> {
  const response = await authorizedFetch(user, '/api/transfer/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: entry.orgId, jobId: entry.jobId, include: 'results' }),
  })
  if (!response.ok) return []
  const status = (await response.json().catch(() => null)) as TransferStatusResponse | null
  const ids: string[] = []
  for (const row of status?.rows ?? []) {
    if (row.outcome === 'created' && row.recordId && !ids.includes(row.recordId)) ids.push(row.recordId)
  }
  return ids
}
