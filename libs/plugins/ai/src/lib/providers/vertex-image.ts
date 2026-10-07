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
import { getApp } from 'firebase-admin/app'
import { AI_IMAGE_DEFAULT_MODEL, AI_IMAGE_VERTEX_PROVIDER_ID } from './catalog'
import { aiTokenCount, AiUpstreamError, type AiUsage } from './contract'
import {
  AI_IMAGE_MAX_COUNT,
  AiImageSafetyRefusal,
  type AiGeneratedImage,
  type AiImageProvider,
  type AiImageRequest,
  type AiImageResult,
} from './image-contract'

/**
 * Google's Gemini image models on Vertex AI (AGL-3602), behind the image
 * contract: `POST https://aiplatform.googleapis.com/v1/projects/{project}/
 * locations/global/publishers/google/models/{model}:generateContent`.
 *
 * Gemini, not Imagen: Google discontinued the Imagen endpoints on Vertex AI
 * in 2026 and names `gemini-3.1-flash-image` as Imagen 4's replacement, at
 * the HIGH thinking level for the standard Imagen 4 model.
 *
 * ## No key of its own
 *
 * It authenticates as the service account firebase-admin already runs as,
 * through that credential's `getAccessToken()` — whose scopes include
 * `cloud-platform`, the scope Vertex AI asks for — the way the Web Risk and
 * reCAPTCHA admin calls do. The account needs the Vertex AI User role
 * (`roles/aiplatform.user`) on the project named below.
 *
 * ## Off unless an operator turns it on
 *
 * `AI_IMAGE_VERTEX_PROJECT` names the Google Cloud project the requests are
 * billed to, and is the switch: unset, `configured()` is false and the Media
 * door answers that photos are not made here. The console offers the photo
 * mode only when `NEXT_PUBLIC_AI_IMAGE_PHOTOS` is `on`, which a deployment
 * sets beside it. A self-hosted deployment is therefore off until its
 * operator chooses a project.
 *
 * ⛔ THE ORDER FOR AGLYN'S OWN PRODUCTION, and no check can see it, so this
 * paragraph is the gate: a description reaching Vertex AI makes Google LLC a
 * recipient of customer content for a purpose `/legal/subprocessors` does not
 * name today (its Google rows say database, storage, authentication, backups
 * and logging). Publish that row first — the master, then the page, with a
 * change-log line; the wording is drafted in
 * `docs/legal-drafts/AGL-3602-subprocessors.md` — then declare the host in
 * the AI catalog with that date as `publishedOn`, and only then set the two
 * variables in production.
 *
 * ## What is sent, and nothing else
 *
 * The description the member typed and the shape. No account, site,
 * organization or member identifier, no other content of the site and no
 * image. One request per picture (`candidateCount` 1), each asking for:
 *
 * - `responseModalities: ['IMAGE']` — a picture and no prose, which is also
 *   what lets the model render at the size asked for;
 * - `imageConfig: { aspectRatio, imageSize: '1K' }` — the shape, at the
 *   1K size the per-picture rate is priced at;
 * - `thinkingConfig: { thinkingLevel: 'HIGH' }` — Google's mapping for the
 *   Imagen 4 model this replaces;
 * - `safetySettings` at `BLOCK_MEDIUM_AND_ABOVE` on harassment, hate,
 *   sexually explicit and dangerous content — the "block some" Imagen
 *   defaulted to.
 *
 * Google marks every Gemini image with its invisible SynthID watermark, and
 * its own filters refuse what its policies do not allow — among them
 * photorealistic depictions of children or celebrities that violate them —
 * whatever is asked. Neither is a setting here.
 */

export const VERTEX_IMAGE_PROJECT_ENV = 'AI_IMAGE_VERTEX_PROJECT'
export const VERTEX_IMAGE_LOCATION_ENV = 'AI_IMAGE_VERTEX_LOCATION'
export const VERTEX_IMAGE_MODEL_ENV = 'AI_IMAGE_MODEL'

/** The location requests go to when the operator names none: Google's global endpoint. */
export const VERTEX_IMAGE_DEFAULT_LOCATION = 'global'

