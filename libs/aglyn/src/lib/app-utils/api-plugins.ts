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
 * Server half of the plugin pattern (AGL-396): the API-route registry, the
 * server counterpart to the ConsoleExtension registry. A feature plugin
 * registers request handlers here from its `/server` entry point (never its
 * client barrel, so firebase-admin and other server-only deps stay out of
 * the browser bundle). The app ships one catch-all dispatcher route per
 * Next app that resolves a request path to a registered handler — so moving
 * a feature's API into its plugin needs no new app route and keeps the same
 * URL. Reference implementation: events-calendar `events/list` (AGL-396).
 *
 * The request/response shapes are structural (not `next` types) so plugins
 * stay framework-light; `NextApiRequest`/`NextApiResponse` satisfy them, so
 * the dispatcher passes Next's objects straight through.
 */

export interface PluginApiRequest {
  method?: string
  query: Partial<Record<string, string | string[]>>
  // `any` mirrors NextApiRequest.body (parsed JSON/form/text); handlers
  // validate it themselves, as they did as Next routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  /**
   * The unparsed request text, for handlers that verify signatures over the
   * exact payload (Stripe/Svix webhooks registered as plugin API paths).
   * UTF-8 re-encoding of the text is byte-identical for valid UTF-8 JSON.
   */
  rawBody?: string
  headers: Partial<Record<string, string | string[]>>
  cookies: Partial<Record<string, string>>
  /**
   * Node socket — the client-address fallback (`remoteAddress`).
   *
   * On the console's Pages Router this is the real transport peer. Behind the
   * App Router adapter there is no socket, and `api-adapter.ts` fills it from
   * the shared client-address reader so a handler falling back to it gets the
   * same trusted hop rather than a caller-supplied one.
   */
  socket: { remoteAddress?: string }
}

export interface PluginApiResponse {
  status(code: number): PluginApiResponse
  json(body: unknown): void
  send(body: unknown): void
  setHeader(name: string, value: string | number | readonly string[]): void
  redirect(url: string): void
  redirect(status: number, url: string): void
  end(): void
}

export type PluginApiHandler = (
  req: PluginApiRequest,
  res: PluginApiResponse,
) => void | Promise<void>

/**
 * A handler in the Web shape (AGL-2939): the dispatcher's own `Request`
 * in, a `Response` out — with a streamed body when the door streams, as
 * the assistant's chat and a job's event feed do. `params` carries the
 * dispatcher's path segments and any `:name` segment the registered path
 * declared.
 */
export type PluginWebApiHandler = (
  request: Request,
  context: { params: Record<string, string | string[]> },
) => Response | Promise<Response>

/** What a route registers: the (req, res) shape, or a Web handler. */
export type PluginApiRoute = PluginApiHandler | { web: PluginWebApiHandler }

/** A registered route matched to a request path, with its `:name` segments filled. */
export interface PluginApiMatch {
  route: PluginApiRoute
  params: Record<string, string>
}

/**
 * Who a request is FOR, as far as the dispatchers' release gate is concerned
 * (AGL-2978).
 *
 * The gate buckets a rollout and reads per-org overrides on an org id, and a
 * dispatcher learns that id from the site a request names (`hostId`). Two
 * kinds of request name no site and still belong to one organization:
 *
 * - a request to an ORGANIZATION-level surface (`ConsoleExtension.orgNavItems`,
 *   AGL-2974), which names its org rather than a site;
 * - a request that arrives with no bearer token by design — a provider's
 *   OAuth redirect back to the platform, which carries only what the platform
 *   signed into it.
 *
 * Without a subject the gate treats both as anonymous, so a plugin released to
 * one organization by override refused that organization's own requests, and
 * a staff member previewing a dark plugin could not complete a redirect their
 * own session had started.
 */
export interface PluginApiRequestSubject {
  /** The organization: the rollout bucket and the override key. */
  orgId: string | null
  /**
   * The account the request acts for, read ONLY when the request carries no
   * bearer token — a token speaks for itself. A route may name one only when
   * it verified a signature binding the uid to the request, because the gate
   * lets a staff account named here preview a released-off plugin.
   */
  uid?: string | null
}

/** Reads a request's subject; answers `null` when the request names none. */
export type PluginApiSubjectResolver = (
  request: Request,
) => PluginApiRequestSubject | null | Promise<PluginApiRequestSubject | null>

