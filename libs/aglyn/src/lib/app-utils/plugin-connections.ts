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

/**
 * DECLARED CONNECTIONS: THE MANIFEST'S `connections` BLOCK (AGL-4193).
 *
 * A marketplace plugin's code runs in a sandbox, never on the platform's
 * servers, so it cannot hold an OAuth grant, refresh it, or call a provider's
 * API on a schedule. A connection is the plugin DECLARING all of that as data
 * instead: which provider to send the site owner to, which hosts the platform
 * may call with the grant, how the owner picks what to connect (an account,
 * then one of its locations), and how a scheduled fetch maps the provider's
 * answer into a small, typed, public record the plugin's element then reads.
 * The platform runs the OAuth dance with the publisher's own OAuth app, keeps
 * the tokens sealed, and makes every request itself. Third-party code never
 * sees a token.
 *
 * Everything here is publisher-authored data that the platform turns into
 * outbound requests carrying a customer's token, so it is bounded hard:
 *
 *   - every URL is https, with no credentials, query or fragment where none
 *     belongs, and never an IP literal or `localhost`;
 *   - every request a template describes must land on a host the connection
 *     lists in `apiHosts`, checked again after the template is filled in;
 *   - a wildcard host covers exactly ONE label (`*.example.com`);
 *   - every list, string, page count and record has a ceiling.
 *
 * Pure: no Node, no Firestore, no React. The manifest validator, the bundle
 * checker (and the local CLI built from it), the connect routes and the sync
 * all read this one module, so a declaration cannot pass one and fail another.
 */

import type { HostVariable, HostVariableType } from './variables'

/** A request method a template may use. */
export type PluginConnectionMethod = 'GET' | 'POST'

/** How the platform authenticates the publisher's OAuth app at the token endpoint. */
export type PluginConnectionTokenAuthMethod = 'body' | 'basic'

/** Cursor pagination: the answer names the next page's cursor, a query parameter carries it back. */
export interface PluginConnectionPagination {
  /** Dot path, in the answer, to the next page's cursor (`nextPageToken`). */
  cursorPath: string
  /** The query parameter the cursor is sent back in (`pageToken`). */
  cursorParam: string
  /** Pages fetched at most, 1 to {@link PLUGIN_CONNECTION_MAX_PAGES}. */
  maxPages: number
}

/**
 * One request the platform makes with a connection's token.
 *
 * `url`, every `query` value and every string `body` value may carry
 * `{{resource.<id>}}`, filled with the id the site owner chose for that
 * resource. Placeholders may appear in the path and the query only, never in
 * the scheme or the host, and the filled-in URL is checked against
 * `apiHosts` again before anything is sent.
 */
export interface PluginConnectionRequest {
  method: PluginConnectionMethod
  url: string
  query?: Record<string, string>
  /** A flat JSON body, POST only. */
  body?: Record<string, string | number | boolean>
  /** Dot path to the array of items in the answer. */
  itemsPath?: string
  pagination?: PluginConnectionPagination
}

/**
 * Something the site owner picks after connecting: an account, a location.
 * Resources are ordered, and a later one's request may name an earlier one's
 * choice (`{{resource.accounts}}`), which is how a picker chains.
 */
export interface PluginConnectionResource {
  /** Identifier, unique within the connection (`accounts`). */
  id: string
  /** What one of them is called in the picker (`Account`). */
  label: string
  /** The list request. `itemsPath` is required. */
  request: PluginConnectionRequest & { itemsPath: string }
  /** Dot path, in each item, to its id (`name`). */
  idPath: string
  /** Dot path, in each item, to what the picker shows (`accountName`). */
  labelPath: string
  /** Items listed at most, across every page. */
  maxItems: number
}

/** The type a record field is coerced to. */
export type PluginConnectionFieldType = 'string' | 'number' | 'boolean' | 'datetime' | 'url'

/** One field of the public record, read from an answer by path. */
export interface PluginConnectionRecordField {
  type: PluginConnectionFieldType
  /** Dot path to the value: in the request's answer, or in an item. */
  path: string
  /** Required for `string` and `url`: the value is cut to this many characters. */
  maxLength?: number
  /**
   * Values to translate before coercion (`{ "FIVE": 5 }`). A value not in
   * the map is dropped, so a provider adding a value cannot leak it raw.
   */
  map?: Record<string, string | number | boolean>
}

/** A summary field of the record: which sync request it reads from, and where. */
export interface PluginConnectionSummaryField extends PluginConnectionRecordField {
  /** The sync request id whose answer holds it. */
  request: string
}

/** The record's list: one entry per item of a sync request's answer. */
export interface PluginConnectionRecordItems {
  /** The sync request whose `itemsPath` items become entries. */
  request: string
  /** Entries kept at most. */
  maxItems: number
  /** Fields of each entry, read relative to the item. */
  fields: Record<string, PluginConnectionRecordField>
}

/**
 * The PUBLIC record a sync writes for a site: what the plugin's element reads.
 * Public by design, so nothing in it may be secret, and it is typed and
 * bounded so the record can never grow past what was declared.
 */
export interface PluginConnectionRecordSchema {
  fields?: Record<string, PluginConnectionSummaryField>
  items?: PluginConnectionRecordItems
}

/** A sync request: a request with an id the record schema names it by. */
export interface PluginConnectionSyncRequest extends PluginConnectionRequest {
  id: string
}