/** The model a request runs on when the operator names none. */
export const VERTEX_IMAGE_DEFAULT_MODEL = AI_IMAGE_DEFAULT_MODEL

/** How long one picture may take, thinking included. */
export const VERTEX_IMAGE_TIMEOUT_MS = 50_000

/** The harm categories every request filters at "block some". */
export const VERTEX_IMAGE_SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
] as const

/** A Google Cloud project id: 6–30 lowercase letters, digits and hyphens. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
/** `global`, or a Vertex AI region such as `us-central1`. */
const LOCATION = /^(global|[a-z]+-[a-z]+[0-9]+)$/
/** A publisher model id, `gemini-3.1-flash-image`. */
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,62}$/

/** The finish reasons that mean the picture was withheld rather than failed. */
const WITHHELD_FINISH = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'IMAGE_PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'IMAGE_RECITATION',
  'IMAGE_OTHER',
  'NO_IMAGE',
])

function envValue(name: string): string {
  return process.env[name]?.trim() ?? ''
}

/** The configured project, or `null` when the provider is off. */
export function vertexImageProject(): string | null {
  const project = envValue(VERTEX_IMAGE_PROJECT_ENV)
  return PROJECT_ID.test(project) ? project : null
}

/** The configured location; the global endpoint when unset or malformed. */
export function vertexImageLocation(): string {
  const location = envValue(VERTEX_IMAGE_LOCATION_ENV)
  return LOCATION.test(location) ? location : VERTEX_IMAGE_DEFAULT_LOCATION
}

/** The configured model; the default when unset or malformed. */
export function vertexImageModel(): string {
  const model = envValue(VERTEX_IMAGE_MODEL_ENV)
  return MODEL_ID.test(model) ? model : VERTEX_IMAGE_DEFAULT_MODEL
}

/** The host a request goes to: the global endpoint's, or a region's. */
export function vertexImageHost(location = vertexImageLocation()): string {
  return location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
}

/** The `:generateContent` address for a model. */
export function vertexImageUrl(project: string, location: string, model: string): string {
  return (
    `https://${vertexImageHost(location)}/v1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`
  )
}

