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

import { POS_READER_SPLASH_MAX_BYTES } from '../model/pos-reader-splash'
import {
  drawAndUploadPosReaderSplash,
  ownerOrgOf,
  planPosReaderSplash,
  terminalConfigRef,
} from './pos-reader-splash'
import { posReaderSplashImageFacts, PosReaderSplashRenderError } from './pos-reader-splash-render'
import { POS_READER_SPLASH_IMAGES_SIGNATURE, verifyPosReaderSplashImagesRequest } from './pos-reader-splash-images'

/*==========================================
 * `POST /api/plugin-images/commerce/pos-reader-splash-images` (AGL-4048):
 * the start-up screen's image work, in the one function that ships `sharp`'s
 * native library (the console's plugins' image function; see
 * `pos-reader-splash-images.ts` for why).
 *
 *   {op: 'draw', hostId, key}   the store's plan is read again here, and
 *                               drawn and uploaded only while its key is
 *                               still the one the caller asked for:
 *                               `{fileIds}`, or 409 when it moved on
 *   {op: 'facts', dataBase64}   an uploaded screen's format and size:
 *                               `{facts}` (null when it is not an image)
 *
 * A machine's door: no session, a signature over the moment and the body
 * (401 without one). A screen the store must hear about is 422 with its
 * words; anything else is 500, and the caller records the failure as before.
 *=========================================*/

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function posReaderSplashImagesRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const raw = await request.text()
  if (!verifyPosReaderSplashImagesRequest(request.headers.get(POS_READER_SPLASH_IMAGES_SIGNATURE), raw)) {
    return json({ error: 'Unauthenticated' }, 401)
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
  try {
    if (body['op'] === 'facts') {
      const data = String(body['dataBase64'] ?? '')
      // A base64 body is 4/3 of the file; anything longer cannot be under 2 MB.
      if (!data || data.length > Math.ceil((POS_READER_SPLASH_MAX_BYTES * 4) / 3) + 4) {
        return json({ facts: null })
      }
      const { loadSharp } = await import('./pos-reader-splash-server')
      return json({ facts: await posReaderSplashImageFacts((await loadSharp()) as never, Buffer.from(data, 'base64')) })
    }
    if (body['op'] !== 'draw') return json({ error: 'Unknown op' }, 400)
    const hostId = String(body['hostId'] ?? '')
    const key = String(body['key'] ?? '')
    if (!DOCUMENT_ID.test(hostId) || !key) return json({ error: 'Bad request' }, 400)
    const config = (await terminalConfigRef(hostId).get()).data() as Record<string, unknown> | undefined
    if (!config?.['stripeLocationId']) return json({ error: 'This store has no card reader location.' }, 409)
    const plan = await planPosReaderSplash(hostId, await ownerOrgOf(hostId), config as Record<string, any>)
    // Drawn only for the screen the caller decided on: a save that landed
    // in between is the next pass's to draw.
    if (plan.key !== key || !plan.source) {
      return json({ error: 'The start-up screen changed while it was being drawn. Try again.' }, 409)
    }
    return json({ fileIds: await drawAndUploadPosReaderSplash(hostId, plan.source) })
  } catch (error) {
    if (error instanceof PosReaderSplashRenderError) return json({ error: error.message }, 422)
    console.error('[pos-reader-splash-images]', body['op'], error)
    return json({ error: 'The start-up screen could not be drawn.' }, 500)
  }
}