/** The scheduled fetch the platform runs for every connected site. */
export interface PluginConnectionSync {
  /** Hours between runs, at least {@link PLUGIN_CONNECTION_MIN_INTERVAL_HOURS}. */
  intervalHours: number
  requests: PluginConnectionSyncRequest[]
  record: PluginConnectionRecordSchema
}

/** One declared connection. */
export interface PluginConnectionDeclaration {
  /** Identifier, unique within the manifest; persisted, never renamed. */
  id: string
  /** The provider's id (`google`); a label for people and logs, never a code path. */
  provider: string
  /** What the console calls it (`Google Business Profile`). */
  label: string
  description?: string
  authorizationUrl: string
  tokenUrl: string
  /** Where a grant is revoked on disconnect, when the provider has one. */
  revocationUrl?: string
  scopes: string[]
  /** How scopes are joined in the authorization request; a space by default. */
  scopeSeparator?: ' ' | ','
  /** Extra authorization parameters (`access_type=offline`). Reserved names are refused. */
  authParams?: Record<string, string>
  /** `body` (client_secret_post, the default) or `basic` (client_secret_basic). */
  tokenAuthMethod?: PluginConnectionTokenAuthMethod
  /** The hosts the platform may call with this connection's token. */
  apiHosts: string[]
  resources?: PluginConnectionResource[]
  sync?: PluginConnectionSync
}

/* ------------------------------------------------------------------ */
/* Bounds                                                               */
/* ------------------------------------------------------------------ */

export const PLUGIN_CONNECTION_MAX = 4
export const PLUGIN_CONNECTION_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/
export const PLUGIN_CONNECTION_MAX_SCOPES = 20
export const PLUGIN_CONNECTION_MAX_API_HOSTS = 10
export const PLUGIN_CONNECTION_MAX_AUTH_PARAMS = 10
export const PLUGIN_CONNECTION_MAX_RESOURCES = 3
export const PLUGIN_CONNECTION_MAX_RESOURCE_ITEMS = 200
export const PLUGIN_CONNECTION_MAX_SYNC_REQUESTS = 3
export const PLUGIN_CONNECTION_MAX_PAGES = 10
export const PLUGIN_CONNECTION_MIN_INTERVAL_HOURS = 1
export const PLUGIN_CONNECTION_MAX_INTERVAL_HOURS = 168
export const PLUGIN_CONNECTION_MAX_RECORD_FIELDS = 20
export const PLUGIN_CONNECTION_MAX_RECORD_ITEMS = 100
export const PLUGIN_CONNECTION_MAX_STRING_LENGTH = 5000
export const PLUGIN_CONNECTION_MAX_URL_LENGTH = 2048
export const PLUGIN_CONNECTION_MAX_MAP_ENTRIES = 32
/** The whole block, serialized: a ceiling on everything the lists above multiply to. */
export const PLUGIN_CONNECTION_MAX_DECLARATION_CHARS = 32_000
/**
 * `capabilities.imageHosts`, at most (AGL-4195). Each one widens the `img-src`
 * of every site that installs the plugin, so the list is kept short.
 */
export const PLUGIN_MAX_IMAGE_HOSTS = 5

const TEXT_MAX = 300
const LABEL_MAX = 80
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
const PATH_SEGMENT = /^[A-Za-z0-9_$-]{1,64}$/
const PATH_MAX_SEGMENTS = 8
const SCOPE = /^[!#-[\]-~]{1,200}$/
const PARAM_NAME = /^[A-Za-z0-9_.-]{1,40}$/
const PARAM_VALUE_MAX = 200
const TEMPLATE_VALUE_MAX = 500
const BODY_MAX_KEYS = 20
const QUERY_MAX_KEYS = 10
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g
const RESOURCE_PLACEHOLDER = /^resource\.([A-Za-z][A-Za-z0-9_]{0,31})$/
const FIELD_TYPES: readonly PluginConnectionFieldType[] = ['string', 'number', 'boolean', 'datetime', 'url']

/**
 * Authorization parameters the platform sets itself. A declaration naming one
 * would replace the platform's own client id, redirect, state or scope.
 */
export const PLUGIN_CONNECTION_RESERVED_AUTH_PARAMS: readonly string[] = [
  'client_id',
  'client_secret',
  'redirect_uri',
  'response_type',
  'state',
  'scope',
  'code',
  'code_challenge',
  'code_challenge_method',
  'nonce',
]

/* ------------------------------------------------------------------ */
/* Hosts and URLs                                                       */
/* ------------------------------------------------------------------ */

const isIpLiteral = (hostname: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[')

/**
 * Whether `hostname` is a usable public hostname: lowercase labels, at least two
 * of them, no IP literal, no `localhost`.
 */
function isPublicHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253 || isIpLiteral(hostname)) return false
  const labels = hostname.split('.')
  if (labels.length < 2) return false
  if (labels.some((label) => !HOST_LABEL.test(label))) return false
  const tld = labels[labels.length - 1]
  if (/^\d+$/.test(tld)) return false
  return !(hostname === 'localhost' || hostname.endsWith('.localhost') || tld === 'local' || tld === 'internal')
}

/**
 * A host pattern: an exact public hostname (`api.example.com`), or one whose
 * first label is a lone `*` over at least two more labels (`*.example.com`).
 * Anything wider — `*.com`, `*.*.example.com`, `*api.example.com` — is refused.
 */
export function isPluginConnectionHostPattern(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value !== value.toLowerCase()) return false
  if (value.startsWith('*.')) {
    const rest = value.slice(2)
    return !rest.includes('*') && isPublicHostname(rest) && rest.split('.').length >= 2
  }
  return !value.includes('*') && isPublicHostname(value)
}