/** What a registration may say about its route beyond the handler. */
export interface PluginApiRouteOptions {
  /**
   * How a request to this route names its subject when it names no site.
   * Consulted by both dispatchers before their release gate, and only for a
   * request with no `hostId`: a named site always decides the org.
   */
  subject?: PluginApiSubjectResolver
  /**
   * The route answers a link the platform MAILED to somebody — an
   * unsubscribe in a message's `List-Unsubscribe` header — rather than a door
   * a member uses (AGL-2981).
   *
   * Such a link has to keep working whether or not its plugin is released,
   * or switched on, for the workspace NOW. A recipient's way out does not
   * close when a rollout is paused or a workspace turns the plugin off:
   * CAN-SPAM holds an opt-out open for thirty days after the send, and an
   * unsubscribe that 404s the day a kill switch is flipped is one nobody can
   * use. So both dispatchers skip their per-site enablement and release
   * gates for it — and nothing else: lockdown and the rate limit still
   * apply. The flag says nothing about who may act, so the route
   * authenticates the link itself, by a signature it verifies.
   */
  recipientLink?: boolean
}

/** Leading/trailing slashes stripped so '/events/list' and 'events/list' key alike. */
function normalizeApiPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

const apiRoutes = new Map<string, PluginApiRoute>()
const apiRouteOwners = new Map<string, string>()
const apiRouteOptions = new Map<string, PluginApiRouteOptions>()

/**
 * The "currently registering plugin" marker moved to a leaf module
 * (`registering-plugin`) so `site-page-hooks` can read it too — this file is
 * only reachable through the `/server` entry, and importing it from the shared
 * plugin-manager barrel formed a cycle (AGL-1289). Re-exported here so the
 * plugin loader's existing import keeps working unchanged.
 */
import { getRegisteringPluginId } from './registering-plugin'

export {
  setRegisteringPluginId,
  getRegisteringPluginId,
} from './registering-plugin'

/**
 * Registers a plugin API handler at a host-relative path (e.g.
 * 'events/list'), served by the app dispatcher at `/api/events/list`.
 *
 * Idempotent by path FOR ITS OWNER — re-registration by the plugin that
 * holds the path replaces the previous handler, which is what a hot reload,
 * a second surface, and a repeated init all depend on.
 *
 * A different plugin is REFUSED (AGL-2484). This map is process-global and
 * was last-writer-wins on the path alone, while Aglyn's own commission-taking
 * handlers sit at `marketplace/checkout` and `commerce/checkout` — and the
 * tenant dispatcher calls `ensureRemoteServerBundles()` after the first-party
 * loader has run, so a remote bundle registering either path was simply the
 * later writer. Getting there needs `PLUGIN_REMOTE_SERVER=enabled` (off by
 * default), realm trust and a valid signature, so this is the last of several
 * doors rather than the only one; it is also the one the registry could close
 * by itself, because it already recorded who registered what.
 *
 * Anonymous registration — no loader marker — is an IDENTITY here, not a
 * wildcard: it may replace itself and nothing else may take it.
 */
export function registerPluginApiRoute(
  path: string,
  handler: PluginApiRoute,
  options?: PluginApiRouteOptions,
): void {
  const key = normalizeApiPath(path)
  const owner = getRegisteringPluginId() ?? ANONYMOUS_OWNER
  const incumbent = apiRouteOwners.get(key)
  if (incumbent !== undefined && incumbent !== owner) {
    // Loud, because the silent version of this is a payment route quietly
    // answering from someone else's code. Refusing is the safe direction:
    // the incumbent keeps serving.
    console.error(
      `[plugins] refused API route "${key}" to "${owner}": already ` +
        `registered by "${incumbent}"`,
    )
    return
  }
  apiRoutes.set(key, handler)
  apiRouteOwners.set(key, owner)
  // Replaced with the handler, never merged: a re-registration that drops its
  // subject resolver must not keep answering with the previous one.
  if (options) apiRouteOptions.set(key, options)
  else apiRouteOptions.delete(key)
}

/** The marker for a registration made outside any loader context. */
const ANONYMOUS_OWNER = ''

/** The plugin that registered a path, for per-org enablement gating. */
export function pluginIdForRegisteredApiPath(path: string): string | undefined {
  const owner = apiRouteOwners.get(normalizeApiPath(path))
  // An anonymous registration has no plugin to gate on, and this has always
  // answered `undefined` for one — the sentinel must not leak out as an id.
  return owner === undefined || owner === ANONYMOUS_OWNER ? undefined : owner
}

export function unregisterPluginApiRoute(path: string): void {
  const key = normalizeApiPath(path)
  apiRoutes.delete(key)
  // Release the CLAIM too, or the refusal above outlives the route and the
  // path can never be re-registered for the life of the process.
  apiRouteOwners.delete(key)
  apiRouteOptions.delete(key)
}

/**
 * The registered key a request path resolves to, with its `:name` segments.
 *
 * An exact registration wins; otherwise a registration whose path carries
 * `:name` segments matches segment for segment. One matcher for the route and
 * for its options, so a request can never be answered by one registration and
 * gated with another's subject.
 */
