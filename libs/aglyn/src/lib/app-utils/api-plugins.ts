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

/** Leading/trailing slashes stripped so '/events/list' and 'events/list' key alike. */
function normalizeApiPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

const apiRoutes = new Map<string, PluginApiHandler>()
const apiRouteOwners = new Map<string, string>()

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
  handler: PluginApiHandler,
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
}

/** The handler for a request path, or undefined when nothing is registered. */
export function resolvePluginApiRoute(
  path: string,
): PluginApiHandler | undefined {
  return apiRoutes.get(normalizeApiPath(path))
}

/** Registered paths, for diagnostics. */
export function listPluginApiRoutes(): string[] {
  return Array.from(apiRoutes.keys())
}
