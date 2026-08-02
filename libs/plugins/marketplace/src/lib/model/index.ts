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
 * Marketplace marketplace model (AGL-413): listing/profile shapes + publish sanitization relocated from core app-utils.
 * Context-free — importable by client components, /server handlers, and
 * other plugins/apps via `@aglyn/plugins-marketplace/model`.
 */
export * from './marketplace'
/**
 * Provenance and update state live in core (AGL-1015/1016) so the console can
 * read them too, but they are marketplace vocabulary — re-exported here so a
 * publishing or install route still imports the whole model from one place.
 * Named rather than star-exported: `MarketplaceArtifactType` is re-exported by
 * `./marketplace` already, and two barrels claiming it is an ambiguity.
 *
 * Deep paths rather than a core barrel, for the same reason `./marketplace`
 * uses one: this module is in the browser bundle AND in API routes, so
 * `@aglyn/aglyn` (createContext) and `@aglyn/aglyn/server` (node:fs) are both
 * unusable from here.
 */
export {
  ARTIFACT_BASE_COLLECTION,
  ARTIFACT_BASE_MAX_BYTES,
  resolveProvenance,
  stableStringify,
  type InstalledFrom,
  type ProvenanceState,
  type ResolvedProvenance,
} from '@aglyn/aglyn/app-utils/marketplace-provenance'
export {
  applyArtifactUpdate,
  describeChange,
  planArtifactUpdate,
  summarizeSchemaChange,
  summarizeValue,
  type ArtifactChange,
  type ArtifactUpdatePlan,
  type ChangeKind,
} from '@aglyn/aglyn/app-utils/marketplace-merge'
export {
  compareArtifactVersions,
  resolveUpdateState,
  updateStateLabel,
  type UpdateComparableInstall,
  type UpdateComparableListing,
  type UpdateState,
  type UpdateStatus,
} from '@aglyn/aglyn/app-utils/marketplace-update-state'
