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
 * THE IMPORT & EXPORT HUB'S CLIENT (AGL-3535) — the workspace package
 * route (`/api/transfer/package`), the history (`/api/transfer/jobs`) and a
 * job's result file (`/api/transfer/status`), for one workspace.
 *
 * Every refusal is thrown as a `TransferRequestError` with the route's
 * `code` and `details`, as the import wizard's client throws them.
 *=========================================*/

import {
  isTransferPlanRequired,
  TRANSFER_API_ROUTES,
  type PackageItemDecision,
  type TransferErrorResponse,
  type TransferJobsResponse,
  type TransferPackage,
  type TransferPackageApplyResponse,
  type TransferPackageDependencyChoice,
  type TransferPackageExportResponse,
  type TransferPackageListResponse,
  type TransferPackagePlanResponse,
  type TransferPackageUndoPlanResponse,
  type TransferPackageUndoResponse,
  type TransferPackageWarningClass,
  type TransferUndoDecision,
} from '@aglyn/aglyn/data-transfer'
import { TransferRequestError } from './transfer-http-client'

export interface TransferHubClientOptions {
  orgId: string
  /** `authorizedFetch` bound to the signed-in person. */
  fetch(input: string, init?: RequestInit): Promise<Response>
}

export interface TransferHubClient {
  jobs(page?: { after?: number | null; limit?: number }): Promise<TransferJobsResponse>
  resultFile(jobId: string): Promise<{ fileName: string; body: Blob }>
  listPackageItems(resources?: readonly string[]): Promise<TransferPackageListResponse>
  exportPackage(selection: { items?: readonly string[]; resources?: readonly string[]; dependencies?: boolean }): Promise<{
    fileName: string
    body: Blob
  }>
  plan(input: {
    jobId?: string | null
    file?: unknown
    fileName?: string
    decisions?: Record<string, PackageItemDecision>
    dependencyChoices?: Record<string, TransferPackageDependencyChoice>
  }): Promise<TransferPackagePlanResponse>
  apply(jobId: string, acknowledged?: readonly TransferPackageWarningClass[]): Promise<TransferPackageApplyResponse>
  undoPlan(jobId: string): Promise<TransferPackageUndoPlanResponse>
  undo(
    jobId: string,
    choices: { decisions: Record<string, TransferUndoDecision>; otherwise: TransferUndoDecision },
  ): Promise<TransferPackageUndoResponse>
}

async function answered<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Partial<TransferErrorResponse> & T
  if (!response.ok) {
    // A refusal for the plan is the owning plugin's body; its `code` names the feature.
    if (isTransferPlanRequired(payload)) {
      throw new TransferRequestError(payload.error, 'planRequired', response.status, payload)
    }
    throw new TransferRequestError(
      typeof payload.error === 'string' ? payload.error : 'The request failed. Try again.',
      payload.code ?? 'failed',
      response.status,
      payload.details,
    )
  }
  return payload as T
}

export function createTransferHubClient({ orgId, fetch }: TransferHubClientOptions): TransferHubClient {
  const post = (path: string, body: Record<string, unknown>) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, ...body }),
    })
  const pkg = async <T>(body: Record<string, unknown>) => answered<T>(await post(TRANSFER_API_ROUTES.package, body))

  return {
    jobs: async (page = {}) =>
      answered<TransferJobsResponse>(
        await post(TRANSFER_API_ROUTES.jobs, {
          limit: page.limit ?? 20,
          after: page.after ?? null,
          sitePackages: page.after == null,
        }),
      ),
    resultFile: async (jobId) => {
      const response = await post(TRANSFER_API_ROUTES.status, { jobId, download: 'results' })
      if (!response.ok) await answered(response)
      const named = /filename="?([^";]+)"?/i.exec(response.headers.get('Content-Disposition') ?? '')?.[1]
      return { fileName: named ?? `import-${jobId}-results.csv`, body: await response.blob() }
    },
    listPackageItems: (resources) => pkg({ action: 'list', ...(resources ? { resources: [...resources] } : {}) }),
    exportPackage: async (selection) => {
      const answer = await pkg<TransferPackageExportResponse>({
        action: 'export',
        ...(selection.items ? { items: [...selection.items] } : {}),
        ...(selection.resources ? { resources: [...selection.resources] } : {}),
        dependencies: Boolean(selection.dependencies),
      })
      const file: TransferPackage = answer.package
      return { fileName: answer.fileName, body: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }) }
    },
    plan: (input) =>
      pkg({
        action: 'plan',
        ...(input.jobId ? { jobId: input.jobId } : { package: input.file, fileName: input.fileName }),
        ...(input.decisions ? { decisions: input.decisions } : {}),
        ...(input.dependencyChoices ? { dependencyChoices: input.dependencyChoices } : {}),
      }),
    apply: (jobId, acknowledged) => pkg({ action: 'apply', jobId, ...(acknowledged ? { acknowledged: [...acknowledged] } : {}) }),
    undoPlan: (jobId) => pkg({ action: 'undoPlan', jobId }),
    undo: (jobId, choices) => pkg({ action: 'undo', jobId, ...choices }),
  }
}
