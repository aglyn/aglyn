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
import { AI_IMAGE_VERTEX_PROVIDER_ID } from './catalog'
import { AiUpstreamError } from './contract'
import {
  AI_IMAGE_MAX_COUNT,
  AiImageSafetyRefusal,
  type AiGeneratedImage,
  type AiImageProvider,
  type AiImageRequest,
  type AiImageResult,
} from './image-contract'

/**
 * Google's image models on Vertex AI (AGL-3602), behind the image contract:
 * `POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/
 * locations/{location}/publishers/google/models/{model}:predict`.
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
 * billed to, and is the switch: unset, `configured()` is false, the Media
 * door answers 404 and the button never draws. A self-hosted deployment is
 * therefore off until its operator chooses a project, and the host below is
 * reached only once one is named.
 *
 * ⛔ THE ORDER FOR AGLYN'S OWN PRODUCTION, and no check can see it, so this
 * paragraph is the gate: a description reaching Vertex AI makes Google LLC a
 * recipient of customer content for a purpose `/legal/subprocessors` does not
 * name today (its Google rows say database, storage, authentication, backups
 * and logging). Publish that row first — the master, then the page, with a
 * change-log line — then declare the host in the AI catalog with that date as
 * `publishedOn`, and only then set `AI_IMAGE_VERTEX_PROJECT` in production.
 *
 * ## What is sent, and nothing else
 *
 * The description the member typed, the shape and the count. No account,
 * site, organization or member identifier, no other content of the site and
 * no image. Every request asks for:
 *
 * - `safetySetting: block_medium_and_above` — Google's "block some", its
 *   default and the middle of its three thresholds;
 * - `personGeneration: allow_adult` — no pictures of children;
 * - `addWatermark: true` — Google's invisible SynthID mark, so a picture can
 *   later be identified as generated;
 * - `enhancePrompt: false` — the picture is made from the member's own words,
 *   which are also what its alt text is written from;
 * - `includeRaiReason: true` — a picture the filter held back says so, rather
 *   than silently arriving as one fewer;
 * - JPEG at quality 90, which keeps a picture well under the upload route's
 *   body ceiling.
 */

export const VERTEX_IMAGE_PROJECT_ENV = 'AI_IMAGE_VERTEX_PROJECT'
export const VERTEX_IMAGE_LOCATION_ENV = 'AI_IMAGE_VERTEX_LOCATION'
export const VERTEX_IMAGE_MODEL_ENV = 'AI_IMAGE_MODEL'

/** The region requests go to when the operator names none. */
export const VERTEX_IMAGE_DEFAULT_LOCATION = 'us-central1'

/** The model a request runs on when the operator names none. */
export const VERTEX_IMAGE_DEFAULT_MODEL = 'imagen-4.0-generate-001'

/** How long one request may take, generation included. */
export const VERTEX_IMAGE_TIMEOUT_MS = 60_000

/** A Google Cloud project id: 6–30 lowercase letters, digits and hyphens. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
/** A Vertex AI region, `us-central1`, `europe-west4`. */
const LOCATION = /^[a-z]+-[a-z]+[0-9]+$/
/** A publisher model id, `imagen-4.0-generate-001`. */
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,62}$/

function envValue(name: string): string {
  return process.env[name]?.trim() ?? ''
}

/** The configured project, or `null` when the provider is off. */
export function vertexImageProject(): string | null {
  const project = envValue(VERTEX_IMAGE_PROJECT_ENV)
  return PROJECT_ID.test(project) ? project : null
}

/** The configured region; the default when unset or malformed. */
export function vertexImageLocation(): string {
  const location = envValue(VERTEX_IMAGE_LOCATION_ENV)
  return LOCATION.test(location) ? location : VERTEX_IMAGE_DEFAULT_LOCATION
}

/** The configured model; the default when unset or malformed. */
export function vertexImageModel(): string {
  const model = envValue(VERTEX_IMAGE_MODEL_ENV)
  return MODEL_ID.test(model) ? model : VERTEX_IMAGE_DEFAULT_MODEL
}

/** The regional host a request goes to. */
export function vertexImageHost(location = vertexImageLocation()): string {
  return `${location}-aiplatform.googleapis.com`
}

/** The `:predict` address for a model. */
export function vertexImagePredictUrl(project: string, location: string, model: string): string {
  return (
    `https://${vertexImageHost(location)}/v1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${model}:predict`
  )
}

