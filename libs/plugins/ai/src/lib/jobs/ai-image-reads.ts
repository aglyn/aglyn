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
import { formatMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import type { AiMediaAssetLocation } from './ai-media-asset'

/*==========================================
 * A JOB'S IMAGE READS HAVE THEIR OWN FUNCTION (AGL-4048).
 *
 * Two job steps decode a picture from a site's media library with `sharp`:
 * the products step makes the JPEG of a product's first photo that the
 * model is shown (`ai-product-image.ts`), and the theme step reduces the
 * site logo to its dominant colors (`ai-theme-brand-inputs.ts`). `sharp`
 * takes libvips, a 17 MB native library that on Vercel only the console's
 * plugins' image function ships: neither the plugin dispatcher, where a door
 * runs a job's first step, nor the AI jobs beat, which runs every step after
 * it, carries it. So the read is a route of its own, registered to draw
 * images (`images: true`) and served at `/api/plugin-images/ai/image-reads`
 * (`server/ai-image-reads-route.ts`), and on Vercel a step asks it:
 *
 *   product-photo {ref, hostId, orgId}  `{read}`: the photo as the step
 *                                        sends it, or why it was not read
 *   logo-colors   {ref, hostId, orgId}  `{colors}`: the logo's dominant
 *                                        colors, or null
 *
 * The function locates the asset again from the reference, the site and
 * the org, under the same rule the step used, and reads it the way the media
 * CDN would serve it, so it reads nothing the step could not have read
 * itself. Each request is signed with the platform's signing secret over the
 * moment and the body, as the card reader start-up screen's are, under this
 * route's own name, so a signature for one route is none for another. Off
 * Vercel one process holds every route, and libvips with it, so the read
 * runs where it is asked for, as before.
 *
 * Any failure is the read's own: the photo is unreadable and the copy is
 * written from the product's words, or the logo's colors are left out with
 * the note that says so.
 *=========================================*/

/** The images route's registered path, served under `/api/plugin-images/`. */
export const AI_IMAGE_READS_PATH = 'ai/image-reads'

/** The request header that carries the signature: `t=<ms>,v1=<hex>`. */
export const AI_IMAGE_READS_SIGNATURE = 'x-aglyn-images-signature'

/** How far a signed request's moment may be from the function's clock. */
export const AI_IMAGE_READS_WINDOW_MS = 5 * 60 * 1000

/** The two reads the function makes. */
export type AiImageReadsOp = 'product-photo' | 'logo-colors'

/** One request's body: the asset by its media reference, and whose read it is. */
export interface AiImageReadsRequest {
  op: AiImageReadsOp
  ref: string
  hostId: string
  orgId: string
}

let secretOverride: (() => string) | null = null

/** Test seam. */
export function setAiImageReadsSecretForTests(secret: (() => string) | null): void {
  secretOverride = secret
}

function signature(at: number, body: string): string {
  const digest = createHash('sha256').update(body).digest('hex')
  return createHmac('sha256', (secretOverride ?? tokenSigningSecret)())
    .update(`ai-image-reads:${at}.${digest}`)
    .digest('hex')
}

/** The header value for a body signed now. Throws on a deploy with no signing secret. */
export function signAiImageReadsRequest(body: string, nowMs: number = Date.now()): string {
  return `t=${nowMs},v1=${signature(nowMs, body)}`
}

/**
 * Whether a request's signature is ours, over this body, and recent. False
 * for anything else, a deploy with no signing secret included (fail closed).
 */
export function verifyAiImageReadsRequest(
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
  if (Math.abs(nowMs - at) > AI_IMAGE_READS_WINDOW_MS) return false
  let expected: string
  try {
    expected = signature(at, body)
  } catch {
    return false
  }
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

/**
 * Where to ask for an image read, or `null` to make it in this process. On
 * Vercel only the images function ships libvips, so every other function
 * asks it, at the console's own address; anywhere else this process can
 * decode.
 */
export function aiImageReadsOrigin(): string | null {
  if (process.env['VERCEL'] !== '1') return null
  return platformConsoleOrigin()
}

/**
 * The request for a located asset's read: the asset named by its media
 * reference, which the function locates again. `null` for a location no
 * reference can name, which is never read.
 */
export function aiImageReadsRequest(
  op: AiImageReadsOp,
  location: AiMediaAssetLocation,
  hostId: string,
  orgId: string,
): AiImageReadsRequest | null {
  const ref = formatMediaRef(location.scopeSegment, location.mediaId)
  return ref ? { op, ref, hostId, orgId } : null
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

/**
 * Asks the images function for one read, signed, waiting no longer than the
 * step's own bound for it (`signal`). Throws on anything but an answer.
 */
export async function requestAiImageReads<T>(
  origin: string,
  payload: AiImageReadsRequest,
  signal: AbortSignal,
): Promise<T> {
  const body = JSON.stringify(payload)
  const response = await fetch(`${origin}/api/${PLUGIN_IMAGES_API_PREFIX}/${AI_IMAGE_READS_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [AI_IMAGE_READS_SIGNATURE]: signAiImageReadsRequest(body),
      ...edgeBypassHeaders(),
    },
    body,
    signal,
  })
  if (!response.ok) throw new Error(`the AI image reads function answered ${response.status}`)
  return (await response.json()) as T
}
