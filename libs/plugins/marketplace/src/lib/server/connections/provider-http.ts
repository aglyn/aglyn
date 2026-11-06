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

import {
  preparePluginConnectionRequest,
  readPluginConnectionPath,
  type PluginConnectionDeclaration,
  type PluginConnectionRequest,
  type PluginConnectionResource,
} from '@aglyn/aglyn/app-utils/plugin-connections'
import type { PluginConnectionChoice } from '../../model/plugin-connections'

/**
 * HOW THE PLATFORM TALKS TO A DECLARED CONNECTION'S PROVIDER (AGL-4193).
 *
 * Every outbound request a connection causes goes through here: the code
 * exchange and the refresh at the declared `tokenUrl`, the revoke at the
 * declared `revocationUrl`, and the templated API requests, which
 * `preparePluginConnectionRequest` refuses to send anywhere but the declared
 * `apiHosts`. One runtime object holds the fetch, the clock and the sleep, so
 * a spec swaps them in one place and no request leaves the process.
 *
 * Redirects are NOT followed: a provider answering a token or API request
 * with a redirect would otherwise carry the grant to a host nobody declared.
 * Answers are read up to a ceiling, so a hostile or broken endpoint cannot
 * make the console buffer an unbounded body.
 */

export interface PluginConnectionRuntime {
  fetch: typeof fetch
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const pluginConnectionRuntime: PluginConnectionRuntime = {
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** Why a provider call failed: the grant is gone (`auth`), try later (`transient`), or the answer is unusable (`refused`). */
export type PluginConnectionErrorCode = 'auth' | 'transient' | 'refused'

export class PluginConnectionProviderError extends Error {
  constructor(
    readonly code: PluginConnectionErrorCode,
    message: string,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'PluginConnectionProviderError'
  }
}

/** The publisher's OAuth app, opened from its sealed record. */
export interface PluginConnectionClient {
  clientId: string
  clientSecret: string
}

/** A token endpoint's answer, normalized. */
export interface PluginConnectionTokenSet {
  accessToken: string
  /** `null` when the provider issued none (or kept the one it issued before). */
  refreshToken: string | null
  /** Epoch ms; an hour from now when the provider did not say. */
  accessExpiresAtMs: number
  /** The scopes granted, when the provider said; else the ones asked for. */
  scopes: string[]
}

/** Bytes of an answer read at most. */
export const PLUGIN_CONNECTION_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const ATTEMPT_TIMEOUT_MS = 30_000
const RETRIES = 2
const BASE_BACKOFF_MS = 500
const DEFAULT_ACCESS_LIFETIME_MS = 60 * 60 * 1000

/** Reads an answer's body, refusing one past the ceiling. */
async function readBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > PLUGIN_CONNECTION_MAX_RESPONSE_BYTES) {
    throw new PluginConnectionProviderError('refused', 'The provider’s answer is too large.', response.status)
  }
  const text = await response.text()
  if (text.length > PLUGIN_CONNECTION_MAX_RESPONSE_BYTES) {
    throw new PluginConnectionProviderError('refused', 'The provider’s answer is too large.', response.status)
  }
  return text
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The provider's own sentence for a refusal, cut short; never a token. */
function providerSentence(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record['error_description'] === 'string') return record['error_description'].slice(0, 300)
    const error = record['error']
    if (typeof error === 'string') return error.slice(0, 300)
    if (error && typeof error === 'object' && typeof (error as Record<string, unknown>)['message'] === 'string') {
      return String((error as Record<string, unknown>)['message']).slice(0, 300)
    }
  }
  return `HTTP ${status}`
}

const retryable = (status: number) => status === 429 || status >= 500