/** Whether `hostname` is covered by `pattern` (exact, or a one-label wildcard). */
export function pluginConnectionHostMatches(pattern: string, hostname: string): boolean {
  const candidate = hostname.toLowerCase()
  if (!pattern.startsWith('*.')) return candidate === pattern
  const rest = pattern.slice(1) // `.example.com`
  if (!candidate.endsWith(rest)) return false
  const label = candidate.slice(0, candidate.length - rest.length)
  return HOST_LABEL.test(label)
}

/** Whether a URL may be called with a connection's token: https, on a listed host, no credentials. */
export function isPluginConnectionUrlAllowed(url: string, apiHosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false
  if (parsed.hash) return false
  return apiHosts.some((pattern) => pluginConnectionHostMatches(pattern, parsed.hostname))
}

/** An OAuth endpoint: https, a public host, no credentials, port, query or fragment. */
function endpointError(value: unknown, name: string): string | null {
  if (typeof value !== 'string' || !value || value.length > PLUGIN_CONNECTION_MAX_URL_LENGTH) {
    return `${name} must be an https URL`
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return `${name} must be an https URL`
  }
  if (parsed.protocol !== 'https:') return `${name} must be an https URL`
  if (parsed.username || parsed.password || parsed.port) return `${name} must not carry credentials or a port`
  if (parsed.search || parsed.hash || value.includes('?') || value.includes('#')) {
    return `${name} must not carry a query or fragment (declare authorization parameters in authParams)`
  }
  if (!isPublicHostname(parsed.hostname)) return `${name} must name a public host`
  if (value.includes('{{')) return `${name} must not carry placeholders`
  return null
}

/** The host of an endpoint URL already validated, for the bundle checker. */
export function pluginConnectionEndpointHosts(connection: PluginConnectionDeclaration): string[] {
  const hosts = new Set<string>()
  for (const url of [connection.authorizationUrl, connection.tokenUrl, connection.revocationUrl]) {
    if (!url) continue
    try {
      hosts.add(new URL(url).hostname)
    } catch {
      // Validated already; nothing to add.
    }
  }
  return [...hosts]
}

/* ------------------------------------------------------------------ */
/* Paths and templates                                                  */
/* ------------------------------------------------------------------ */

/** Whether `value` is a dot path of plain segments (`reviewer.displayName`, `items.0.id`). */
export function isPluginConnectionPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  const segments = value.split('.')
  return segments.length <= PATH_MAX_SEGMENTS && segments.every((segment) => PATH_SEGMENT.test(segment))
}

/**
 * Reads a dot path out of a parsed JSON answer. Own properties only, so a
 * path can never reach `__proto__` or anything else an object inherits.
 */
export function readPluginConnectionPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      current = current[Number(segment)]
      continue
    }
    if (typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** The resource ids a template string names, or an error for any other placeholder. */
function templateRefs(value: string): { refs: string[] } | { error: string } {
  const refs: string[] = []
  for (const match of value.matchAll(PLACEHOLDER)) {
    const inner = match[1] ?? ''
    const resource = RESOURCE_PLACEHOLDER.exec(inner)
    if (!resource) return { error: `unknown placeholder "{{${inner}}}" (only {{resource.<id>}} is filled in)` }
    refs.push(resource[1])
  }
  // A brace left over is a placeholder that did not parse.
  const stripped = value.replace(PLACEHOLDER, '')
  if (stripped.includes('{{') || stripped.includes('}}')) return { error: 'a placeholder is not closed' }
  return { refs }
}

/**
 * A choice a site owner made, safe to put in a URL path or query: printable,
 * no `..`, nothing that could end the path or start a query, fragment,
 * credential or percent-escape.
 */
export function isPluginConnectionChoiceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._~:/-]{1,256}$/.test(value) &&
    !value.split('/').some((segment) => segment === '..' || segment === '.') &&
    !value.startsWith('/') &&
    !value.includes('//')
  )
}

/** A filled-in request, ready to send. */
export interface PluginConnectionPreparedRequest {
  method: PluginConnectionMethod
  url: string
  body?: string
}

export type PluginConnectionTemplateResult =
  | { ok: true; request: PluginConnectionPreparedRequest }
  | { ok: false; error: string }

/**
 * Fills a request template with the site's choices and the page cursor, and
 * refuses a result that would leave `apiHosts`. The ONE way a template becomes
 * a request: the connect routes' resource picker and the scheduled sync both
 * call it, so the host check cannot be skipped by either.
 */
export function preparePluginConnectionRequest(
  request: PluginConnectionRequest,
  options: {
    apiHosts: readonly string[]
    choices: Readonly<Record<string, string>>
    cursor?: string | null
  },
): PluginConnectionTemplateResult {
  const fill = (value: string): string | null => {
    let missing = false
    const out = value.replace(PLACEHOLDER, (_whole, inner: string) => {
      const resource = RESOURCE_PLACEHOLDER.exec(String(inner).trim())
      const choice = resource ? options.choices[resource[1]] : undefined
      if (!isPluginConnectionChoiceId(choice)) {
        missing = true
        return ''
      }
      return choice
    })
    return missing ? null : out
  }
  const url = fill(request.url)
  if (url === null) return { ok: false, error: 'a choice this request needs has not been made' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'the request URL is not valid' }
  }
  for (const [key, value] of Object.entries(request.query ?? {})) {
    const filled = fill(value)
    if (filled === null) return { ok: false, error: 'a choice this request needs has not been made' }
    parsed.searchParams.set(key, filled)
  }
  if (options.cursor && request.pagination) {
    parsed.searchParams.set(request.pagination.cursorParam, options.cursor)
  }
  const finalUrl = parsed.toString()
  if (!isPluginConnectionUrlAllowed(finalUrl, options.apiHosts)) {
    return { ok: false, error: 'the request would leave the connection’s declared hosts' }
  }
  if (request.method === 'GET' || !request.body) {
    return { ok: true, request: { method: request.method, url: finalUrl } }
  }
  const body: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(request.body)) {
    if (typeof value !== 'string') {
      body[key] = value
      continue
    }
    const filled = fill(value)
    if (filled === null) return { ok: false, error: 'a choice this request needs has not been made' }
    body[key] = filled
  }
  return { ok: true, request: { method: request.method, url: finalUrl, body: JSON.stringify(body) } }
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