/** The request body for one picture, exactly as it is sent. */
export function vertexImageRequestBody(
  request: Pick<AiImageRequest, 'prompt' | 'aspectRatio'>,
): Record<string, unknown> {
  return {
    contents: [{ role: 'USER', parts: [{ text: request.prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      candidateCount: 1,
      imageConfig: { aspectRatio: request.aspectRatio, imageSize: '1K' },
      thinkingConfig: { thinkingLevel: 'HIGH' },
    },
    safetySettings: VERTEX_IMAGE_SAFETY_CATEGORIES.map((category) => ({
      category,
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    })),
  }
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** One answer, read: its picture, why it was withheld, and what it spent. */
export interface VertexImageAnswer {
  image: AiGeneratedImage | null
  /** The finish or block reason, when no picture came back. */
  withheld: string | null
  usage: AiUsage
}

/**
 * The picture in a `:generateContent` answer. A prompt the filter blocked
 * carries `promptFeedback.blockReason`; a picture the filter withheld carries
 * a finish reason such as `IMAGE_SAFETY`; a model that declined answers in
 * text with `STOP` and no picture. All three are a withheld picture.
 */
export function parseVertexImageAnswer(body: unknown): VertexImageAnswer {
  const answer = (body ?? {}) as Record<string, any>
  const meta = (answer['usageMetadata'] ?? {}) as Record<string, unknown>
  const usage: AiUsage = {
    inputTokens: aiTokenCount(meta['promptTokenCount']),
    // The thinking only: the picture's own tokens are priced per picture.
    outputTokens: aiTokenCount(meta['thoughtsTokenCount']),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  const blocked = answer['promptFeedback']?.['blockReason']
  if (typeof blocked === 'string' && blocked) {
    return { image: null, withheld: blocked, usage }
  }
  const candidate = Array.isArray(answer['candidates']) ? answer['candidates'][0] : null
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
  for (const part of parts) {
    const inline = part?.inlineData
    const data = typeof inline?.data === 'string' ? inline.data : ''
    const mimeType = typeof inline?.mimeType === 'string' ? inline.mimeType : ''
    if (data && IMAGE_TYPES.has(mimeType)) {
      return { image: { base64: data, mimeType }, withheld: null, usage }
    }
  }
  const finish = typeof candidate?.finishReason === 'string' ? candidate.finishReason : ''
  return {
    image: null,
    withheld: WITHHELD_FINISH.has(finish) ? finish : finish ? `${finish}_NO_IMAGE` : 'NO_IMAGE',
    usage,
  }
}

/** An access token for the platform's own service account, or `null`. */
async function serviceAccountAccessToken(): Promise<string | null> {
  // The default app, initialized by the platform's firebase-admin module on
  // first use; its credential is the one Web Risk's token comes from.
  firebaseAdmin.app()
  const credential = getApp().options.credential
  if (!credential) return null
  const token = await credential.getAccessToken()
  return token?.access_token ?? null
}

export interface VertexImageProviderOptions {
  fetch?: typeof fetch
  accessToken?: () => Promise<string | null>
  timeoutMs?: number
}

const addUsage = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/** The adapter, with its network and its credential injectable for a spec. */
export function createVertexImageProvider(
  options: VertexImageProviderOptions = {},
): AiImageProvider {
  async function one(
    url: string,
    token: string,
    request: AiImageRequest,
  ): Promise<VertexImageAnswer> {
    let response: Response
    try {
      response = await (options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(vertexImageRequestBody(request)),
        signal: AbortSignal.timeout(options.timeoutMs ?? VERTEX_IMAGE_TIMEOUT_MS),
      })
    } catch {
      // No answer at all — a timeout or a network fault — is ours to retry.
      throw new AiUpstreamError(null, true, null)
    }
    const requestId = response.headers.get('x-goog-request-id') ?? null
    if (!response.ok) {
      const status = response.status
      const detail = await response.text().catch(() => '')
      console.error('vertex image request failed', {
        status,
        requestId,
        detail: detail.slice(0, 500),
      })
      throw new AiUpstreamError(
        status,
        status === 429 || status >= 500,
        requestId,
        status === 401 || status === 403 ? 'credentials' : null,
      )
    }
    return parseVertexImageAnswer(await response.json().catch(() => null))
  }

  return {
    id: AI_IMAGE_VERTEX_PROVIDER_ID,
    label: 'Google Vertex AI',
    defaultModel: vertexImageModel,
    configured: () => vertexImageProject() !== null,
    endpointHost: () => vertexImageHost(),
    async generate(request: AiImageRequest): Promise<AiImageResult> {
      const project = vertexImageProject()
      if (!project) throw new AiUpstreamError(null, false, null, 'credentials')
      const token = await (options.accessToken ?? serviceAccountAccessToken)()
      if (!token) throw new AiUpstreamError(null, false, null, 'credentials')
      const url = vertexImageUrl(project, vertexImageLocation(), request.model)
      const count = Math.min(AI_IMAGE_MAX_COUNT, Math.max(1, Math.floor(request.count)))
      // One request per picture, side by side: a Gemini image request answers
      // with one picture, and four in a row would outlast the door.
      const settled = await Promise.allSettled(
        Array.from({ length: count }, () => one(url, token, request)),
      )
      const answers = settled.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : []))
      const failure = settled.find((entry) => entry.status === 'rejected') as
        | PromiseRejectedResult
        | undefined
      const images = answers.flatMap((answer) => (answer.image ? [answer.image] : []))
      const withheld = answers.flatMap((answer) => (answer.withheld ? [answer.withheld] : []))
      const usage = answers.reduce<AiUsage>((sum, answer) => addUsage(sum, answer.usage), {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
      if (!images.length) {
        // Every picture failed for us: the fault is the answer. Every picture
        // was withheld: the filter's decline is.
        if (failure && !withheld.length) throw failure.reason
        throw new AiImageSafetyRefusal(withheld)
      }
      return {
        model: request.model,
        images,
        filtered: count - images.length,
        usage,
      }
    },
  }
}

/** The adapter the Media door uses. */
export const vertexImageProvider: AiImageProvider = createVertexImageProvider()