/** One request: no redirects, a timeout per attempt, a throttle or server error retried. */
async function send(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    let response: Response | null = null
    try {
      response = await pluginConnectionRuntime.fetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      })
    } catch (error) {
      lastError = error
    }
    if (response && !retryable(response.status)) {
      if (response.status >= 300 && response.status < 400) {
        throw new PluginConnectionProviderError('refused', 'The provider answered with a redirect, which is not followed.', response.status)
      }
      return { status: response.status, body: parseJson(await readBody(response)) }
    }
    if (attempt === RETRIES) {
      if (response) {
        const body = parseJson(await readBody(response).catch(() => ''))
        throw new PluginConnectionProviderError('transient', providerSentence(body, response.status), response.status)
      }
      break
    }
    await pluginConnectionRuntime.sleep(BASE_BACKOFF_MS * 2 ** attempt)
  }
  throw new PluginConnectionProviderError(
    'transient',
    `The provider could not be reached: ${String((lastError as Error)?.message ?? lastError).slice(0, 200)}`,
  )
}

/** The token endpoint's answer, or the refusal: `invalid_grant` and a 401 mean the grant is gone. */
function readTokenAnswer(
  answer: { status: number; body: unknown },
  connection: PluginConnectionDeclaration,
): PluginConnectionTokenSet {
  const body = (answer.body && typeof answer.body === 'object' ? answer.body : {}) as Record<string, unknown>
  if (answer.status < 200 || answer.status >= 300 || typeof body['access_token'] !== 'string' || !body['access_token']) {
    const sentence = providerSentence(body, answer.status)
    const grantGone = body['error'] === 'invalid_grant' || answer.status === 401 || body['error'] === 'unauthorized_client'
    throw new PluginConnectionProviderError(grantGone ? 'auth' : 'refused', sentence, answer.status)
  }
  const expiresIn = Number(body['expires_in'])
  const scope = typeof body['scope'] === 'string' ? body['scope'] : ''
  return {
    accessToken: body['access_token'],
    refreshToken: typeof body['refresh_token'] === 'string' && body['refresh_token'] ? body['refresh_token'] : null,
    accessExpiresAtMs:
      pluginConnectionRuntime.now() +
      (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : DEFAULT_ACCESS_LIFETIME_MS),
    scopes: scope ? scope.split(/[\s,]+/).filter(Boolean) : [...connection.scopes],
  }
}

/** Posts a form to the declared token endpoint, authenticating the publisher's app as declared. */
async function postToken(
  connection: PluginConnectionDeclaration,
  client: PluginConnectionClient,
  fields: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const form = new URLSearchParams(fields)
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }
  if (connection.tokenAuthMethod === 'basic') {
    const pair = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`
    headers['Authorization'] = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`
  } else {
    form.set('client_id', client.clientId)
    form.set('client_secret', client.clientSecret)
  }
  return send(connection.tokenUrl, { method: 'POST', headers, body: form.toString() })
}

/** Exchanges an authorization code at the declared token endpoint. */
export async function exchangePluginConnectionCode(
  connection: PluginConnectionDeclaration,
  client: PluginConnectionClient,
  input: { code: string; redirectUri: string },
): Promise<PluginConnectionTokenSet> {
  const answer = await postToken(connection, client, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  })
  return readTokenAnswer(answer, connection)
}

/** Refreshes a grant at the declared token endpoint. */
export async function refreshPluginConnectionToken(
  connection: PluginConnectionDeclaration,
  client: PluginConnectionClient,
  refreshToken: string,
): Promise<PluginConnectionTokenSet> {
  const answer = await postToken(connection, client, { grant_type: 'refresh_token', refresh_token: refreshToken })
  return readTokenAnswer(answer, connection)
}

