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

import { getRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { ApiV1ResourceDescription } from './api-v1-description'
import type { ApiV1Context } from './api-v1-kit'

/**
 * A plugin's resources on the customer REST API, `/v1/<resource>/…`
 * (AGL-3080).
 *
 * The console's `/v1` router owns the pipeline — the API key, the
 * `apiAccess` entitlement, the request quota, the rate limit, the error
 * envelope — and the platform's own resources (sites, the media library). A resource a plugin models is the plugin's: it registers a
 * handler under the resource's first path segment, and the router hands it
 * every request under that segment once the key is authenticated, with the
 * context the pipeline resolved. The handler asks for its own scopes
 * (`requireScope`) and answers in the published envelope.
 *
 * ## The published contract does not move
 *
 * A path, a field, a scope and a status are the same whichever module
 * answers them. The OpenAPI document is still the router's to build, and a
 * registration hands it the resource's description (`describe`), so the
 * document — and the MCP tools derived from it — describe every resource the
 * build serves and nothing it does not. Moving a resource into its plugin
 * changes where it is written, never what an integrator sees.
 *
 * ## What the organization's usage reports
 *
 * `GET /v1/usage` is the platform's; a plugin whose records the plan bands
 * or an integration sizes a sync by adds its own figures to it
 * (`registerApiV1UsageFigures`), read with the platform's on every call.
 *
 * ## The plan, before the handler
 *
 * A registration may name the plan feature its resource needs
 * (`entitlement`). The router refuses an organization without it —
 * `402 plan_required` with the feature as the `code` and the registration's
 * own sentence — BEFORE the handler runs and before any scope is asked, so a
 * key minted while the plan carried the feature cannot outlive it.
 *
 * ## Registered at the console's boot
 *
 * From the plugin's console server declarations, with the handler loaded on
 * the first request. The router asks for a resource it does not know once
 * more after running the app's declarations step
 * (`runPluginDeclarationsRepair`), so a process whose boot failed repairs
 * itself rather than answering `404` for a resource it serves. No
 * registration means no plugin in this build serves the resource: the
 * router's `404` for an unknown endpoint is then the truth.
 *
 * ## One owner per resource
 *
 * A second plugin registering a resource another already serves is refused,
 * naming both, and the incumbent keeps serving. The platform's own
 * resources are not registrable.
 */

/** Answers one request under the resource, after the pipeline admitted it. */
export type ApiV1ResourceHandler = (
  request: Request,
  context: ApiV1Context,
  /** The path under `/v1`, split — `['contacts', '<id>', 'merge']`. */
  segments: string[],
  url: URL,
) => Promise<Response>

export interface ApiV1Resource {
  handle: ApiV1ResourceHandler
  /**
   * The plan feature the resource needs, and the sentence a refusal says —
   * `The CRM … is not included in this organization's plan`.
   */
  entitlement?: { feature: string; message: string }
  /**
   * The resource as the OpenAPI document describes it, loaded when the
   * document is built. Absent, the resource is served and undocumented.
   */
  describe?: () => Promise<ApiV1ResourceDescription>
}

export const API_V1_RESOURCES = definePluginServiceContract<ApiV1Resource>(
  'core.api-v1-resources',
  { multiple: true },
)

/** The resources the router answers itself, which no plugin may take. */
export const PLATFORM_API_V1_RESOURCES: ReadonlySet<string> = new Set([
  'sites',
  'media',
  'usage',
  'me',
  'openapi.json',
])

/** A resource name as a path segment carries it. */
const RESOURCE = /^[a-z][a-z0-9-]*$/

/**
 * Serves `/v1/<resource>` from a plugin. The owner is the loader's marker
 * when a register fn is running, else `options.pluginId`; with neither the
 * registration throws, as it does for a name that is not one lowercase path
 * segment, a platform resource, and a resource another plugin serves. The
 * same plugin registering again replaces its own.
 */
export function registerApiV1Resource(
  resource: string,
  registration: ApiV1Resource,
  options?: { pluginId?: string },
): void {
  const key = String(resource ?? '').trim()
  if (!RESOURCE.test(key)) {
    throw new Error(`a /v1 resource needs a lowercase path segment for its name, not "${key}"`)
  }
  if (PLATFORM_API_V1_RESOURCES.has(key)) {
    throw new Error(`/v1/${key} is the platform's own resource`)
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) throw new Error(`the /v1/${key} resource was registered with no owner`)
  const incumbent = resolvePluginServices(API_V1_RESOURCES).find((entry) => entry.key === key)
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `/v1/${key} is already served by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(API_V1_RESOURCES, registration, { pluginId, key })
}

/** Every resource the plugins serve here, in registration order. */
export function apiV1Resources(): Array<{ name: string; pluginId: string; resource: ApiV1Resource }> {
  return resolvePluginServices(API_V1_RESOURCES).map((entry) => ({
    name: entry.key ?? '',
    pluginId: entry.pluginId,
    resource: entry.impl,
  }))
}

/**
 * The descriptions of every resource the plugins serve, in registration
 * order. A description that fails to load is left out and logged, rather
 * than taking the platform's own description with it.
 */
export async function describeApiV1Resources(): Promise<ApiV1ResourceDescription[]> {
  const described = await Promise.all(
    apiV1Resources().map(async ({ name, pluginId, resource }) => {
      if (!resource.describe) return null
      try {
        return await resource.describe()
      } catch (error) {
        console.error(`[api-v1] ${pluginId} could not describe /v1/${name}`, error)
        return null
      }
    }),
  )
  return described.filter((one): one is ApiV1ResourceDescription => one !== null)
}

/** The plugin serving `/v1/<resource>` here, or `null` when none does. */
export function apiV1Resource(
  resource: string,
): { pluginId: string; resource: ApiV1Resource } | null {
  const key = String(resource ?? '').trim()
  const entry = resolvePluginServices(API_V1_RESOURCES).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, resource: entry.impl } : null
}

// ── Usage ──────────────────────────────────────────────────────────────────

/**
 * A plugin's figures on `GET /v1/usage`, as top-level members of the usage
 * object — a band the plan meters, or a size an integration plans a sync by
 * (`usageBand` in `api-v1-kit.ts` gives either its published shape). Read on
 * every call, with the request's context; a reader that throws fails the
 * request, as a platform figure that cannot be read does.
 */
export type ApiV1UsageFigures = (context: ApiV1Context) => Promise<Record<string, unknown>>

export const API_V1_USAGE_FIGURES = definePluginServiceContract<ApiV1UsageFigures>(
  'core.api-v1-usage-figures',
  { multiple: true },
)

/**
 * Adds a plugin's figures to `GET /v1/usage`. One reader per plugin;
 * registering again replaces it. The owner is the loader's marker when a
 * register fn is running, else `options.pluginId`.
 */
export function registerApiV1UsageFigures(
  read: ApiV1UsageFigures,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) throw new Error('/v1 usage figures were registered with no owner')
  registerPluginService(API_V1_USAGE_FIGURES, read, { pluginId })
}

/**
 * Every plugin's figures for one request, merged in registration order. A
 * member the platform's own figures (`reserved`) or an earlier plugin
 * already names is dropped and logged: a plugin adds figures, never
 * replaces one.
 */
export async function readApiV1UsageFigures(
  context: ApiV1Context,
  reserved: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const readers = resolvePluginServices(API_V1_USAGE_FIGURES)
  const figures = await Promise.all(readers.map((entry) => entry.impl(context)))
  const merged: Record<string, unknown> = {}
  figures.forEach((one, index) => {
    for (const [key, value] of Object.entries(one)) {
      if (reserved.has(key) || key in merged) {
        console.error(`[api-v1] ${readers[index].pluginId} named usage figure "${key}", which is taken`)
        continue
      }
      merged[key] = value
    }
  })
  return merged
}
