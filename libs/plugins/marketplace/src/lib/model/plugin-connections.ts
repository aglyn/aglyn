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

import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { PluginFeatureDeclaration, PluginOrgPermissionDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import type { PluginPermission } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { MARKETPLACE_PUBLISHER_PERMISSIONS } from './marketplace-publisher-permissions'
import {
  MARKETPLACE_CONNECTION_SITE_PERMISSIONS,
  MARKETPLACE_CONNECTION_SITE_ROLE_PRESET,
} from './marketplace-site-permissions'

/*
 * DECLARED CONNECTIONS, THE PLATFORM'S HALF (AGL-4193): THE CONTRACT.
 *
 * A marketplace plugin declares a connection in its manifest
 * (`@aglyn/aglyn/app-utils/plugin-connections`); this plugin, the
 * marketplace, runs it for every plugin it distributes: the publisher's OAuth
 * app credentials per listing, the site's sealed grant, the connect routes,
 * the plan feature and the two permission keys. Light and client-safe: the
 * console card imports the names, views and keys from here, and nothing here
 * reaches Firestore, a provider or React.
 *
 * Where the data lives, all server-only (no client rule opens any of it):
 *
 *   pluginConnectionCredentials/{listingId}__{connectionId}
 *       the publisher's OAuth client id and secret, both sealed, keyed by
 *       the publishing workspace in `orgId` so its erasure sweeps them;
 *   hosts/{hostId}/pluginConnections/{listingId}__{connectionId}
 *       a site's grant: sealed tokens, its choices, status, sync times;
 *   hosts/{hostId}/pluginConnections/oauth-{hash}
 *       a pending connect's single-use state record.
 */

/** Top-level collection of the publisher OAuth app credentials, one per listing and connection. */
export const PLUGIN_CONNECTION_CREDENTIALS_COLLECTION = 'pluginConnectionCredentials'

/** A site's connections: `hosts/{hostId}/pluginConnections`. */
export const PLUGIN_CONNECTIONS_HOST_COLLECTION = 'pluginConnections'

/** The id shared by a listing's credentials and a site's connection: `{listingId}__{connectionId}`. */
export function pluginConnectionDocId(listingId: string, connectionId: string): string {
  return `${listingId}__${connectionId}`
}

/** The console API paths (served at `/api/<path>`). The callback is registered at providers; never rename it. */
export const PLUGIN_CONNECTIONS_API_ROUTES = {
  connectStart: 'plugin-connections/connect/start',
  connectCallback: 'plugin-connections/connect/callback',
  resources: 'plugin-connections/resources',
  choose: 'plugin-connections/choose',
  disconnect: 'plugin-connections/disconnect',
  status: 'plugin-connections/status',
  credentials: 'plugin-connections/credentials',
} as const

/** The first path segment every route above shares: the plugin's API prefix. */
export const PLUGIN_CONNECTIONS_API_PREFIX = 'plugin-connections'

/**
 * A site connection's state.
 *
 * - `connected`: the grant works. `ready` on the view says whether every
 *   declared resource has been chosen, which a sync waits for.
 * - `reconnect_required`: the provider refused the grant (revoked, expired,
 *   scopes withdrawn); only the site owner connecting again fixes it.
 * - `error`: the last sync or refresh failed for another reason; the next
 *   run tries again.
 */
export type PluginConnectionStatus = 'connected' | 'reconnect_required' | 'error'

/** One resource the site owner chose: the id the provider gave it and what the picker showed. */
export interface PluginConnectionChoice {
  id: string
  label: string
}

/** What the console may see of a site's connection: never a token, a lease or a secret. */
export interface PluginConnectionView {
  listingId: string
  connectionId: string
  provider: string
  status: PluginConnectionStatus
  /** The choices made so far, by resource id. */
  choices: Record<string, PluginConnectionChoice>
  /** Whether every declared resource is chosen. */
  ready: boolean
  scopes: string[]
  connectedAtMs: number
  lastSyncAtMs: number | null
  lastError: string | null
}

/** One declared connection of a plugin installed on a site, with where it stands. */
export interface PluginConnectionStatusEntry {
  listingId: string
  connectionId: string
  provider: string
  label: string
  description?: string
  /** The resources the owner picks, in order. */
  resources: Array<{ id: string; label: string }>
  /** The site's connection, or `null` before one is made. */
  connection: PluginConnectionView | null
  /** Whether the publisher has set the listing's OAuth app credentials. */
  credentialsSet: boolean
  /** Whether the workspace's plan includes connections. */
  planAllows: boolean
}

/** Whether a listing's OAuth app credentials are set: the only thing ever read back. */
export interface PluginConnectionCredentialsStatus {
  connectionId: string
  label: string
  set: boolean
  updatedAtMs: number | null
}

/* ------------------------------------------------------------------ */
/* The plan feature                                                     */
/* ------------------------------------------------------------------ */

/** The plan feature key: connections are on Starter, Pro and Custom, off on Free. */
export const PLUGIN_CONNECTIONS_FEATURE = 'pluginConnections'

/** The plan defaults. The retired plans sit above Pro on the ladder, so they keep it. */
export const PLUGIN_CONNECTIONS_BY_PLAN: Readonly<Record<OrgPlan, boolean>> = {
  free: false,
  starter: true,
  pro: true,
  business: true,
  scale: true,
  advanced: true,
  agency: true,
  enterprise: true,
}

/** The feature as the marketplace declares it (`registerPluginEntitlements`). */
export const PLUGIN_CONNECTIONS_FEATURE_DECLARATION: PluginFeatureDeclaration = {
  key: PLUGIN_CONNECTIONS_FEATURE,
  label: 'Plugin connections',
  defaultByPlan: PLUGIN_CONNECTIONS_BY_PLAN,
}

/** What a plan without the feature is told. Names the plans, never a price. */
export const PLUGIN_CONNECTIONS_PLAN_REFUSAL =
  'Connecting a plugin to another service comes with the Starter, Pro and Custom plans.'

/* ------------------------------------------------------------------ */
/* The permission keys                                                  */
/* ------------------------------------------------------------------ */

/** The site key: connect, choose, disconnect and read a site's plugin connections. */
export const PLUGIN_CONNECTIONS_SITE_PERMISSION = 'marketplace.siteConnections'

/** The publisher key: set a listing's OAuth app credentials. */
export const PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION = 'marketplace.connectionCredentials'

/** The site Admin (declared beside the marketplace's other site keys). */
export const PLUGIN_CONNECTIONS_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> =
  MARKETPLACE_CONNECTION_SITE_ROLE_PRESET

/** The site key as the plugin declares it into the org permission catalog. */
export const PLUGIN_CONNECTIONS_SITE_PERMISSION_DECLARATION: PluginOrgPermissionDeclaration =
  MARKETPLACE_CONNECTION_SITE_PERMISSIONS[0]

/** The publisher key as the plugin declares it; owners and admins hold it by default. */
export const PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION_DECLARATION: PluginPermission =
  MARKETPLACE_PUBLISHER_PERMISSIONS.find((entry) => entry.key === PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION) as PluginPermission

/** The refusal a door answers without a key: names the permission, never a role. */
export function pluginConnectionsPermissionRefusal(
  key: typeof PLUGIN_CONNECTIONS_SITE_PERMISSION | typeof PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION,
): string {
  const label =
    key === PLUGIN_CONNECTIONS_SITE_PERMISSION
      ? PLUGIN_CONNECTIONS_SITE_PERMISSION_DECLARATION.label
      : PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION_DECLARATION.label
  return `Your role does not include "${label}" — ask an organization admin`
}
