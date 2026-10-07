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

// lockdown-423: via libs/plugins/ai/src/lib/runtime/ai-gate.ts (POST) and
// libs/plugins/ai/src/lib/server/ai-jobs-gate.ts (GET); both climb to the
// lockdown verdict, and every stored picture also passes the upload route's.

import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-alt'
import {
  AI_IMAGE_MODEL_CATALOG,
  aiImageBilledUsdPerImage,
} from '../providers/catalog'
import { AI_UPSTREAM_FAILURE_COPY, AiUpstreamError } from '../providers/contract'
import {
  AI_IMAGE_ASPECT_RATIOS,
  AI_IMAGE_MAX_COUNT,
  AI_IMAGE_PROMPT_MAX_CHARS,
  AiImageSafetyRefusal,
  isAiImageAspectRatio,
  type AiImageProvider,
  type AiImageResult,
} from '../providers/image-contract'
import { vertexImageProvider } from '../providers/vertex-imagen'
import { aiGateLadder, type AiGateContext } from '../runtime/ai-gate'
import { assistBandRefuses, assistCreditsFromUsd } from '../usage/assist-credits'
import {
  publicAssistQuota,
  recordAssistCost,
  releaseAssistMessage,
} from '../usage/assist-usage'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * "Create with AI" in Media (AGL-3602): pictures from a description, made by
 * the configured image provider and stored in the library that asked.
 *
 * `GET  /api/ai/media/images?orgId=` — the button's verdict: 404 when the
 * provider is not configured or the generative release is off, 403 when the
 * plan lacks generation, else the model, the shapes, the count ceiling and
 * the credits one picture draws.
 *
 * `POST /api/ai/media/images { orgId, library, hostId?, forHostId?,
 * folderId?, prompt, aspectRatio, count }` — makes the pictures and answers
 * `{ mediaIds, filtered, failed, credits }`.
 *
 * ## A request, not a job
 *
 * A picture comes back in seconds, so this answers in the request, the way
 * "Save as a component with AI" does, rather than queueing a job the person
 * would then have to watch. It is metered on the same meter every door uses.
 *
 * ## The money, in order
 *
 * 1. `aiGateLadder` RESERVES before anything is spent: the `aiGenerative`
 *    entitlement, `release_ai_generative`, the `ai-generate` kill switch,
 *    `ai.generate` on the site, the per-account and per-address windows, the
 *    Free taste's own rungs and the band.
 * 2. A workspace whose band is a wall (Free, or a hard cap) is refused before
 *    the provider is called when the pictures asked for cost more credits
 *    than it has left, so a request never runs past a wall it cannot pay.
 * 3. The provider is called. A fault of ours or Google's hands the
 *    reservation back and charges nothing. A description the safety filter
 *    declines charges nothing either, but is recorded as a declined request,
 *    which is what the Free taste's daily refusal pause counts.
 * 4. Each picture is stored, and only stored pictures are SETTLED: billed at
 *    the catalog's per-picture billed rate, which is above Google's price.
 *    A picture the filter held back, or one the library refused to store,
 *    is never charged; when none is stored the reservation goes back too.
 *
 * ## Stored the way any upload is stored
 *
 * Each picture is posted to the console's own `/api/media/upload` with the
 * caller's credential, so the scope, the uploads lockdown, the structural
 * inspection, the quarantine list, the storage band, the CDN variants and
 * the storage counter all apply exactly as they do to a file the person
 * dropped in. This door writes no media document of its own; it only adds,
 * to the documents that route made, the alt text written from the
 * description and the record of how the picture was made.
 */

/** The per-account window: a person makes a few sets a minute, not dozens. */
const RATE_LIMIT = { key: 'ai-media-image', limit: 6, windowMs: 60_000 }

/** The provider this door uses; a spec stands one in through jest. */
function imageProvider(): AiImageProvider {
  return vertexImageProvider
}

/** The credits one picture from `model` draws. */
export function aiImageCreditsPerImage(model: string): number {
  return assistCreditsFromUsd(aiImageBilledUsdPerImage(model))
}

/** Every control character as a space, squeezed, trimmed and cut. */
export function cleanAiImagePrompt(value: unknown): string {
  let out = ''
  for (const char of String(value ?? '')) {
    const code = char.charCodeAt(0)
    out += code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? ' ' : char
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, AI_IMAGE_PROMPT_MAX_CHARS)
}

/**
 * The alt text a picture is stored with: the description, as a sentence, cut
 * at a word inside the library's alt limit. A person edits it like any other.
 */
