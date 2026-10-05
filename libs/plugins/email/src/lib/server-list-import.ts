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

/**
 * WHAT THE PERMISSION STEP SHOWS — `POST email/list-import-screening`.
 *
 * A list import runs on the platform's transfer framework (AGL-3529; the
 * server half is `transfer/list-members.server.ts`). Its "Permission" step is
 * where the operator states they have these people's permission, and the
 * statement is only worth recording if it is made in front of the evidence:
 * the shared mailboxes, the column names that read as a bought list, and
 * what the consent gate says about a sample of the addresses. The dry run
 * that runs as the operator reaches the step computes exactly that and keeps
 * it on the list's import ledger (`orgs/{orgId}/lists/{listId}/imports/{jobId}`);
 * this route reads it back for the step to draw. It writes nothing and
 * enrolls nobody.
 *
 * Behind the list gate (`resolveListContext`): an org-wide owner, admin or
 * editor, on a site of the organization, about a list that exists — the
 * population that may run the import in the first place.
 */

import {
  registerPluginApiRoute,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { resolveListContext } from './server-list-gate'

/** A list's import ledger, beside its members. */
const LIST_IMPORTS = 'imports'

/**
 * Body: `{ hostId, listId, jobId }`. Answers `{ listName, screening }`, the
 * screening `null` until a dry run has made one.
 */
export const emailListImportScreeningHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const jobId = String(req.body?.jobId ?? '').trim()
  if (!jobId || jobId.includes('/')) {
    return res.status(400).json({ error: 'Missing jobId' })
  }
  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const ledger = await context.listRef.collection(LIST_IMPORTS).doc(jobId).get()
    return res.status(200).json({
      listName: context.listName,
      screening: ledger.exists ? (ledger.get('screening') ?? null) : null,
      total: ledger.exists ? Number(ledger.get('total') ?? 0) : null,
    })
  } catch (error) {
    console.error('[email] list import screening failed', error)
    return res
      .status(500)
      .json({ error: 'What the file holds could not be read.' })
  }
}

/** Registration: one console route, reached by a person opening a step. */
export function registerEmailListImportApi(): void {
  registerPluginApiRoute(
    'email/list-import-screening',
    emailListImportScreeningHandler,
  )
}