type Verdict<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const boundedText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null

const intIn = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null

/** The host part of a template URL, before any placeholder could appear. */
function templateUrlError(url: unknown, apiHosts: readonly string[], where: string): string | null {
  if (typeof url !== 'string' || !url || url.length > PLUGIN_CONNECTION_MAX_URL_LENGTH) {
    return `${where}: url must be an https URL`
  }
  const authorityEnd = url.indexOf('/', 'https://'.length)
  const head = authorityEnd === -1 ? url : url.slice(0, authorityEnd)
  if (!url.startsWith('https://')) return `${where}: url must be an https URL`
  if (head.includes('{{') || head.includes('@')) return `${where}: url must name its host literally`
  if (url.includes('#')) return `${where}: url must not carry a fragment`
  // Placeholders replaced with a harmless id to judge the URL's shape.
  const probe = url.replace(PLACEHOLDER, 'x')
  if (!isPluginConnectionUrlAllowed(probe, apiHosts)) {
    return `${where}: url must be on one of the connection's apiHosts`
  }
  return null
}

function validatePagination(raw: unknown, where: string): Verdict<PluginConnectionPagination | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return fail(`${where}: pagination must be an object`)
  if (!isPluginConnectionPath(raw['cursorPath'])) return fail(`${where}: pagination.cursorPath must be a dot path`)
  if (typeof raw['cursorParam'] !== 'string' || !PARAM_NAME.test(raw['cursorParam'])) {
    return fail(`${where}: pagination.cursorParam must be a query parameter name`)
  }
  const maxPages = intIn(raw['maxPages'], 1, PLUGIN_CONNECTION_MAX_PAGES)
  if (maxPages === null) {
    return fail(`${where}: pagination.maxPages must be a whole number from 1 to ${PLUGIN_CONNECTION_MAX_PAGES}`)
  }
  return {
    ok: true,
    value: { cursorPath: raw['cursorPath'], cursorParam: raw['cursorParam'], maxPages },
  }
}

function validateRequest(
  raw: unknown,
  where: string,
  context: { apiHosts: readonly string[]; resourceIds: readonly string[]; requireItems: boolean },
): Verdict<PluginConnectionRequest> {
  if (!isRecord(raw)) return fail(`${where} must be an object`)
  const method = raw['method'] ?? 'GET'
  if (method !== 'GET' && method !== 'POST') return fail(`${where}: method must be GET or POST`)
  const urlError = templateUrlError(raw['url'], context.apiHosts, where)
  if (urlError) return fail(urlError)
  const url = raw['url'] as string
  const refs: string[] = []
  const collect = (value: string, label: string): string | null => {
    if (value.length > TEMPLATE_VALUE_MAX && label !== 'url') return `${where}: ${label} is too long`
    const parsed = templateRefs(value)
    if ('error' in parsed) return `${where}: ${label} has an ${parsed.error}`
    refs.push(...parsed.refs)
    return null
  }
  const urlRefs = collect(url, 'url')
  if (urlRefs) return fail(urlRefs)

  let query: Record<string, string> | undefined
  if (raw['query'] !== undefined) {
    if (!isRecord(raw['query'])) return fail(`${where}: query must be an object of strings`)
    const entries = Object.entries(raw['query'])
    if (entries.length > QUERY_MAX_KEYS) return fail(`${where}: query names too many parameters`)
    query = {}
    for (const [key, value] of entries) {
      if (!PARAM_NAME.test(key) || typeof value !== 'string') {
        return fail(`${where}: query must be an object of strings`)
      }
      const error = collect(value, `query.${key}`)
      if (error) return fail(error)
      query[key] = value
    }
  }

  let body: Record<string, string | number | boolean> | undefined
  if (raw['body'] !== undefined) {
    if (method !== 'POST') return fail(`${where}: only a POST request has a body`)
    if (!isRecord(raw['body'])) return fail(`${where}: body must be a flat object`)
    const entries = Object.entries(raw['body'])
    if (entries.length > BODY_MAX_KEYS) return fail(`${where}: body has too many fields`)
    body = {}
    for (const [key, value] of entries) {
      if (!PARAM_NAME.test(key)) return fail(`${where}: body field "${key}" is not a plain name`)
      if (typeof value === 'string') {
        const error = collect(value, `body.${key}`)
        if (error) return fail(error)
        body[key] = value
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        body[key] = value
      } else if (typeof value === 'boolean') {
        body[key] = value
      } else {
        return fail(`${where}: body must be a flat object of strings, numbers and booleans`)
      }
    }
  }

  for (const ref of refs) {
    if (!context.resourceIds.includes(ref)) {
      return fail(`${where}: {{resource.${ref}}} names no resource declared before it`)
    }
  }

  let itemsPath: string | undefined
  if (raw['itemsPath'] !== undefined) {
    if (!isPluginConnectionPath(raw['itemsPath'])) return fail(`${where}: itemsPath must be a dot path`)
    itemsPath = raw['itemsPath']
  } else if (context.requireItems) {
    return fail(`${where}: itemsPath is required`)
  }
  const pagination = validatePagination(raw['pagination'], where)
  if (pagination.ok === false) return pagination
  if (pagination.value && !itemsPath) return fail(`${where}: a paginated request needs an itemsPath`)

  return {
    ok: true,
    value: {
      method,
      url,
      ...(query && Object.keys(query).length ? { query } : {}),
      ...(body ? { body } : {}),
      ...(itemsPath ? { itemsPath } : {}),
      ...(pagination.value ? { pagination: pagination.value } : {}),
    },
  }
}

