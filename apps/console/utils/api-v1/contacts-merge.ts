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
 * `POST /v1/contacts/{contactId}/merge` (AGL-2625) — fold another contact
 * into this one.
 *
 * The contact in the path SURVIVES: it keeps its address as the identity,
 * and the record named by `sourceContactId` is folded into it and deleted.
 * `mergeContacts` in the data library is the whole of the work — the same
 * function behind the console's `crm/contacts-merge` — so an integration
 * and a person at the record page cannot merge two different ways.
 *
 * ## Idempotency
 *
 * Takes an `Idempotency-Key` with the delete's exact semantics, and for the
 * delete's reason: a merge destroys a record, and a retry after a lost
 * response must be able to tell "already merged" from "wrong id". Without a
 * key, a second call finds no source contact and answers `404`, which is
 * true and is the confusion the key removes.
 *
 * ## What it answers
 *
 * The surviving contact, read back the way `GET` reads it — the
 * organization-wide profile, or one site's through `?consentSiteId=` —
 * with its `alternateEmails` now carrying the merged address.
 */

import { ApiErrors, apiJson, mergeContacts } from '@aglyn/tenant-data-admin'
import { apiKeyActorLabel } from '@aglyn/aglyn/app-utils/activity-presenter'
import type { ApiV1Context } from '../api-v1'
import { claimWrite, readJsonBody } from './shared'

/** The key an integration names the record to fold in by. */
export const MERGE_SOURCE_FIELD = 'sourceContactId'

export async function mergeContactRoute(
  request: Request,
  ctx: ApiV1Context,
  survivorRef: FirebaseFirestore.DocumentReference,
  view: (snapshot: FirebaseFirestore.DocumentSnapshot) => unknown,
): Promise<Response> {
  const body = await readJsonBody(request)
  const raw = body[MERGE_SOURCE_FIELD]
  const sourceId = typeof raw === 'string' ? raw.trim() : ''
  const fields: Record<string, string> = {}
  if (raw === undefined) fields[MERGE_SOURCE_FIELD] = 'Required — the contact to merge into this one'
  else if (!sourceId) fields[MERGE_SOURCE_FIELD] = 'Must be a contact id'
  else if (sourceId === survivorRef.id) {
    fields[MERGE_SOURCE_FIELD] = 'Must be a different contact from the one in the path'
  }
  for (const key of Object.keys(body)) {
    if (key !== MERGE_SOURCE_FIELD) fields[key] = 'Not accepted on a merge'
  }
  if (Object.keys(fields).length) {
    return ApiErrors.badRequest({
      message: 'Merge failed validation',
      code: 'validation_failed',
      fields,
      headers: ctx.headers,
    })
  }

  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'contact-merges',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const result = await mergeContacts({
      firestore: ctx.firestore,
      orgRef: ctx.firestore.collection('orgs').doc(ctx.orgId),
      survivorId: survivorRef.id,
      mergedId: sourceId,
      // A key has no uid; `'api'` is the attribution every API-created CRM
      // record carries in `createdByUid`, and the note it leaves names the
      // key when the organization named it.
      actor: { uid: 'api', email: null, apiKeyName: ctx.keyName },
      hostId: null,
      actorName: ctx.keyName ? apiKeyActorLabel(ctx.keyName) : 'API',
    })
    if (result.ok === false) {
      await claim.release()
      if (result.reason === 'survivor-missing') {
        return ApiErrors.notFound({ message: 'No such contact', headers: ctx.headers })
      }
      if (result.reason === 'merged-missing') {
        return ApiErrors.notFound({
          message: 'No such contact to merge',
          code: 'source_not_found',
          headers: ctx.headers,
        })
      }
      return ApiErrors.badRequest({
        message: 'Merge failed validation',
        code: 'validation_failed',
        fields: { [MERGE_SOURCE_FIELD]: 'Must be a different contact from the one in the path' },
        headers: ctx.headers,
      })
    }
    const answer = view(await survivorRef.get())
    await claim.record(200, answer)
    return apiJson(answer, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}
