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
 * The marketplace hub's own URLs, built from the path the shell mounted it at
 * (AGL-3080).
 *
 * These were `buildRoute(Route.ORG_MARKETPLACE_LISTING, …)` against the
 * console's route table while the hub was a set of hand-written console
 * routes. A plugin cannot import that table, and should not want to: the hub
 * is served by the generic org plugin route, which hands every page its
 * `basePath` — the absolute path this surface is mounted at under the
 * current organization. Everything beneath it is this plugin's to name.
 *
 * That is also what makes the surface MOVABLE. The addresses below are the
 * ones the console has always served, because `basePath` resolves to
 * `/{orgSlug}/marketplace` today; a workspace that mounted the hub somewhere
 * else would get consistent links rather than links into the old place.
 *
 * ⚠️ These segments appear in links people keep — a bookmark, a docs link, an
 * email the console itself sent. Treat them as persisted.
 */

/** One listing's detail page. */
export function listingPath(basePath: string, listingId: string): string {
  return `${basePath}/${encodeURIComponent(listingId)}`
}

/**
 * The publish-a-plugin form. `listingId` binds it to an existing listing, so
 * the same form ships a new version instead of creating a second listing.
 */
export function publishPluginPath(
  basePath: string,
  listingId?: string,
): string {
  const path = `${basePath}/publish/plugin`
  return listingId ? `${path}?listing=${encodeURIComponent(listingId)}` : path
}

/** A publisher's public profile, by handle. */
export function publisherPath(basePath: string, handle: string): string {
  return `${basePath}/publisher/${encodeURIComponent(handle)}`
}