function validateField(
  raw: unknown,
  where: string,
): Verdict<PluginConnectionRecordField> {
  if (!isRecord(raw)) return fail(`${where} must be an object`)
  const type = raw['type']
  if (!FIELD_TYPES.includes(type as PluginConnectionFieldType)) {
    return fail(`${where}: type must be one of ${FIELD_TYPES.join(', ')}`)
  }
  if (!isPluginConnectionPath(raw['path'])) return fail(`${where}: path must be a dot path`)
  const field: PluginConnectionRecordField = { type: type as PluginConnectionFieldType, path: raw['path'] }
  if (type === 'string' || type === 'url') {
    const ceiling = type === 'url' ? PLUGIN_CONNECTION_MAX_URL_LENGTH : PLUGIN_CONNECTION_MAX_STRING_LENGTH
    const maxLength = intIn(raw['maxLength'], 1, ceiling)
    if (maxLength === null) return fail(`${where}: maxLength is required, a whole number from 1 to ${ceiling}`)
    field.maxLength = maxLength
  } else if (raw['maxLength'] !== undefined) {
    return fail(`${where}: only a string or url field has a maxLength`)
  }
  if (raw['map'] !== undefined) {
    if (!isRecord(raw['map'])) return fail(`${where}: map must be an object`)
    const entries = Object.entries(raw['map'])
    if (!entries.length || entries.length > PLUGIN_CONNECTION_MAX_MAP_ENTRIES) {
      return fail(`${where}: map must have 1 to ${PLUGIN_CONNECTION_MAX_MAP_ENTRIES} entries`)
    }
    const map: Record<string, string | number | boolean> = {}
    for (const [key, value] of entries) {
      if (key.length > 100) return fail(`${where}: a map key is too long`)
      if (typeof value === 'string' && value.length <= 200) map[key] = value
      else if (typeof value === 'number' && Number.isFinite(value)) map[key] = value
      else if (typeof value === 'boolean') map[key] = value
      else return fail(`${where}: map values must be short strings, numbers or booleans`)
    }
    field.map = map
  }
  return { ok: true, value: field }
}

function validateFieldSet<T>(
  raw: unknown,
  where: string,
  each: (value: unknown, at: string) => Verdict<T>,
  required: boolean,
): Verdict<Record<string, T> | undefined> {
  if (raw === undefined) return required ? fail(`${where} is required`) : { ok: true, value: undefined }
  if (!isRecord(raw)) return fail(`${where} must be an object`)
  const entries = Object.entries(raw)
  if ((required && !entries.length) || entries.length > PLUGIN_CONNECTION_MAX_RECORD_FIELDS) {
    return fail(`${where} must name 1 to ${PLUGIN_CONNECTION_MAX_RECORD_FIELDS} fields`)
  }
  const out: Record<string, T> = {}
  for (const [name, value] of entries) {
    if (!IDENTIFIER.test(name)) return fail(`${where}: "${name}" is not a plain field name`)
    const verdict = each(value, `${where}.${name}`)
    if (verdict.ok === false) return verdict
    out[name] = verdict.value
  }
  return { ok: true, value: out }
}

