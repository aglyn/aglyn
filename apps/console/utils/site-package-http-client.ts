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
 * THE CONSOLE'S SITE PACKAGE CLIENT (AGL-3534) — the UI kit's
 * `SitePackageClient` over the site package routes.
 *
 * `/api/hosts/import` takes `action: plan | compare | apply | undoPlan |
 * undo`; `/api/hosts/export` answers the file, a selection of it, or the
 * manifest alone (`list`). The client is bound to one site, so no request
 * the kit makes can name another, and every refusal is thrown with the
 * route's sentence (and its problems, when it lists them).
 *=========================================*/

import type {
  SitePackageApplyAnswer,
  SitePackageCatalog,
  SitePackageClient,
  SitePackageComparison,
  SitePackagePlanAnswer,
  SitePackageUndoAnswer,
  SitePackageUndoPlan,
} from '@aglyn/aglyn-transfer-ui'

/** A site package route refused the request. */
export class SitePackageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problems: readonly string[] = [],
  ) {
    super(problems.length ? `${message}: ${problems.slice(0, 3).join(' ')}` : message)
    this.name = 'SitePackageRequestError'
  }
}

export interface SitePackageHttpClientOptions {
  hostId: string
  /** `authorizedFetch` bound to the signed-in person. */
  fetch(input: string, init?: RequestInit): Promise<Response>
}

async function answer<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new SitePackageRequestError(
      typeof payload?.error === 'string' ? payload.error : fallback,
      response.status,
      Array.isArray(payload?.problems) ? payload.problems.map(String) : [],
    )
  }
  return payload as T
}

/** The file name the export route gave, or one made the same way. */
function fileNameOf(response: Response, hostId: string): string {
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const named = /filename="([^"]+)"/.exec(disposition)?.[1]
  return named ?? `aglyn-${hostId}-${new Date().toISOString().slice(0, 10)}.json`
}

export function createSitePackageHttpClient({ hostId, fetch }: SitePackageHttpClientOptions): SitePackageClient {
  const importing = async <T>(body: Record<string, unknown>, fallback: string) =>
    answer<T>(
      await fetch('/api/hosts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, ...body }),
      }),
      fallback,
    )
  const exporting = (body: Record<string, unknown>) =>
    fetch('/api/hosts/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, ...body }),
    })

  return {
    plan: (file, decided = {}) =>
      importing<SitePackagePlanAnswer>({ action: 'plan', package: file, ...decided }, 'The file could not be planned'),
    compare: async (file, keys) =>
      (
        await importing<{ items: SitePackageComparison[] }>(
          { action: 'compare', package: file, keys },
          'The items could not be compared',
        )
      ).items,
    apply: (file, decided) =>
      importing<SitePackageApplyAnswer>({ action: 'apply', package: file, ...decided }, 'Import failed'),
    undoPlan: (importId) =>
      importing<SitePackageUndoPlan>({ action: 'undoPlan', importId }, 'The import could not be checked'),
    undo: (importId, choices) =>
      importing<SitePackageUndoAnswer>({ action: 'undo', importId, ...choices }, 'Undo failed'),
    catalog: async () => answer<SitePackageCatalog>(await exporting({ list: true }), 'The site’s items could not be read'),
    exportPackage: async (selection) => {
      const response = await exporting(
        selection.items ? { items: [...selection.items], dependencies: Boolean(selection.dependencies) } : {},
      )
      if (!response.ok) await answer(response, 'Export failed')
      return { fileName: fileNameOf(response, hostId), body: await response.blob() }
    },
  }
}
