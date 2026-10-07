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

// lockdown-423: via libs/plugins/ai/src/lib/runtime/ai-gate.ts
// The POST climbs `aiGateLadder`, whose lockdown rung is the verdict, and
// every stored picture also passes the upload route's.

import { mediaFilterKeys } from '@aglyn/aglyn/app-utils/media-metadata'
import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-alt'
import { aiMediaCreditsPerPicture } from '../model/ai-media-credits'
import { aiSvgThemePalette, isAiSvgColor } from '../model/ai-svg'
import { estimateAiBilledUsd } from '../providers/catalog'
import { AI_UPSTREAM_FAILURE_COPY, AiUpstreamError, type AiUsage } from '../providers/contract'
import {
  AI_IMAGE_ASPECT_RATIOS,
  AI_IMAGE_MAX_COUNT,
  AI_IMAGE_PROMPT_MAX_CHARS,
  AI_SVG_MAX_COLORS,
  AI_SVG_STYLES,
  AiImageSafetyRefusal,
  isAiImageAspectRatio,
  type AiImageAspectRatio,
  type AiImageMode,
  type AiImageProvider,
  type AiSvgStyle,
} from '../providers/image-contract'
import { vertexImageProvider } from '../providers/vertex-image'
import { aiGateLadder, type AiGateContext } from '../runtime/ai-gate'
import { aiInventoryTheme } from '../runtime/site-inventory'
import { assistBandRefuses, assistCreditsFromUsd } from '../usage/assist-credits'
import {
  publicAssistQuota,
  recordAssistCost,
  releaseAssistMessage,
} from '../usage/assist-usage'
import { aiMediaSvgModel, generateAiMediaSvg, type AiMediaSvgOutcome } from './ai-media-svg'

/**
 * "Create with AI" in Media (AGL-3602): pictures from a description, stored
 * in the library that asked.
 *
 * `POST /api/ai/media/images { orgId, library, hostId?, folderId?, mode,
 * prompt, aspectRatio, count, style?, palette? }` answers
 * `{ mediaIds, filtered, failed, credits, warning? }`.
 *
 * Two modes:
 *
 * - `photo` — Google's image models on Vertex AI (`vertex-image.ts`). Off
 *   unless the deployment configured them; the door answers 404 with a
 *   sentence the dialog shows.
 * - `illustration` — an SVG drawn by the text provider every other AI door
 *   uses (`ai-media-svg.ts`): an illustration, an icon, a tileable pattern or
 *   a simple logo mark, in the site's theme colors or the person's own. No
 *   new vendor, so it runs wherever text AI does.
 *
 * There is no GET: the button draws from the shell's own gates, and this door
 * decides when someone asks for a picture.
 *
 * ## A request, not a job
 *
 * Both modes answer inside the request, the way "Save as a component with
 * AI" does, and are metered on the same meter every door uses.
 *
 * ## The money, in order
 *
 * 1. `aiGateLadder` RESERVES before anything is spent: the `aiGenerative`
 *    entitlement, `release_ai_generative`, the `ai-generate` kill switch,
 *    `ai.generate` on the site, the per-account and per-address windows, the
 *    Free taste's own rungs and the band.
 * 2. A workspace whose band is a wall (Free, or a hard cap) is refused before
 *    the provider is called when the pictures' estimate is more than it has
 *    left.
 * 3. The provider is called. A fault of ours or the provider's hands the
 *    reservation back and charges nothing. A declined description charges
 *    only what the decline spent, recorded as a declined request (which a
 *    Free workspace is never charged for, and which its daily refusal pause
 *    counts).
 * 4. Each picture is stored, and only what was stored is SETTLED, at billed
 *    rates above the provider's: a photo per picture plus its prompt and
 *    thinking, an illustration as the tokens that drew it. A picture held
 *    back, one the library refused, and an illustration that failed its
 *    safety check twice are never charged — that last one is ours.
 *
 * ## Stored the way any upload is stored
 *
 * Each picture is posted to the console's own `/api/media/upload` with the
 * caller's credential, so the scope, the uploads lockdown, the structural
 * inspection, SVG sanitizing, the quarantine list, the storage band, the CDN
 * variants and the storage counter all apply exactly as they do to a file
 * the person dropped in. This door writes no media document of its own; it
 * only adds, to the documents that route made, the alt text and the record
 * of how the picture was made.
 */

/** The per-account window: a person makes a few sets a minute, not dozens. */
const RATE_LIMIT = { key: 'ai-media-image', limit: 6, windowMs: 60_000 }