function validateSync(
  raw: unknown,
  where: string,
  context: { apiHosts: readonly string[]; resourceIds: readonly string[] },
): Verdict<PluginConnectionSync | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return fail(`${where} must be an object`)
  const intervalHours = intIn(raw['intervalHours'], PLUGIN_CONNECTION_MIN_INTERVAL_HOURS, PLUGIN_CONNECTION_MAX_INTERVAL_HOURS)
  if (intervalHours === null) {
    return fail(
      `${where}: intervalHours must be a whole number from ${PLUGIN_CONNECTION_MIN_INTERVAL_HOURS} to ${PLUGIN_CONNECTION_MAX_INTERVAL_HOURS}`,
    )
  }
  const requestsRaw = raw['requests']
  if (!Array.isArray(requestsRaw) || !requestsRaw.length || requestsRaw.length > PLUGIN_CONNECTION_MAX_SYNC_REQUESTS) {
    return fail(`${where}: requests must list 1 to ${PLUGIN_CONNECTION_MAX_SYNC_REQUESTS} requests`)
  }
  const requests: PluginConnectionSyncRequest[] = []
  for (const [index, entry] of requestsRaw.entries()) {
    const at = `${where}.requests[${index}]`
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || !IDENTIFIER.test(entry['id'])) {
      return fail(`${at}: id must be a plain identifier`)
    }
    if (requests.some((request) => request.id === entry['id'])) return fail(`${at}: id "${entry['id']}" is used twice`)
    const verdict = validateRequest(entry, at, { ...context, requireItems: false })
    if (verdict.ok === false) return verdict
    requests.push({ id: entry['id'], ...verdict.value })
  }
  const recordRaw = raw['record']
  if (!isRecord(recordRaw)) return fail(`${where}: record must be an object`)
  const requestIds = requests.map((request) => request.id)
  const fields = validateFieldSet<PluginConnectionSummaryField>(
    recordRaw['fields'],
    `${where}.record.fields`,
    (value, at) => {
      if (!isRecord(value) || typeof value['request'] !== 'string' || !requestIds.includes(value['request'])) {
        return fail(`${at}: request must name one of the sync requests`)
      }
      const field = validateField(value, at)
      if (field.ok === false) return field
      return { ok: true, value: { request: value['request'], ...field.value } }
    },
    false,
  )
  if (fields.ok === false) return fields
  let items: PluginConnectionRecordItems | undefined
  if (recordRaw['items'] !== undefined) {
    const itemsRaw = recordRaw['items']
    const at = `${where}.record.items`
    if (!isRecord(itemsRaw)) return fail(`${at} must be an object`)
    const source = requests.find((request) => request.id === itemsRaw['request'])
    if (!source) return fail(`${at}: request must name one of the sync requests`)
    if (!source.itemsPath) return fail(`${at}: request "${source.id}" declares no itemsPath`)
    const maxItems = intIn(itemsRaw['maxItems'], 1, PLUGIN_CONNECTION_MAX_RECORD_ITEMS)
    if (maxItems === null) return fail(`${at}: maxItems must be a whole number from 1 to ${PLUGIN_CONNECTION_MAX_RECORD_ITEMS}`)
    const itemFields = validateFieldSet(itemsRaw['fields'], `${at}.fields`, validateField, true)
    if (itemFields.ok === false) return itemFields
    items = { request: source.id, maxItems, fields: itemFields.value ?? {} }
  }
  if (!fields.value && !items) return fail(`${where}: record must declare fields, items or both`)
  return {
    ok: true,
    value: {
      intervalHours,
      requests,
      record: { ...(fields.value ? { fields: fields.value } : {}), ...(items ? { items } : {}) },
    },
  }
}