export function aiImageAltText(prompt: string): string {
  const text = prompt.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const sentence = text.charAt(0).toUpperCase() + text.slice(1)
  if (sentence.length <= MEDIA_ALT_MAX_LENGTH) return sentence
  const cut = sentence.slice(0, MEDIA_ALT_MAX_LENGTH - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`
}

/** A file name from the description's first words: `ai-a-red-barn-2.jpg`. */
export function aiImageFileName(prompt: string, index: number, mimeType: string): string {
  const words = prompt
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
    .slice(0, 60)
    .replace(/-+$/, '')
  const extension = mimeType === 'image/png' ? 'png' : 'jpg'
  return `ai-${words || 'image'}-${index + 1}.${extension}`
}

/** What the library asked for, read and bounded. */
export interface AiMediaImageInput {
  orgId: string
  library: 'host' | 'org'
  /** The site whose library this is, or the site on screen for the org's. */
  hostId: string | null
  folderId: string | null
  prompt: string
  aspectRatio: string
  count: number
}

export function parseAiMediaImageInput(body: Record<string, unknown> | null): AiMediaImageInput {
  const text = (key: string, limit = 128) => {
    const value = body?.[key]
    return typeof value === 'string' ? value.trim().slice(0, limit) : ''
  }
  const count = Math.floor(Number(body?.['count'] ?? 1))
  return {
    orgId: text('orgId'),
    library: body?.['library'] === 'org' ? 'org' : 'host',
    hostId: text('hostId') || null,
    folderId: text('folderId', 64) || null,
    prompt: cleanAiImagePrompt(body?.['prompt']),
    aspectRatio: text('aspectRatio', 8),
    count: Number.isFinite(count) ? count : 0,
  }
}

/** One stored picture, or the upload route's refusal. */
type StoreOutcome = { mediaId: string } | { error: string; status: number }

/**
 * Posts one picture to the console's own upload route, as the caller. The
 * same body the library's Upload button sends, so the route cannot tell the
 * two apart and applies every check it applies to that one.
 */
async function storeThroughUploadRoute(
  request: Request,
  input: AiMediaImageInput,
  image: { base64: string; mimeType: string },
  fileName: string,
): Promise<StoreOutcome> {
  const scope =
    input.library === 'org'
      ? { orgId: input.orgId, ...(input.hostId ? { forHostId: input.hostId } : {}) }
      : { hostId: input.hostId }
  let response: Response
  try {
    response = await fetch(new URL('/api/media/upload', request.url), {
      method: 'POST',
      headers: {
        Authorization: request.headers.get('authorization') ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...scope,
        fileName,
        contentType: image.mimeType,
        folderId: input.folderId,
        data: image.base64,
      }),
    })
  } catch {
    return { error: 'The picture could not be saved to the media library.', status: 502 }
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  const mediaId = typeof payload['mediaId'] === 'string' ? payload['mediaId'] : ''
  if (response.ok && mediaId) return { mediaId }
  return {
    error:
      typeof payload['error'] === 'string'
        ? payload['error']
        : 'The picture could not be saved to the media library.',
    status: response.ok ? 502 : response.status,
  }
}

/** The record a generated picture keeps of how it was made. */
export interface AiMediaProvenance {
  model: string
  prompt: string
  aspectRatio: string
  /** The meter's signal id for the request that made it. */
  signalId: string | null
  generatedBy: string
}

/**
 * Adds the alt text and the provenance to a document the upload route made.
 * An `update`, which cannot mint a document: the route minted it.
 */
async function annotateStoredImage(
  gate: AiGateContext,
  input: AiMediaImageInput,
  mediaId: string,
  provenance: AiMediaProvenance,
): Promise<void> {
  const scopeRef =
    input.library === 'org'
      ? gate.firestore.collection('orgs').doc(input.orgId)
      : gate.firestore.collection('hosts').doc(String(input.hostId))
  const alt = aiImageAltText(provenance.prompt)
  await scopeRef
    .collection('media')
    .doc(mediaId)
    .update({
      alt,
      // The library's "Alt text is missing" filter key, which the upload
      // route wrote as false before the alt existed.
      hasAlt: alt.length > 0,
      description: 'Created with AI from a description.',
      aiGenerated: { ...provenance, createdAt: new Date() },
    })
}

export async function GET(request: Request): Promise<Response> {
  const orgId = new URL(request.url).searchParams.get('orgId') ?? ''
  const gate = await aiJobsGate(request, orgId)
  if (gate instanceof Response) return gate
  const provider = imageProvider()
  // Not configured is not here: the button never draws.
  if (!provider.configured()) return Response.json({ error: 'Not found' }, { status: 404 })
  const model = provider.defaultModel()
  const entry = AI_IMAGE_MODEL_CATALOG.find((row) => row.id === model)
  return Response.json({
    model: { id: model, label: entry?.label ?? model },
    aspectRatios: AI_IMAGE_ASPECT_RATIOS,
    maxCount: AI_IMAGE_MAX_COUNT,
    creditsPerImage: aiImageCreditsPerImage(model),
  })
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown> | null
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = null
  }
  const input = parseAiMediaImageInput(body)
  const provider = imageProvider()
  // A deployment that never configured the provider has no such door, so
  // nothing about the caller or the workspace is read first.
  if (!provider.configured()) return Response.json({ error: 'Not found' }, { status: 404 })

  const gate = await aiGateLadder(
    { request, orgId: input.orgId, hostId: input.hostId },
    {
      feature: 'aiGenerative',
      releaseFlag: 'release_ai_generative',
      lockdownFeature: 'ai-generate',
      permission: 'ai.generate',
      rateLimit: RATE_LIMIT,
    },
  )
  if (gate instanceof Response) return gate
  // Nothing is spent until the provider answers, so every exit before it
  // hands the reservation back.
  const release = () =>
    releaseAssistMessage(gate.firestore, gate.orgId, gate.reservation).catch(() => undefined)
  const refuse = async (error: string, status: number, extra: Record<string, unknown> = {}) => {
    await release()
    return Response.json({ error, ...extra }, { status })
  }

  if (input.library === 'host' && !input.hostId) {
    return refuse('Open the site whose media library the pictures go in.', 400)
  }
  if (!input.prompt) return refuse('Describe the picture you want first.', 400)
  if (!isAiImageAspectRatio(input.aspectRatio)) {
    return refuse(`Choose a shape: ${AI_IMAGE_ASPECT_RATIOS.join(', ')}.`, 400)
  }
  if (input.count < 1 || input.count > AI_IMAGE_MAX_COUNT) {
    return refuse(`Make between 1 and ${AI_IMAGE_MAX_COUNT} pictures at a time.`, 400)
  }

  const model = provider.defaultModel()
  const perImage = aiImageCreditsPerImage(model)
  const estimate = perImage * input.count
  const credits = publicAssistQuota(gate.reservation).credits
  if (credits && assistBandRefuses(gate.org) && credits.remaining < estimate) {
    return refuse(
      credits.remaining < perImage
        ? 'This workspace has used its AI credits for the month.'
        : `That needs ${estimate} credits and this workspace has ${credits.remaining} left this month. Make fewer pictures.`,
      429,
      { reason: 'quota', quota: publicAssistQuota(gate.reservation) },
    )
  }

  let result: AiImageResult
  try {
    result = await provider.generate({
      model,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      count: input.count,
    })
  } catch (error) {
    if (error instanceof AiImageSafetyRefusal) {
      // Declined, not failed: nothing is charged, and the request is
      // recorded as a declined one so the Free taste's refusal pause counts
      // it the way it counts a declined text request.
      await recordAssistCost(gate.firestore, gate.orgId, {
        route: '/api/ai/media/images',
        hostId: input.hostId,
        model,
        tier: 'entitled',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, images: 0 },
        docsPaths: [],
        stopReason: 'refusal',
        free: gate.reservation.free ?? null,
        uid: gate.uid,
        kind: 'image',
      }).catch((meterError) =>
        console.error('ai image refusal not recorded', { orgId: gate.orgId, meterError }),
      )
      return Response.json({ error: error.message, reason: 'safety' }, { status: 422 })
    }
    await release()
    console.error('ai image generation failed', { orgId: gate.orgId, error })
    const status = error instanceof AiUpstreamError && error.accountProblem ? 503 : 502
    return Response.json({ error: AI_UPSTREAM_FAILURE_COPY }, { status })
  }

  const stored: string[] = []
  let refusal: { error: string; status: number } | null = null
  for (const [index, image] of result.images.entries()) {
    const outcome = await storeThroughUploadRoute(
      request,
      input,
      image,
      aiImageFileName(input.prompt, index, image.mimeType),
    )
    if ('mediaId' in outcome) stored.push(outcome.mediaId)
    else refusal ??= outcome
  }

  if (!stored.length) {
    // Made and not kept: the library refused every picture (its storage
    // band, a lockdown, a permission), so nothing is charged.
    await release()
    return Response.json(
      { error: refusal?.error ?? 'The pictures could not be saved.' },
      { status: refusal?.status ?? 502 },
    )
  }

  let signalId: string | null = null
  try {
    signalId = await recordAssistCost(gate.firestore, gate.orgId, {
      route: '/api/ai/media/images',
      hostId: input.hostId,
      model: result.model,
      tier: 'entitled',
      // Only what was stored: a picture held back or refused is never billed.
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        images: stored.length,
      },
      docsPaths: [],
      stopReason: 'end_turn',
      free: gate.reservation.free ?? null,
      uid: gate.uid,
      kind: 'image',
    })
  } catch (error) {
    // The pictures are in the library and were paid for by us; a meter
    // that could not be written is not a reason to hide them.
    console.error('ai image usage not recorded', { orgId: gate.orgId, error })
  }

  const provenance: AiMediaProvenance = {
    model: result.model,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    signalId,
    generatedBy: gate.uid,
  }
  await Promise.all(
    stored.map((mediaId) =>
      annotateStoredImage(gate, input, mediaId, provenance).catch((error) =>
        console.error('ai image alt text not written', { mediaId, error }),
      ),
    ),
  )

  return Response.json({
    mediaIds: stored,
    filtered: result.filtered,
    failed: result.images.length - stored.length,
    credits: perImage * stored.length,
    ...(refusal ? { warning: refusal.error } : {}),
  })
}
