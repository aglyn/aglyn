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

import type { FormDatasetBinding } from '@aglyn/aglyn/app-utils/form-dataset-binding'
import { createHmac } from 'crypto'
import { tokenSigningSecret } from './media-signing'
import { safeEqual } from './safe-equal'

/**
 * A form's dataset binding, signed into the page that renders the form.
 *
 * `/api/forms/submit` is public and unauthenticated, so nothing in its body
 * may choose which dataset a record lands in: a dataset id taken from the body
 * let anyone add rows to any dataset the site can see. The binding is instead
 * read off the form by the compose that renders the page, signed here, and
 * carried by the form; the route writes only where a valid signature says.
 *
 * What a token grants is what the published form already does. Anyone can read
 * one out of the page, and replaying it writes to that form's dataset with
 * that form's field map, for the site it was minted on — nothing a visitor
 * submitting the form could not already do.
 *
 * Signed with the shared, fail-closed `TOKEN_SIGNING_SECRET`, the secret the
 * other tenant tokens use, under its own `form-dataset-binding:` prefix so it
 * can never be replayed as any other kind of token. No expiry: a published
 * page can be served long after it rendered, and an expired token would drop
 * a live form's records. Rotating the secret, or the version, retires every
 * token at once.
 */

const VERSION = 'v1'
const PREFIX = 'form-dataset-binding'
/** Far above any real binding, so an oversized body is refused unparsed. */
const MAX_TOKEN_CHARS = 8192

interface SignedBinding {
  h: string
  d?: string
  n?: string
  m: Record<string, string>
}

const signature = (payload: string): string =>
  createHmac('sha256', tokenSigningSecret())
    .update(`${PREFIX}:${VERSION}:${payload}`)
    .digest('hex')

/**
 * The token a page carries for one form's binding on one site.
 *
 * Throws when `TOKEN_SIGNING_SECRET` is not configured, like every token this
 * secret signs; a caller that renders a page decides what an unsigned form
 * does.
 */
export function signFormDatasetBinding(
  hostId: string,
  binding: FormDatasetBinding,
): string {
  const body: SignedBinding = {
    h: hostId,
    ...(binding.datasetId ? { d: binding.datasetId } : {}),
    ...(binding.datasetName ? { n: binding.datasetName } : {}),
    m: binding.fieldMap,
  }
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${VERSION}.${payload}.${signature(payload)}`
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * The binding a token carries, or null when it is not a valid token for
 * `hostId`.
 *
 * Null for anything else at all — not a string, oversized, another version, a
 * signature that does not match, a site other than this one, or no signing
 * secret — because the only safe reading of a binding that cannot be verified
 * is that there is none.
 */
export function verifyFormDatasetBinding(
  hostId: string,
  token: unknown,
): FormDatasetBinding | null {
  try {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return null
    const [version, payload, signed, extra] = token.split('.')
    if (version !== VERSION || !payload || !signed || extra !== undefined) {
      return null
    }
    if (!safeEqual(signed, signature(payload))) return null
    const body = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<SignedBinding>
    if (!hostId || body?.h !== hostId) return null
    const datasetId = text(body.d, 128)
    const datasetName = text(body.n, 60)
    if (!datasetId && !datasetName) return null
    const fieldMap: Record<string, string> = {}
    if (body.m && typeof body.m === 'object' && !Array.isArray(body.m)) {
      for (const [key, value] of Object.entries(body.m)) {
        const submittedKey = text(key, 64)
        const datasetFieldId = text(value, 64)
        if (submittedKey && datasetFieldId) {
          fieldMap[submittedKey] = datasetFieldId
        }
      }
    }
    return {
      ...(datasetId ? { datasetId } : {}),
      ...(datasetName ? { datasetName } : {}),
      fieldMap,
    }
  } catch {
    return null
  }
}