/** Validates one connection. */
export function validatePluginConnection(raw: unknown, where = 'connection'): Verdict<PluginConnectionDeclaration> {
  if (!isRecord(raw)) return fail(`${where} must be an object`)
  const id = raw['id']
  if (typeof id !== 'string' || !PLUGIN_CONNECTION_ID_PATTERN.test(id)) {
    return fail(`${where}: id must be lowercase letters, digits and dashes (2 to 32)`)
  }
  const at = `connection "${id}"`
  const provider = raw['provider']
  if (typeof provider !== 'string' || !PLUGIN_CONNECTION_ID_PATTERN.test(provider)) {
    return fail(`${at}: provider must be lowercase letters, digits and dashes (2 to 32)`)
  }
  const label = boundedText(raw['label'], LABEL_MAX)
  if (!label) return fail(`${at}: label is required (at most ${LABEL_MAX} characters)`)
  let description: string | undefined
  if (raw['description'] !== undefined) {
    const text = boundedText(raw['description'], TEXT_MAX)
    if (!text) return fail(`${at}: description must be at most ${TEXT_MAX} characters`)
    description = text
  }
  for (const name of ['authorizationUrl', 'tokenUrl'] as const) {
    const error = endpointError(raw[name], name)
    if (error) return fail(`${at}: ${error}`)
  }
  if (raw['revocationUrl'] !== undefined) {
    const error = endpointError(raw['revocationUrl'], 'revocationUrl')
    if (error) return fail(`${at}: ${error}`)
  }
  const scopesRaw = raw['scopes']
  if (!Array.isArray(scopesRaw) || !scopesRaw.length || scopesRaw.length > PLUGIN_CONNECTION_MAX_SCOPES) {
    return fail(`${at}: scopes must list 1 to ${PLUGIN_CONNECTION_MAX_SCOPES} scopes`)
  }
  if (scopesRaw.some((scope) => typeof scope !== 'string' || !SCOPE.test(scope) || scope.includes(','))) {
    return fail(`${at}: a scope must be printable, with no spaces or commas`)
  }
  const scopeSeparator = raw['scopeSeparator']
  if (scopeSeparator !== undefined && scopeSeparator !== ' ' && scopeSeparator !== ',') {
    return fail(`${at}: scopeSeparator must be a space or a comma`)
  }
  let authParams: Record<string, string> | undefined
  if (raw['authParams'] !== undefined) {
    if (!isRecord(raw['authParams'])) return fail(`${at}: authParams must be an object of strings`)
    const entries = Object.entries(raw['authParams'])
    if (entries.length > PLUGIN_CONNECTION_MAX_AUTH_PARAMS) return fail(`${at}: authParams names too many parameters`)
    authParams = {}
    for (const [key, value] of entries) {
      if (!PARAM_NAME.test(key) || typeof value !== 'string' || value.length > PARAM_VALUE_MAX) {
        return fail(`${at}: authParams must be an object of short strings`)
      }
      if (PLUGIN_CONNECTION_RESERVED_AUTH_PARAMS.includes(key.toLowerCase())) {
        return fail(`${at}: authParams may not set "${key}", which the platform sets itself`)
      }
      authParams[key] = value
    }
  }
  const tokenAuthMethod = raw['tokenAuthMethod']
  if (tokenAuthMethod !== undefined && tokenAuthMethod !== 'body' && tokenAuthMethod !== 'basic') {
    return fail(`${at}: tokenAuthMethod must be "body" or "basic"`)
  }
  const apiHostsRaw = raw['apiHosts']
  if (!Array.isArray(apiHostsRaw) || !apiHostsRaw.length || apiHostsRaw.length > PLUGIN_CONNECTION_MAX_API_HOSTS) {
    return fail(`${at}: apiHosts must list 1 to ${PLUGIN_CONNECTION_MAX_API_HOSTS} hosts`)
  }
  for (const pattern of apiHostsRaw) {
    if (!isPluginConnectionHostPattern(pattern)) {
      return fail(
        `${at}: api host "${String(pattern)}" must be a lowercase public hostname, or *.<domain> with one wildcard label`,
      )
    }
  }
  const apiHosts = [...new Set(apiHostsRaw as string[])]

  const resources: PluginConnectionResource[] = []
  if (raw['resources'] !== undefined) {
    const list = raw['resources']
    if (!Array.isArray(list) || list.length > PLUGIN_CONNECTION_MAX_RESOURCES) {
      return fail(`${at}: resources must list at most ${PLUGIN_CONNECTION_MAX_RESOURCES} resources`)
    }
    for (const [index, entry] of list.entries()) {
      const where2 = `${at} resources[${index}]`
      if (!isRecord(entry) || typeof entry['id'] !== 'string' || !IDENTIFIER.test(entry['id'])) {
        return fail(`${where2}: id must be a plain identifier`)
      }
      const resourceId = entry['id']
      if (resources.some((resource) => resource.id === resourceId)) return fail(`${where2}: id "${resourceId}" is used twice`)
      const resourceLabel = boundedText(entry['label'], LABEL_MAX)
      if (!resourceLabel) return fail(`${where2}: label is required (at most ${LABEL_MAX} characters)`)
      const request = validateRequest(entry['request'], `${where2}.request`, {
        apiHosts,
        resourceIds: resources.map((resource) => resource.id),
        requireItems: true,
      })
      if (request.ok === false) return request
      if (!isPluginConnectionPath(entry['idPath'])) return fail(`${where2}: idPath must be a dot path`)
      if (!isPluginConnectionPath(entry['labelPath'])) return fail(`${where2}: labelPath must be a dot path`)
      const maxItems =
        entry['maxItems'] === undefined ? 100 : intIn(entry['maxItems'], 1, PLUGIN_CONNECTION_MAX_RESOURCE_ITEMS)
      if (maxItems === null) {
        return fail(`${where2}: maxItems must be a whole number from 1 to ${PLUGIN_CONNECTION_MAX_RESOURCE_ITEMS}`)
      }
      resources.push({
        id: resourceId,
        label: resourceLabel,
        request: request.value as PluginConnectionResource['request'],
        idPath: entry['idPath'],
        labelPath: entry['labelPath'],
        maxItems,
      })
    }
  }

  const sync = validateSync(raw['sync'], `${at} sync`, {
    apiHosts,
    resourceIds: resources.map((resource) => resource.id),
  })
  if (sync.ok === false) return sync

  return {
    ok: true,
    value: {
      id,
      provider,
      label,
      ...(description ? { description } : {}),
      authorizationUrl: raw['authorizationUrl'] as string,
      tokenUrl: raw['tokenUrl'] as string,
      ...(raw['revocationUrl'] !== undefined ? { revocationUrl: raw['revocationUrl'] as string } : {}),
      scopes: [...new Set(scopesRaw as string[])],
      ...(scopeSeparator ? { scopeSeparator: scopeSeparator as ' ' | ',' } : {}),
      ...(authParams && Object.keys(authParams).length ? { authParams } : {}),
      ...(tokenAuthMethod ? { tokenAuthMethod: tokenAuthMethod as PluginConnectionTokenAuthMethod } : {}),
      apiHosts,
      ...(resources.length ? { resources } : {}),
      ...(sync.value ? { sync: sync.value } : {}),
    },
  }
}

/**
 * Validates a manifest's whole `connections` block. Refused whole when any
 * entry is malformed — unlike an element, a connection dropped on the way in
 * is an OAuth flow and a sync that silently do not exist.
 */
export function validatePluginConnections(raw: unknown): Verdict<PluginConnectionDeclaration[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return fail('connections must be a list')
  if (raw.length > PLUGIN_CONNECTION_MAX) return fail(`At most ${PLUGIN_CONNECTION_MAX} connections may be declared`)
  let serialized: string
  try {
    serialized = JSON.stringify(raw)
  } catch {
    return fail('connections must be plain JSON')
  }
  if (serialized.length > PLUGIN_CONNECTION_MAX_DECLARATION_CHARS) {
    return fail(`connections must serialize to at most ${PLUGIN_CONNECTION_MAX_DECLARATION_CHARS} characters`)
  }
  const out: PluginConnectionDeclaration[] = []
  for (const [index, entry] of raw.entries()) {
    const verdict = validatePluginConnection(entry, `connections[${index}]`)
    if (verdict.ok === false) return verdict
    if (out.some((connection) => connection.id === verdict.value.id)) {
      return fail(`connection id "${verdict.value.id}" is declared twice`)
    }
    out.push(verdict.value)
  }
  return { ok: true, value: out }
}

/**
 * Validates `capabilities.imageHosts`: the hosts a plugin's element may show
 * images from on a published site. The tenant admits each, as an `https://`
 * source, to the `img-src` of the sites that install the plugin (AGL-4195),
 * so the rule is strict: a bare lowercase public hostname, or `*.` over one
 * label of a domain (never `*.com`), no scheme (so never `data:` or `http:`),
 * no port, no path, at most {@link PLUGIN_MAX_IMAGE_HOSTS}. Same host rule as
 * `apiHosts`.
 */