/** What a person reads when a picture failed on our side. */
export const AI_MEDIA_OURS_COPY =
  "This one's on us — you weren't charged. The picture didn't come out right; try again, or describe it a little differently."

/** What the door answers on a deployment that makes no photos. */
export const AI_MEDIA_NO_PHOTOS_COPY =
  "Photos aren't available here yet. Choose Illustration to draw one instead."

/** The provider photos come from; a spec stands one in through jest. */
function imageProvider(): AiImageProvider {
  return vertexImageProvider
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
 * The alt text a picture is stored with: the sentence given, as a sentence,
 * cut at a word inside the library's alt limit. A person edits it like any
 * other.
 */
export function aiImageAltText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const sentence = clean.charAt(0).toUpperCase() + clean.slice(1)
  if (sentence.length <= MEDIA_ALT_MAX_LENGTH) return sentence
  const cut = sentence.slice(0, MEDIA_ALT_MAX_LENGTH - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** A file name from the description's first words: `ai-a-red-barn-2.png`. */
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
  return `ai-${words || 'image'}-${index + 1}.${EXTENSIONS[mimeType] ?? 'png'}`
}

/** What the library asked for, read and bounded. */
export interface AiMediaImageInput {
  orgId: string
  library: 'host' | 'org'
  /** The site whose library this is, or the site on screen for the org's. */
  hostId: string | null
  folderId: string | null
  mode: AiImageMode
  prompt: string
  aspectRatio: string
  count: number
  /** An illustration's kind; unread for a photo. */
  style: string
  /** An illustration's colors: the site theme's, or these. */
  palette: { source: 'theme' } | { source: 'custom'; colors: string[] }
}

export function parseAiMediaImageInput(body: Record<string, unknown> | null): AiMediaImageInput {
  const text = (key: string, limit = 128) => {
    const value = body?.[key]
    return typeof value === 'string' ? value.trim().slice(0, limit) : ''
  }
  const count = Math.floor(Number(body?.['count'] ?? 1))
  const palette = body?.['palette'] as Record<string, unknown> | undefined
  const colors = Array.isArray(palette?.['colors']) ? (palette?.['colors'] as unknown[]) : []
  return {
    orgId: text('orgId'),
    library: body?.['library'] === 'org' ? 'org' : 'host',
    hostId: text('hostId') || null,
    folderId: text('folderId', 64) || null,
    mode: body?.['mode'] === 'illustration' ? 'illustration' : 'photo',
    prompt: cleanAiImagePrompt(body?.['prompt']),
    aspectRatio: text('aspectRatio', 8),
    count: Number.isFinite(count) ? count : 0,
    style: text('style', 24) || 'illustration',
    palette:
      palette?.['source'] === 'custom'
        ? {
            source: 'custom',
            colors: colors
              .map((color) => String(color ?? '').trim().toLowerCase())
              .slice(0, AI_SVG_MAX_COLORS + 1),
          }
        : { source: 'theme' },
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
  mode: AiImageMode
  /** An illustration's kind; absent on a photo. */
  style?: AiSvgStyle
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
  alt: string,
  provenance: AiMediaProvenance,
): Promise<void> {
  const scopeRef =
    input.library === 'org'
      ? gate.firestore.collection('orgs').doc(input.orgId)
      : gate.firestore.collection('hosts').doc(String(input.hostId))
  const mediaRef = scopeRef.collection('media').doc(mediaId)
  const stored = ((await mediaRef.get()).data() ?? {}) as Parameters<typeof mediaFilterKeys>[0]
  await mediaRef.update({
    alt,
    description: 'Created with AI from a description.',
    aiGenerated: { ...provenance, createdAt: new Date() },
    // What the library filters by, restamped with the alt now set: the upload
    // route wrote "Alt text is missing" before the alt existed.
    ...mediaFilterKeys({ ...stored, alt }),
  })
}

/** The colors an illustration is drawn in. */
async function illustrationPalette(
  gate: AiGateContext,
  input: AiMediaImageInput,
): Promise<string[]> {
  if (input.palette.source === 'custom') return input.palette.colors
  if (!input.hostId) return []
  const snapshot = await gate.firestore.collection('hosts').doc(input.hostId).get()
  return aiSvgThemePalette(aiInventoryTheme(snapshot.exists ? snapshot.data() ?? null : null)?.colors)
}

const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const sumUsage = (usages: readonly AiUsage[]): AiUsage =>
  usages.reduce<AiUsage>(
    (sum, usage) => ({
      inputTokens: sum.inputTokens + usage.inputTokens,
      outputTokens: sum.outputTokens + usage.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + usage.cacheWriteTokens,
    }),
    ZERO_USAGE,
  )

/** A picture made, before it is stored. */
interface MadePicture {
  base64: string
  mimeType: string
  alt: string
  /** What making it spent, charged only once it is stored. */
  usage: AiUsage
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
  const svgModel = input.mode === 'illustration' ? aiMediaSvgModel() : undefined
  // A deployment that makes no pictures of this kind has no such door, so
  // nothing about the caller or the workspace is read first.
  if (input.mode === 'photo' && !provider.configured()) {
    return Response.json({ error: AI_MEDIA_NO_PHOTOS_COPY, reason: 'unavailable' }, { status: 404 })
  }
  if (input.mode === 'illustration' && !svgModel) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

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
  // Nothing is spent until a provider answers, so every exit before it
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
  const aspectRatio: AiImageAspectRatio = input.aspectRatio
  if (input.count < 1 || input.count > AI_IMAGE_MAX_COUNT) {
    return refuse(`Make between 1 and ${AI_IMAGE_MAX_COUNT} pictures at a time.`, 400)
  }
  if (input.mode === 'illustration') {
    if (!(AI_SVG_STYLES as readonly string[]).includes(input.style)) {
      return refuse('Choose an illustration, an icon, a pattern or a logo mark.', 400)
    }
    if (
      input.palette.source === 'custom' &&
      (!input.palette.colors.length ||
        input.palette.colors.length > AI_SVG_MAX_COLORS ||
        !input.palette.colors.every(isAiSvgColor))
    ) {
      return refuse(`Give between 1 and ${AI_SVG_MAX_COLORS} colors as hex values, such as #1a73e8.`, 400)
    }
  }

  const model = input.mode === 'photo' ? provider.defaultModel() : (svgModel as string)
  const perPicture = aiMediaCreditsPerPicture(input.mode, model)
  const estimate = perPicture * input.count
  const credits = publicAssistQuota(gate.reservation).credits
  if (credits && assistBandRefuses(gate.org) && credits.remaining < estimate) {
    return refuse(
      credits.remaining < perPicture
        ? 'This workspace has used its AI credits for the month.'
        : `That needs about ${estimate} credits and this workspace has ${credits.remaining} left this month. Make fewer pictures.`,
      429,
      { reason: 'quota', quota: publicAssistQuota(gate.reservation) },
    )
  }

  /** Records what a decline spent: a declined request, never a picture. */
  const recordDecline = (usage: AiUsage, declinedModel: string) =>
    recordAssistCost(gate.firestore, gate.orgId, {
      route: '/api/ai/media/images',
      hostId: input.hostId,
      model: declinedModel,
      tier: 'entitled',
      usage: { ...usage, images: 0 },
      docsPaths: [],
      stopReason: 'refusal',
      free: gate.reservation.free ?? null,
      uid: gate.uid,
      kind: 'image',
    }).catch((meterError) =>
      console.error('ai media refusal not recorded', { orgId: gate.orgId, meterError }),
    )

  let made: MadePicture[]
  /** Pictures asked for and not made: held back, declined or failed on our side. */
  let unmade: number
  /** Tokens a photo request spent beside its pictures, charged once any is stored. */
  let photoUsage: AiUsage = ZERO_USAGE
  let declineReason: string | null = null
  let style: AiSvgStyle | undefined

  if (input.mode === 'photo') {
    try {
      const result = await provider.generate({
        model,
        prompt: input.prompt,
        aspectRatio,
        count: input.count,
      })
      photoUsage = result.usage
      unmade = result.filtered
      made = result.images.map((image) => ({
        ...image,
        alt: aiImageAltText(input.prompt),
        usage: ZERO_USAGE,
      }))
    } catch (error) {
      if (error instanceof AiImageSafetyRefusal) {
        // Declined, not failed: no picture is charged, and the request is
        // recorded as a declined one so the Free taste's refusal pause
        // counts it.
        await recordDecline(ZERO_USAGE, model)
        return Response.json({ error: error.message, reason: 'safety' }, { status: 422 })
      }
      await release()
      console.error('ai photo generation failed', { orgId: gate.orgId, error })
      const status = error instanceof AiUpstreamError && error.accountProblem ? 503 : 502
      return Response.json({ error: AI_UPSTREAM_FAILURE_COPY }, { status })
    }
  } else {
    style = input.style as AiSvgStyle
    const palette = await illustrationPalette(gate, input)
    const settled = await Promise.allSettled(
      Array.from({ length: input.count }, (_unused, variant) =>
        generateAiMediaSvg({
          model,
          prompt: input.prompt,
          style: style as AiSvgStyle,
          aspectRatio,
          palette,
          variant,
          count: input.count,
        }),
      ),
    )
    const outcomes = settled.flatMap((entry) =>
      entry.status === 'fulfilled' ? [entry.value] : [],
    )
    if (!outcomes.length) {
      await release()
      console.error('ai illustration generation failed', {
        orgId: gate.orgId,
        error: (settled[0] as PromiseRejectedResult | undefined)?.reason,
      })
      return Response.json({ error: AI_UPSTREAM_FAILURE_COPY }, { status: 502 })
    }
    const drawn = outcomes.filter(
      (outcome): outcome is Extract<AiMediaSvgOutcome, { kind: 'drawn' }> => outcome.kind === 'drawn',
    )
    const declined = outcomes.filter((outcome) => outcome.kind === 'declined')
    unmade = input.count - drawn.length
    declineReason =
      (declined[0] as Extract<AiMediaSvgOutcome, { kind: 'declined' }> | undefined)?.reason ?? null
    made = drawn.map((outcome) => ({
      base64: Buffer.from(outcome.svg, 'utf8').toString('base64'),
      mimeType: 'image/svg+xml',
      alt: aiImageAltText(outcome.alt || input.prompt),
      usage: outcome.usage,
    }))
    if (!made.length) {
      if (declined.length) {
        // The model declined: what it spent is a declined request.
        await recordDecline(sumUsage(declined.map((outcome) => outcome.usage)), model)
        return Response.json({ error: declineReason, reason: 'safety' }, { status: 422 })
      }
      // Every picture failed its check twice. Ours, so nothing is charged.
      await release()
      return Response.json({ error: AI_MEDIA_OURS_COPY, reason: 'ours' }, { status: 502 })
    }
  }

  const stored: Array<{ mediaId: string; picture: MadePicture }> = []
  let refusal: { error: string; status: number } | null = null
  for (const [index, picture] of made.entries()) {
    const outcome = await storeThroughUploadRoute(
      request,
      input,
      picture,
      aiImageFileName(input.prompt, index, picture.mimeType),
    )
    if ('mediaId' in outcome) stored.push({ mediaId: outcome.mediaId, picture })
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

  // Only what was stored is settled: a photo's pictures at the per-picture
  // rate with the request's prompt and thinking, an illustration's tokens.
  const usage =
    input.mode === 'photo'
      ? { ...photoUsage, images: stored.length }
      : sumUsage(stored.map((entry) => entry.picture.usage))
  let signalId: string | null = null
  try {
    signalId = await recordAssistCost(gate.firestore, gate.orgId, {
      route: '/api/ai/media/images',
      hostId: input.hostId,
      model,
      tier: 'entitled',
      usage,
      docsPaths: [],
      stopReason: 'end_turn',
      free: gate.reservation.free ?? null,
      uid: gate.uid,
      kind: 'image',
    })
  } catch (error) {
    // The pictures are in the library and were paid for by us; a meter
    // that could not be written is not a reason to hide them.
    console.error('ai media usage not recorded', { orgId: gate.orgId, error })
  }

  await Promise.all(
    stored.map(({ mediaId, picture }) =>
      annotateStoredImage(gate, input, mediaId, picture.alt, {
        model,
        prompt: input.prompt,
        mode: input.mode,
        ...(style ? { style } : {}),
        aspectRatio,
        signalId,
        generatedBy: gate.uid,
      }).catch((error) => console.error('ai media alt text not written', { mediaId, error })),
    ),
  )

  const warning =
    refusal?.error ??
    (declineReason && unmade > 0 ? declineReason : unmade > 0 && input.mode === 'illustration'
      ? AI_MEDIA_OURS_COPY
      : null)
  return Response.json({
    mediaIds: stored.map((entry) => entry.mediaId),
    filtered: unmade,
    failed: made.length - stored.length,
    // What was charged, as the meter priced it.
    credits: assistCreditsFromUsd(estimateAiBilledUsd(usage, model)),
    ...(warning ? { warning } : {}),
  })
}
