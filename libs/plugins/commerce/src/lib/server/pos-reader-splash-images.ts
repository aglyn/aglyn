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

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { PLUGIN_IMAGES_API_PREFIX } from '@aglyn/aglyn/app-utils/api-plugins'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'

/*==========================================
 * THE START-UP SCREEN'S IMAGE WORK HAS ITS OWN FUNCTION (AGL-4048).
 *
 * Drawing a card reader's start-up screen takes `sharp`, and `sharp` takes
 * libvips, a 17 MB native library the plugin API's function would otherwise
 * carry into every cold start of every plugin door. So the drawing is a
 * route of its own, registered to draw images (`images: true`), which the
 * console serves only from the plugins' image function at
 * `/api/plugin-images/commerce/pos-reader-splash-images`
 * (`pos-reader-splash-images-route.ts`), the one function that ships
 * libvips; on Vercel everything else that needs a screen drawn, or an
 * uploaded screen read, asks it over HTTP:
 *
 *   draw   {hostId, key}   draw the store's screen for the plan with that
 *                          key and upload each family's file to Stripe:
 *                          `{fileIds}` back
 *   facts  {dataBase64}    an uploaded image's format and size: `{facts}`
 *
 * The caller signs each request with the platform's signing secret, over
 * the moment and the body, so nobody else spends the function's time and no
 * request is replayed later. Off Vercel (a self-hosted server, a developer's
 * machine, a spec) one process holds every route and libvips with it, so
 * the work runs where it is asked for, exactly as before.
 *=========================================*/

/** The images route's registered path, served under `/api/plugin-images/`. */
export const POS_READER_SPLASH_IMAGES_PATH = 'commerce/pos-reader-splash-images'

/** The request header that carries the signature: `t=<ms>,v1=<hex>`. */
export const POS_READER_SPLASH_IMAGES_SIGNATURE = 'x-aglyn-images-signature'

/** How far a signed request's moment may be from the function's clock. */
export const POS_READER_SPLASH_IMAGES_WINDOW_MS = 5 * 60 * 1000

/** How long a caller waits for the function: inside its own 60 seconds. */
const REQUEST_TIMEOUT_MS = 55_000

let secretOverride: (() => string) | null = null

/** Test seam. */
export function setPosReaderSplashImagesSecretForTests(secret: (() => string) | null): void {
  secretOverride = secret
}

function signature(at: number, body: string): string {
  const digest = createHash('sha256').update(body).digest('hex')
  return createHmac('sha256', (secretOverride ?? tokenSigningSecret)())
    .update(`pos-reader-splash-images:${at}.${digest}`)
    .digest('hex')
}

/** The header value for a body signed now. Throws on a deploy with no signing secret. */
export function signPosReaderSplashImagesRequest(body: string, nowMs: number = Date.now()): string {
  return `t=${nowMs},v1=${signature(nowMs, body)}`
}

/**
 * Whether a request's signature is ours, over this body, and recent. False
 * for anything else, a deploy with no signing secret included (fail closed).
 */
export function verifyPosReaderSplashImagesRequest(
  header: string | null | undefined,
  body: string,
  nowMs: number = Date.now(),
): boolean {
  const parts = Object.fromEntries(
    String(header ?? '')
      .split(',')
      .map((part) => part.trim().split('=') as [string, string])
      .filter((pair) => pair.length === 2),
  )
  const at = Number(parts['t'])
  const given = String(parts['v1'] ?? '')
  if (!Number.isFinite(at) || !/^[a-f0-9]{64}$/.test(given)) return false
  if (Math.abs(nowMs - at) > POS_READER_SPLASH_IMAGES_WINDOW_MS) return false
  let expected: string
  try {
    expected = signature(at, body)
  } catch {
    return false
  }
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

/**
 * Where to ask for the image work, or `null` to do it in this process. On
 * Vercel only the images function ships libvips, so every other function
 * asks it, at the console's own address; anywhere else this process can draw.
 */
export function posReaderSplashImagesOrigin(): string | null {
  if (process.env['VERCEL'] !== '1') return null
  return platformConsoleOrigin()
}

/**
 * The headers that get our own request past our own edge, when configured:
 * the same pair the render monitor sends (AGL-3571).
 */
function edgeBypassHeaders(): Record<string, string> {
  const probe = String(process.env['AGLYN_PROBE_TOKEN'] ?? '').trim()
  const bypass = String(
    process.env['AGLYN_VERCEL_BYPASS'] || process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] || '',
  ).trim()
  return {
    ...(probe ? { 'x-aglyn-probe': probe } : {}),
    ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
  }
}

/** The function refused the work with words meant for the store (`422`), or the store moved on (`409`). */
export class PosReaderSplashImagesRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Asks the images function for one piece of work, signed. */
export async function requestPosReaderSplashImages<T>(
  origin: string,
  payload: { op: 'draw'; hostId: string; key: string } | { op: 'facts'; dataBase64: string },
): Promise<T> {
  const body = JSON.stringify(payload)
  const response = await fetch(`${origin}/api/${PLUGIN_IMAGES_API_PREFIX}/${POS_READER_SPLASH_IMAGES_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [POS_READER_SPLASH_IMAGES_SIGNATURE]: signPosReaderSplashImagesRequest(body),
      ...edgeBypassHeaders(),
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const answer = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (response.status === 422 || response.status === 409) {
    throw new PosReaderSplashImagesRefusal(String(answer?.error ?? 'That image could not be read.'), response.status)
  }
  if (!response.ok) throw new Error(`the start-up screen's images function answered ${response.status}`)
  return answer
}