export function validatePluginImageHosts(raw: unknown): Verdict<string[]> {
  if (raw === undefined) return { ok: true, value: [] }
  if (!Array.isArray(raw) || raw.length > PLUGIN_MAX_IMAGE_HOSTS) {
    return fail(`imageHosts must list at most ${PLUGIN_MAX_IMAGE_HOSTS} hosts`)
  }
  for (const pattern of raw) {
    if (!isPluginConnectionHostPattern(pattern)) {
      return fail(`Image host "${String(pattern)}" must be a lowercase public hostname, or *.<domain> with one wildcard label`)
    }
  }
  return { ok: true, value: [...new Set(raw as string[])] }
}

/** The connection a manifest declares under `connectionId`, re-validated, or `null`. */
export function findPluginConnection(
  manifest: { connections?: unknown } | null | undefined,
  connectionId: string,
): PluginConnectionDeclaration | null {
  const verdict = validatePluginConnections(manifest?.connections)
  if (verdict.ok === false) return null
  return verdict.value.find((connection) => connection.id === connectionId) ?? null
}

/**
 * The authorization address the site owner is sent to: the declared
 * endpoint with the platform's own client id, redirect, state and scope, and
 * the declaration's extra parameters, which may not override any of those.
 */
export function pluginConnectionAuthorizeUrl(
  connection: PluginConnectionDeclaration,
  options: { clientId: string; redirectUri: string; state: string },
): string {
  const url = new URL(connection.authorizationUrl)
  for (const [key, value] of Object.entries(connection.authParams ?? {})) {
    if (PLUGIN_CONNECTION_RESERVED_AUTH_PARAMS.includes(key.toLowerCase())) continue
    url.searchParams.set(key, value)
  }
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('scope', connection.scopes.join(connection.scopeSeparator ?? ' '))
  url.searchParams.set('state', options.state)
  return url.toString()
}

/* ------------------------------------------------------------------ */
/* Site variables from a record (AGL-4195)                              */
/* ------------------------------------------------------------------ */

/** The longest id a `{{var:…}}` token carries (`binding-tokens.ts`). */
const VARIABLE_ID_MAX = 64
const VARIABLE_ID_REF = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The `{{var:…}}` id a record's SUMMARY field resolves under on a site:
 * `{listingId}__{connectionId}-{field}`, e.g. `Kq3…__reviews-rating`.
 *
 * Chosen so it can never be a site's own variable and can never be two
 * fields at once:
 *
 *   - a site's own variables carry Firestore auto ids (letters and digits),
 *     and this id always holds `__` and `-`;
 *   - a field name never holds `-` (`[A-Za-z][A-Za-z0-9_]*`), so the field is
 *     what follows the LAST `-`; a connection id never holds `_`, so the
 *     connection is what follows the last `__` before it, and the listing is
 *     the rest. Two different triples therefore never spell the same id.
 *
 * `null` when the id would not fit a token (64 characters): such a field
 * has no variable, rather than one that no token could name.
 */
export function pluginConnectionVariableId(
  listingId: string,
  connectionId: string,
  field: string,
): string | null {
  if (!PLUGIN_CONNECTION_ID_PATTERN.test(connectionId) || !IDENTIFIER.test(field)) return null
  const id = `${listingId}__${connectionId}-${field}`
  return id.length <= VARIABLE_ID_MAX && VARIABLE_ID_REF.test(id) ? id : null
}

/** How a record value of each declared type is held as a site variable. */
const VARIABLE_TYPE_OF: Readonly<Record<PluginConnectionFieldType, HostVariableType>> = {
  string: 'text',
  url: 'text',
  number: 'number',
  boolean: 'boolean',
  datetime: 'date',
}

/**
 * The site variables one connection's record gives a site: one per declared
 * SUMMARY field (`sync.record.fields`) holding a value, under
 * {@link pluginConnectionVariableId}. A field the record does not hold, or
 * holds as a value of another type than declared, has no variable, so its
 * token renders empty as any unknown variable does. Items never become
 * variables: a list has no single value to print.
 *
 * Each variable's `name` is its id. Names are what a function's expressions
 * read, and an id with `-` in it is not a name an expression can spell, so
 * these never shadow one of the site's own variables in a function.
 */
export function pluginConnectionRecordVariables(
  listingId: string,
  connection: Pick<PluginConnectionDeclaration, 'id' | 'sync'>,
  fields: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, HostVariable> {
  const out: Record<string, HostVariable> = {}
  const declared = connection.sync?.record.fields ?? {}
  for (const [field, declaration] of Object.entries(declared)) {
    const value = fields?.[field]
    const id = pluginConnectionVariableId(listingId, connection.id, field)
    if (!id || value === null || value === undefined) continue
    const type = VARIABLE_TYPE_OF[declaration.type]
    let stored: string | null = null
    if (declaration.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      stored = String(value)
    } else if (declaration.type === 'boolean' && typeof value === 'boolean') {
      stored = value ? 'true' : 'false'
    } else if (declaration.type === 'datetime' && typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value)
      stored = Number.isNaN(date.getTime()) ? null : date.toISOString()
    } else if ((declaration.type === 'string' || declaration.type === 'url') && typeof value === 'string') {
      stored = value
    }
    if (stored === null) continue
    out[id] = { name: id, type, value: stored }
  }
  return out
}
