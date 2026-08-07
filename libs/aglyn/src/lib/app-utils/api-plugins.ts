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
  /** Node socket — used for the client IP fallback (`remoteAddress`). */
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
 * Idempotent by path — re-registration replaces the previous handler.
 */
export function registerPluginApiRoute(
  path: string,
  handler: PluginApiHandler,
): void {
  const key = normalizeApiPath(path)
  apiRoutes.set(key, handler)
  const owner = getRegisteringPluginId()
  if (owner) apiRouteOwners.set(key, owner)
}

/** The plugin that registered a path, for per-org enablement gating. */
export function pluginIdForRegisteredApiPath(path: string): string | undefined {
  return apiRouteOwners.get(normalizeApiPath(path))
}

export function unregisterPluginApiRoute(path: string): void {
  apiRoutes.delete(normalizeApiPath(path))
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
