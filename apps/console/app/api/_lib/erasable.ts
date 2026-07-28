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
 * What `/api/resources/erase` will recursively delete, and under which
 * scope (AGL-945/946/947, narrowed by the AGL-1050 follow-up).
 *
 * Extracted from the route for the reason the route already gives about
 * `eraseScopeDenial`: `route.ts` may only export handlers, and a
 * destructive decision that cannot be unit-tested is the shape of control
 * this project exists to avoid (`feedback_verify_control_is_wired`). The
 * scope whitelist is exactly such a decision — see {@link isErasable}.
 */

export type Scope = 'orgs' | 'hosts'

export interface ErasableResource {
  /** Scopes this kind may be addressed under. */
  scopes: readonly Scope[]
  /** Human label for messages — "Dataset", "List". */
  label: string
}

/**
 * The resources whose deletion has to cascade. Each parent owns a
 * subcollection, and a client-side `deleteDoc` would orphan it. The kind is
 * a whitelist, not a passthrough: the caller names a resource, never a
 * Firestore path, so no request can walk the route into an arbitrary
 * subtree.
 *
 * ## Why `datasets` and `lists` are org-only
 *
 * They accepted `'hosts'` too, back when the console cards resolved their
 * scope as `['orgs', orgId]` with an `['hosts', hostId]` fallback. AGL-1050
 * deleted that fallback — production held zero documents under it and the
 * rules now deny it — so the second scope addressed nothing.
 *
 * It was not merely redundant. The route runs its AGL-1046 boundary check
 * (`eraseScopeDenial`, which is what stops a site collaborator destroying a
 * dataset AGL-1041 forbids them to read) ONLY on the `orgs` branch; the
 * `hosts` branch checks site `memberRoles` and never looks at `visibleTo`,
 * because host content has none. So naming `'hosts'` for an org resource
 * was a way to ask for the weaker check. Nothing was ever destroyable
 * through it — the path is empty — but the Admin SDK evaluates no rules,
 * and a second accepted scope is a second boundary to keep correct forever.
 */
export const ERASABLE: Record<string, ErasableResource> = {
  // orgs/{orgId}/datasets/{id}/records — form submissions, automation rows.
  datasets: { scopes: ['orgs'], label: 'Dataset' },
  // orgs/{orgId}/lists/{id}/members — enrolled contacts (PII).
  lists: { scopes: ['orgs'], label: 'List' },
  // hosts/{hostId}/collections/{id}/entries — published content entries.
  // The ONLY genuinely host-scoped kind: a collection lives on the host, it
  // is not an org resource with a host fallback.
  collections: { scopes: ['hosts'], label: 'Collection' },
}

/**
 * The resource for a (kind, scope) pair, or null if that pair is not
 * erasable — an unknown kind, or a known kind named under a scope it does
 * not live in. The route turns null into a 400 before it reads anything.
 */
export function isErasable(
  kind: string,
  scope: string,
): ErasableResource | null {
  const erasable = ERASABLE[kind]
  if (!erasable) return null
  return erasable.scopes.includes(scope as Scope) ? erasable : null
}

export default ERASABLE
