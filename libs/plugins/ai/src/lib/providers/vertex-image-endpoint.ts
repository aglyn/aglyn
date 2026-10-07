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

import { AI_IMAGE_DEFAULT_MODEL } from './catalog'

/**
 * Where a Vertex AI image request goes (AGL-3602): the operator's settings
 * and the address they make, with nothing that authenticates or sends. Kept
 * apart from the adapter so the subprocessor declarations, which the manifest
 * generator loads outside any app, can name the host without loading the
 * platform's service-account credential.
 */

export const VERTEX_IMAGE_PROJECT_ENV = 'AI_IMAGE_VERTEX_PROJECT'
export const VERTEX_IMAGE_LOCATION_ENV = 'AI_IMAGE_VERTEX_LOCATION'
export const VERTEX_IMAGE_MODEL_ENV = 'AI_IMAGE_MODEL'

/** The location requests go to when the operator names none: Google's global endpoint. */
export const VERTEX_IMAGE_DEFAULT_LOCATION = 'global'

/** The model a request runs on when the operator names none. */
export const VERTEX_IMAGE_DEFAULT_MODEL = AI_IMAGE_DEFAULT_MODEL

/** A Google Cloud project id: 6–30 lowercase letters, digits and hyphens. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
/** `global`, or a Vertex AI region such as `us-central1`. */
const LOCATION = /^(global|[a-z]+-[a-z]+[0-9]+)$/
/** A publisher model id, `gemini-3.1-flash-image`. */
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,62}$/

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

/**
 * The global endpoint's origin, written as a URL so the subprocessor
 * inventory's sweep of outbound hosts sees the host this module reaches.
 */
const VERTEX_IMAGE_GLOBAL_ORIGIN = 'https://aiplatform.googleapis.com'

/** The host a request goes to: the global endpoint's, or a region's. */
export function vertexImageHost(location = vertexImageLocation()): string {
  return location === 'global'
    ? new URL(VERTEX_IMAGE_GLOBAL_ORIGIN).host
    : `${location}-aiplatform.googleapis.com`
}

/** The `:generateContent` address for a model. */
export function vertexImageUrl(project: string, location: string, model: string): string {
  return (
    `https://${vertexImageHost(location)}/v1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`
  )
}

/**
 * The host the published subprocessor row names: the global endpoint's. A
 * regional location is a different host in a single region, which that row
 * does not describe.
 */
export const VERTEX_IMAGE_PUBLISHED_HOST = vertexImageHost(VERTEX_IMAGE_DEFAULT_LOCATION)
