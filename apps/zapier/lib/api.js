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

'use strict'

/**
 * How the Zapier app reaches Aglyn's REST API (AGL-3643): the base URL, the
 * merchant's API key on every request, and Aglyn's error envelope turned
 * into the errors Zapier shows.
 *
 * The base URL is Aglyn's own unless the app's environment says otherwise
 * (`zapier env:set <version> AGLYN_API_URL=https://console.example.com/api`),
 * so an operator running Aglyn themselves publishes the same app pointed at
 * their console.
 */

const DEFAULT_API_URL = 'https://app.aglyn.com/api'

/** The full URL of a `/v1` path. */
function apiUrl(path) {
  const base = String(process.env.AGLYN_API_URL || DEFAULT_API_URL).replace(/\/+$/, '')
  return `${base}${path}`
}

/** A path segment, escaped. */
const seg = (value) => encodeURIComponent(String(value == null ? '' : value).trim())

/** `beforeRequest`: the merchant's key, as a bearer token. */
function includeApiKey(request, z, bundle) {
  request.headers = request.headers || {}
  if (bundle.authData && bundle.authData.apiKey) {
    request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`
  }
  request.headers.Accept = 'application/json'
  return request
}

function headerOf(response, name) {
  if (typeof response.getHeader === 'function') return response.getHeader(name)
  const headers = response.headers || {}
  return headers[name] || headers[name.toLowerCase()]
}

/**
 * `afterResponse`: Aglyn answers `{ error: { type, message, code } }`. A
 * revoked or wrong key asks the user to reconnect; a rate limit asks Zapier
 * to wait as long as Aglyn said; anything else shows Aglyn's own sentence.
 * A request made with `skipThrowForStatus` reads its own status.
 */
function handleErrors(response, z) {
  if (response.request && response.request.skipThrowForStatus) return response
  if (response.status < 400) return response
  return throwAglynError(response, z)
}

/** Throws the Zapier error for an Aglyn refusal. */
function throwAglynError(response, z) {
  const error = (response.data && response.data.error) || {}
  const message = error.message || `Aglyn answered ${response.status}`
  if (response.status === 401) {
    throw new z.errors.ExpiredAuthError(`${message}. Reconnect Aglyn with a current API key.`)
  }
  if (response.status === 429) {
    const wait = Number(headerOf(response, 'retry-after'))
    throw new z.errors.ThrottledError(message, Number.isFinite(wait) && wait > 0 ? wait : 60)
  }
  throw new z.errors.Error(message, error.code || error.type || 'AglynError', response.status)
}

/** Currencies whose smallest unit is the whole unit (Stripe's list). */
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
])

/**
 * An amount in a currency's smallest unit as a decimal string — `2290` USD
 * cents as `"22.90"` — for a step that wants money, not cents. `null` when
 * there is no amount.
 */
function decimalAmount(cents, currency) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null
  const zero = ZERO_DECIMAL.has(String(currency || '').toLowerCase())
  return zero ? String(Math.round(Number(cents))) : (Number(cents) / 100).toFixed(2)
}

/** The rows of a `/v1` list. */
const rowsOf = (response) => (response.data && Array.isArray(response.data.data) ? response.data.data : [])

module.exports = {
  DEFAULT_API_URL,
  apiUrl,
  decimalAmount,
  handleErrors,
  includeApiKey,
  rowsOf,
  seg,
  throwAglynError,
}
