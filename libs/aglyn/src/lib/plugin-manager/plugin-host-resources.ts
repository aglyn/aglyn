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

import { ACTIONS_MAX_PER_HOST, WEBHOOK_MAX_PER_HOST } from '../app-utils/actions'
import { PLUGIN_HOST_COLLECTIONS_DECLARED } from './first-party-plugins.generated'

/**
 * A plugin's host collection as a KIND the platform's generic create route
 * writes (AGL-3080).
 *
 * `/api/hosts/resources` is the only door a client creates quota-governed
 * site documents through: the rules deny client `create` on each of these
 * collections, and the route is the allow-list of what a client may write
 * (AGL-1377), the count it is met against (AGL-473, AGL-2231) and the
 * provenance it stamps (AGL-118). `duplicateResource` is its twin for a copy.
 * Both used to hold every plugin's row — which collection a workflow lives
 * in, which entitlement a product needs, which fields a redirect may carry —
 * so the platform was the keeper of its plugins' document models, and a
 * plugin could not add a kind without editing core.
 *
 * So the plugin that owns a collection declares the kind it is created as,
 * beside the collection itself in the `hostCollections` block of
 * `plugins.config.json` (a host collection's `resource`),
 * and both readers ask this module.
 *
 * ## Compiled, and refused when absent
 *
 * The route is a SECURITY path: its field list is what stands between a
 * client and a document the UI later presents as trustworthy. A runtime
 * registry that one process had not filled would either refuse a legitimate
 * create or — worse, if a reader ever fell back to an open list — store
 * whatever it was sent. So these rows are compiled by
 * `tools/scripts/generate-plugin-manifests.mjs`, present the moment this
 * module is imported, and a kind nobody declares is REFUSED as an unknown
 * resource. There is no registrar: `registerPluginHostCollections` refuses a
 * declaration that carries a `resource`.
 *
 * The generator checks what a reader would otherwise have to trust: one owner
 * per kind and none of core's own; a count on every kind (a plan `quotaKey` or
 * a `platformCap`); no server-stamped field, stamp or approver field on the
 * client's list; `externalDestination` only with the publishing role; and a
 * copy's fields a subset of the create's.
 *
 * ## What core keeps
 *
 * The NUMBERS. A declaration names its plan counter and feature flag as keys
 * (`quotaKey`, `entitlement`) and core's plan table resolves them, exactly as
 * it does for its own kinds. A flat platform cap is named the same way —
 * `platformCap` is the name of a constant core holds, resolved by
 * {@link hostResourcePlatformCap} — so no plugin carries a number that is the
 * platform's abuse ceiling. Core also keeps everything a create does for
 * EVERY kind: the role gate, the lockdown verdict, the transaction that counts
 * and writes, the node codec, the timestamps and `createdBy`.
 *
 * Reached by its own subpath, never the barrel: its readers are server routes.
 */

/** A constant value a create writes: never the client's, never another stamp's. */
export type PluginHostResourceStampValue = string | number | boolean | null

/** How a whole copy of the kind is made, when the kind can be duplicated. */
export interface PluginHostResourceDuplicate {
  /** The field the name lives in; the copy's is made unique among the live siblings. */
  nameField: string
  /** The source fields carried onto the copy — a subset of the create's. */
  fields: readonly string[]
  /** What the copy carries beyond the source's fields: a cleared trigger. */
  stamps?: Readonly<Record<string, PluginHostResourceStampValue>>
}

export interface PluginHostResourceDeclaration {
  /** The `resource` a caller names, in camelCase: `product`, `workflow`. */
  kind: string
  /** Plural, for quota copy: "this site can run 5 {label}". */
  label: string
  /** Singular, for the site activity line: "Created {activityNoun}". */
  activityNoun: string
  /** The activity target type a row filters and deep-links by; `content` when absent. */
  activityType?: string
  /** The plan counter, an `OrgEntitlements` key core resolves. */
  quotaKey?: string
  /** The plan feature the kind needs at all, an `OrgFeatureFlags` key. */
  entitlement?: string
  /** A flat platform cap by the name of core's constant; see {@link hostResourcePlatformCap}. */
  platformCap?: string
  /** Deleting stamps `deletedAt`, so the cap counts live documents only. */
  softDeletes?: boolean
  /** Creating it needs the publishing role rather than the write role. */
  requiresPublishRole?: boolean
  /** The keys a client may set. Anything else it sends is dropped. */
  fields: readonly string[]
  /** Constant values every create writes, e.g. `deletedAt: null` for a kind born live. */
  stamps?: Readonly<Record<string, PluginHostResourceStampValue>>
  /**
   * A destination field that may point off the platform. When the value is
   * not a site path, the creating publisher's VERIFIED uid is stamped into
   * `approvedByField` — the evidence a serve path trusts that somebody chose
   * to send traffic away. Only with `requiresPublishRole`.
   */
  externalDestination?: { field: string; approvedByField: string }
  /**
   * The field holding the site path the document answers at the moment it
   * exists. A create announces it to the site cache, because what used to
   * answer there is already cached as the page.
   */
  livePathField?: string
  duplicate?: PluginHostResourceDuplicate
}

/** A declaration with the plugin that made it and the collection it writes. */
export type ResolvedPluginHostResource = PluginHostResourceDeclaration & {
  pluginId: string
  /** The subcollection under `hosts/{hostId}` the kind is created in. */
  collection: string
}

/** Every declared kind, in config order. */
export function listPluginHostResources(): ResolvedPluginHostResource[] {
  const out: ResolvedPluginHostResource[] = []
  for (const row of PLUGIN_HOST_COLLECTIONS_DECLARED) {
    if (row.resource) {
      out.push({ ...row.resource, pluginId: row.pluginId, collection: row.name })
    }
  }
  return out
}

/** One declared kind, or `null` — which every reader treats as unknown. */
export function pluginHostResource(kind: unknown): ResolvedPluginHostResource | null {
  if (typeof kind !== 'string' || !kind) return null
  return listPluginHostResources().find((one) => one.kind === kind) ?? null
}

/**
 * The flat platform caps a declaration may name (AGL-1360, AGL-2266): a
 * ceiling on documents mintable from a browser that no plan varies, so it has
 * no `OrgEntitlements` key. Keyed by the constant's own name, so a search for
 * the constant finds the declaration that uses it.
 */
const HOST_RESOURCE_PLATFORM_CAPS: Readonly<Record<string, number>> = {
  ACTIONS_MAX_PER_HOST,
  WEBHOOK_MAX_PER_HOST,
}

/**
 * The number a `platformCap` names, or `null` for a name core does not hold —
 * which the create route answers by refusing, never by leaving it uncapped.
 */
export function hostResourcePlatformCap(name: string): number | null {
  return Object.prototype.hasOwnProperty.call(HOST_RESOURCE_PLATFORM_CAPS, name)
    ? HOST_RESOURCE_PLATFORM_CAPS[name]
    : null
}