/** Revokes a grant at the declared revocation endpoint, when there is one. Best effort; throws on failure. */
export async function revokePluginConnectionToken(
  connection: PluginConnectionDeclaration,
  client: PluginConnectionClient | null,
  token: string,
): Promise<boolean> {
  if (!connection.revocationUrl) return false
  const form = new URLSearchParams({ token })
  if (client && connection.tokenAuthMethod !== 'basic') {
    form.set('client_id', client.clientId)
    form.set('client_secret', client.clientSecret)
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (client && connection.tokenAuthMethod === 'basic') {
    const pair = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`
    headers['Authorization'] = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`
  }
  const answer = await send(connection.revocationUrl, { method: 'POST', headers, body: form.toString() })
  if (answer.status >= 200 && answer.status < 300) return true
  throw new PluginConnectionProviderError('refused', providerSentence(answer.body, answer.status), answer.status)
}

/**
 * One templated API request with the site's access token, filled from its
 * choices; answers the parsed JSON. A 401 or 403 is `auth` (the caller may
 * refresh once and retry), anything else not 2xx is `refused`.
 */
export async function pluginConnectionApiRequest(
  connection: PluginConnectionDeclaration,
  request: PluginConnectionRequest,
  input: { accessToken: string; choices: Readonly<Record<string, string>>; cursor?: string | null },
): Promise<unknown> {
  const prepared = preparePluginConnectionRequest(request, {
    apiHosts: connection.apiHosts,
    choices: input.choices,
    cursor: input.cursor ?? null,
  })
  if (prepared.ok === false) throw new PluginConnectionProviderError('refused', prepared.error)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    Accept: 'application/json',
  }
  if (prepared.request.body !== undefined) headers['Content-Type'] = 'application/json'
  const answer = await send(prepared.request.url, {
    method: prepared.request.method,
    headers,
    ...(prepared.request.body !== undefined ? { body: prepared.request.body } : {}),
  })
  if (answer.status === 401 || answer.status === 403) {
    throw new PluginConnectionProviderError('auth', providerSentence(answer.body, answer.status), answer.status)
  }
  if (answer.status < 200 || answer.status >= 300) {
    throw new PluginConnectionProviderError('refused', providerSentence(answer.body, answer.status), answer.status)
  }
  return answer.body
}

/**
 * Every item of a paginated request, up to `maxItems` and the declared page
 * ceiling. Exported for the sync, which reads its requests the same way.
 */
export async function pluginConnectionApiItems(
  connection: PluginConnectionDeclaration,
  request: PluginConnectionRequest,
  input: { accessToken: string; choices: Readonly<Record<string, string>>; maxItems: number },
): Promise<{ items: unknown[]; pages: unknown[] }> {
  const items: unknown[] = []
  const pages: unknown[] = []
  let cursor: string | null = null
  const maxPages = request.pagination?.maxPages ?? 1
  for (let page = 0; page < maxPages; page += 1) {
    const body = await pluginConnectionApiRequest(connection, request, { ...input, cursor })
    pages.push(body)
    const list = request.itemsPath ? readPluginConnectionPath(body, request.itemsPath) : undefined
    if (Array.isArray(list)) items.push(...list.slice(0, Math.max(0, input.maxItems - items.length)))
    if (items.length >= input.maxItems || !request.pagination) break
    const next = readPluginConnectionPath(body, request.pagination.cursorPath)
    if (typeof next !== 'string' || !next || next.length > 2048 || next === cursor) break
    cursor = next
  }
  return { items, pages }
}

/** The resource's items as the picker shows them: an id and a label, each a plain bounded string. */
export async function listPluginConnectionResource(
  connection: PluginConnectionDeclaration,
  resource: PluginConnectionResource,
  input: { accessToken: string; choices: Readonly<Record<string, string>> },
): Promise<PluginConnectionChoice[]> {
  const { items } = await pluginConnectionApiItems(connection, resource.request, {
    ...input,
    maxItems: resource.maxItems,
  })
  const out: PluginConnectionChoice[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const id = readPluginConnectionPath(item, resource.idPath)
    const label = readPluginConnectionPath(item, resource.labelPath)
    if (typeof id !== 'string' && typeof id !== 'number') continue
    const idText = String(id).slice(0, 256)
    if (!idText || seen.has(idText)) continue
    seen.add(idText)
    out.push({ id: idText, label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 200) : idText })
  }
  return out
}