function matchRegisteredApiKey(
  path: string,
): { key: string; params: Record<string, string> } | undefined {
  const key = normalizeApiPath(path)
  if (apiRoutes.has(key)) return { key, params: {} }
  const segments = key.split('/')
  for (const registered of apiRoutes.keys()) {
    if (!registered.includes(':')) continue
    const pattern = registered.split('/')
    if (pattern.length !== segments.length) continue
    const params: Record<string, string> = {}
    let matched = true
    for (let index = 0; index < pattern.length; index += 1) {
      const part = pattern[index]
      if (part.startsWith(':') && segments[index]) {
        params[part.slice(1)] = segments[index]
      } else if (part !== segments[index]) {
        matched = false
        break
      }
    }
    if (matched) return { key: registered, params }
  }
  return undefined
}

/**
 * The route for a request path, or undefined when nothing is registered.
 *
 * An exact registration wins; otherwise a registration whose path carries
 * `:name` segments matches segment for segment (`ai/jobs/:jobId/cancel`
 * answers `ai/jobs/abc/cancel`), and the named segments come back as
 * `params`. Patterns are tried in registration order and a static segment
 * beats a named one only by being registered exactly.
 */
export function resolvePluginApiMatch(path: string): PluginApiMatch | undefined {
  const matched = matchRegisteredApiKey(path)
  if (!matched) return undefined
  const route = apiRoutes.get(matched.key)
  return route ? { route, params: matched.params } : undefined
}

/**
 * Whether a request path resolves to a route registered as a
 * {@link PluginApiRouteOptions.recipientLink} — what both dispatchers ask
 * before their enablement and release gates (AGL-2981).
 */
export function isPluginRecipientLinkRoute(path: string): boolean {
  const matched = matchRegisteredApiKey(path)
  return matched ? apiRouteOptions.get(matched.key)?.recipientLink === true : false
}

/** An id a subject may carry: a non-empty path segment, not a path. */
const SUBJECT_ID = /^[^/\s]{1,128}$/

const subjectId = (value: unknown): string | null =>
  typeof value === 'string' && SUBJECT_ID.test(value) ? value : null

/**
 * The subject a request to a registered route names, or `null` (AGL-2978).
 *
 * `null` when the route declared no resolver, when the resolver answered
 * nothing, and when it THREW: a resolver that cannot read its request has
 * named no subject, and the gate then treats the request as anonymous — the
 * conservative direction. The resolver reads a clone, so the handler still
 * receives the untouched body. Ids are held to a plain path segment, so a
 * resolver cannot hand the gate a path to read overrides from.
 */
export async function resolvePluginApiRequestSubject(
  path: string,
  request: Request,
): Promise<PluginApiRequestSubject | null> {
  const matched = matchRegisteredApiKey(path)
  const resolve = matched ? apiRouteOptions.get(matched.key)?.subject : undefined
  if (!resolve) return null
  try {
    const subject = await resolve(request.clone())
    if (!subject) return null
    const orgId = subjectId(subject.orgId)
    const uid = subjectId(subject.uid)
    if (!orgId && !uid) return null
    return { orgId, ...(uid ? { uid } : {}) }
  } catch {
    return null
  }
}

/**
 * The legacy (node-style) handler at a request path, or undefined when
 * nothing is registered there or the route is a web handler — a web route
 * is reached through `resolvePluginApiMatch` and `runPluginApiMatch`, since
 * it takes the `Request` and the filled `:name` segments, not a `req`/`res`
 * pair.
 */
export function resolvePluginApiRoute(path: string): PluginApiHandler | undefined {
  const route = resolvePluginApiMatch(path)?.route
  return typeof route === 'function' ? route : undefined
}

/**
 * Runs a matched route against the dispatcher's request: a Web handler is
 * called as it is, and a (req, res) handler goes through the adapter the
 * caller supplies — the adapter lives on the `/server` entry, which this
 * module may not import.
 */
export async function runPluginApiMatch(
  match: PluginApiMatch,
  request: Request,
  params: Record<string, string | string[]>,
  runLegacy: (
    handler: PluginApiHandler,
    request: Request,
    params: Record<string, string | string[]>,
  ) => Promise<Response>,
): Promise<Response> {
  const merged = { ...params, ...match.params }
  const route = match.route as { web?: PluginWebApiHandler }
  if (typeof route === 'object' && route !== null && typeof route.web === 'function') {
    return route.web(request, { params: merged })
  }
  return runLegacy(match.route as PluginApiHandler, request, merged)
}

/** Registered paths, for diagnostics. */
export function listPluginApiRoutes(): string[] {
  return Array.from(apiRoutes.keys())
}