/** The request body for one generation, exactly as it is sent. */
export function vertexImageRequestBody(request: AiImageRequest): Record<string, unknown> {
  return {
    instances: [{ prompt: request.prompt }],
    parameters: {
      sampleCount: Math.min(AI_IMAGE_MAX_COUNT, Math.max(1, Math.floor(request.count))),
      aspectRatio: request.aspectRatio,
      safetySetting: 'block_medium_and_above',
      personGeneration: 'allow_adult',
      addWatermark: true,
      enhancePrompt: false,
      includeRaiReason: true,
      outputOptions: { mimeType: 'image/jpeg', compressionQuality: 90 },
    },
  }
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

/**
 * The pictures in a `:predict` answer, and the reasons any were held back.
 * A prediction with bytes is a picture; one with `raiFilteredReason` and no
 * bytes is a picture the filter withheld.
 */
export function parseVertexImagePredictions(body: unknown): {
  images: AiGeneratedImage[]
  filteredReasons: string[]
} {
  const predictions = (body as { predictions?: unknown } | null)?.predictions
  const images: AiGeneratedImage[] = []
  const filteredReasons: string[] = []
  if (!Array.isArray(predictions)) return { images, filteredReasons }
  for (const prediction of predictions) {
    if (!prediction || typeof prediction !== 'object') continue
    const entry = prediction as Record<string, unknown>
    const base64 = typeof entry['bytesBase64Encoded'] === 'string' ? entry['bytesBase64Encoded'] : ''
    const mimeType = typeof entry['mimeType'] === 'string' ? entry['mimeType'] : 'image/png'
    if (base64 && IMAGE_TYPES.has(mimeType)) {
      images.push({ base64, mimeType })
    } else if (typeof entry['raiFilteredReason'] === 'string') {
      filteredReasons.push(entry['raiFilteredReason'].slice(0, 300))
    }
  }
  return { images, filteredReasons }
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

/** The adapter, with its network and its credential injectable for a spec. */
export function createVertexImageProvider(
  options: VertexImageProviderOptions = {},
): AiImageProvider {
  return {
    id: AI_IMAGE_VERTEX_PROVIDER_ID,
    label: 'Google Vertex AI',
    defaultModel: vertexImageModel,
    configured: () => vertexImageProject() !== null,
    endpointHost: () => vertexImageHost(),
    async generate(request: AiImageRequest): Promise<AiImageResult> {
      const project = vertexImageProject()
      if (!project) throw new AiUpstreamError(null, false, null, 'credentials')
      const location = vertexImageLocation()
      const token = await (options.accessToken ?? serviceAccountAccessToken)()
      if (!token) throw new AiUpstreamError(null, false, null, 'credentials')
      let response: Response
      try {
        response = await (options.fetch ?? fetch)(
          vertexImagePredictUrl(project, location, request.model),
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(vertexImageRequestBody(request)),
            signal: AbortSignal.timeout(options.timeoutMs ?? VERTEX_IMAGE_TIMEOUT_MS),
          },
        )
      } catch {
        // No answer at all — a timeout or a network fault — is ours to retry.
        throw new AiUpstreamError(null, true, null)
      }
      const requestId = response.headers.get('x-goog-request-id') ?? null
      if (!response.ok) {
        const status = response.status
        const detail = await response.text().catch(() => '')
        // A description Google refuses outright answers 400 naming its
        // responsible-AI policy; that is a decline, not a fault.
        if (status === 400 && /responsible ai|safety|policy|blocked/i.test(detail)) {
          throw new AiImageSafetyRefusal([detail.slice(0, 300)])
        }
        console.error('vertex image request failed', { status, requestId, detail: detail.slice(0, 500) })
        throw new AiUpstreamError(
          status,
          status === 429 || status >= 500,
          requestId,
          status === 401 || status === 403 ? 'credentials' : null,
        )
      }
      const body = await response.json().catch(() => null)
      const { images, filteredReasons } = parseVertexImagePredictions(body)
      if (!images.length) throw new AiImageSafetyRefusal(filteredReasons)
      const requested = Math.min(AI_IMAGE_MAX_COUNT, Math.max(1, Math.floor(request.count)))
      return {
        model: request.model,
        images: images.slice(0, requested),
        filtered: Math.max(filteredReasons.length, requested - images.length, 0),
      }
    },
  }
}

/** The adapter the Media door uses. */
export const vertexImageProvider: AiImageProvider = createVertexImageProvider()
