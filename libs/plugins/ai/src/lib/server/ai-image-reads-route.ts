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

import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { AI_IMAGE_READS_SIGNATURE, verifyAiImageReadsRequest } from '../jobs/ai-image-reads'
import { aiMediaAssetLocation } from '../jobs/ai-media-asset'
import { readAiProductImageAt } from '../jobs/ai-product-image'
import { readAiThemeLogoColorsAt } from '../jobs/ai-theme-brand-inputs'

/*==========================================
 * `POST /api/plugin-images/ai/image-reads` (AGL-4048): a job step's image
 * reads, in the one function that ships `sharp`'s native library (the
 * console's plugins' image function; see `jobs/ai-image-reads.ts` for why).
 *
 *   {op: 'product-photo', ref, hostId, orgId}   `{read}`: the product photo
 *                                               as the products step sends
 *                                               it, or why it was not read
 *   {op: 'logo-colors', ref, hostId, orgId}     `{colors}`: the site logo's
 *                                               dominant colors, or null
 *
 * The asset is located again here from its reference, the site and the org,
 * under the rule the step used (`aiMediaAssetLocation`): one that is not the
 * site's own library's or its org's is not read. The read is the media
 * library's own (`readAiMediaAssetBytes`), so nothing is fetched from a URL.
 *
 * A machine's door: no session, a signature over the moment and the body
 * (401 without one). A read that fails is a 500, and the step treats it as
 * the unreadable photo or logo it would have been in its own process.
 *=========================================*/

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function aiImageReadsRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const raw = await request.text()
  if (!verifyAiImageReadsRequest(request.headers.get(AI_IMAGE_READS_SIGNATURE), raw)) {
    return json({ error: 'Unauthenticated' }, 401)
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400)
  const op = body['op']
  if (op !== 'product-photo' && op !== 'logo-colors') return json({ error: 'Unknown op' }, 400)
  const hostId = String(body['hostId'] ?? '')
  const orgId = String(body['orgId'] ?? '')
  if (!DOCUMENT_ID.test(hostId) || (orgId !== '' && !DOCUMENT_ID.test(orgId))) {
    return json({ error: 'Bad request' }, 400)
  }
  const location = aiMediaAssetLocation(body['ref'], hostId, orgId)
  try {
    const firestore = firebaseAdmin.app().firestore()
    if (op === 'product-photo') {
      return json({
        read: location ? await readAiProductImageAt(firestore, location, hostId) : { status: 'not-in-library' },
      })
    }
    return json({ colors: location ? await readAiThemeLogoColorsAt(firestore, location, hostId) : null })
  } catch (error) {
    console.error('[ai-image-reads]', op, { hostId, error })
    return json({ error: 'The image could not be read.' }, 500)
  }
}
