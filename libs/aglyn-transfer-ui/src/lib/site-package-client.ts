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

/*==========================================
 * THE SITE PACKAGE CLIENT — what the package import wizard and the package
 * export dialog ask of the server (AGL-3534).
 *
 * A site package does not ride the row job engine (`docs/DATA_TRANSFER.md`
 * § Site packages): it has its own routes, `/api/hosts/import` (plan,
 * compare, apply, undoPlan, undo) and `/api/hosts/export` (the file, a
 * selection, or the manifest alone). The kit never fetches; a surface hands
 * it a client bound to one site, and the console's implementation calls
 * those routes. Every shape is the core's
 * (`@aglyn/aglyn/data-transfer/site-package`), so the kit and the route
 * cannot disagree about what a plan or a decision is.
 *=========================================*/

import type {
  PackageItemDecision,
  PackageManifest,
} from '@aglyn/aglyn/data-transfer'
import type {
  SitePackageDependencyChoice,
  SitePackageMergeChoice,
  SitePackagePlan,
  SitePackagePlanItem,
  SitePackageWarning,
} from '@aglyn/aglyn/data-transfer/site-package'

export type {
  PackageItemDecision,
  PackageManifest,
  SitePackageDependencyChoice,
  SitePackageMergeChoice,
  SitePackagePlan,
  SitePackagePlanItem,
  SitePackageWarning,
}

/** Everything the person decided, as the import route takes it. */
export interface SitePackageDecisions {
  /** By item key; every item, so nothing rides on the server's proposal unseen. */
  decisions: Record<string, PackageItemDecision>
  /** By dependency key (`<kind>/<id>`). */
  dependencyChoices: Record<string, SitePackageDependencyChoice>
  /** By merged item key, then top-level key. */
  mergeChoices: Record<string, Record<string, SitePackageMergeChoice>>
}

/** The plan route's answer. */
export interface SitePackagePlanAnswer {
  /** 1 for a backup made before packages, converted on the server. */
  format: 1 | 2
  plan: SitePackagePlan
  /** The sentence the apply would be refused with, counting only what it adds. */
  capRefusal: string | null
  /** What the decisions sent would do to references (at most 200 of them). */
  warnings: SitePackageWarning[]
  warningsTotal: number
  /** Kinds this site cannot read: a plugin it lacks. */
  unknownKinds: string[]
  /** Site emails under a key the platform does not send. */
  notSent: string[]
}

/** One item, both sides, as an import would write each. */
export interface SitePackageComparison {
  key: string
  kind: string
  id: string
  /** The file's item. */
  incoming: unknown
  /** The site item it was matched to; `null` for a new item. */
  existing: { id: string; content: unknown } | null
}

/** The apply route's answer. */
export interface SitePackageApplyAnswer {
  importId: string
  /** Documents written. */
  written: number
  /** Items by decision. */
  counts: Record<string, number>
  warnings: SitePackageWarning[]
  warningsTotal: number
}

/** An item edited since the import: undo leaves it unless told to revert. */
export interface SitePackageUndoConflict {
  key: string
  kind: string
  targetId: string
  name?: string
  /** What reverting it does: put the previous content back, or delete it. */
  step: 'restore' | 'delete'
}

/** What undo would do. */
export interface SitePackageUndoPlan {
  importId: string
  counts: { restore: number; delete: number; conflict: number }
  conflicts: SitePackageUndoConflict[]
}

/** What undo did. */
export interface SitePackageUndoAnswer {
  importId: string
  reverted: number
  kept: number
  restoredDocuments: number
  deletedDocuments: number
}

/** The site's own items, for the export picker and for mapping a dependency. */
export interface SitePackageCatalog {
  manifest: PackageManifest
  kinds: Array<{ kind: string; label: string }>
}

export type SitePackageUndoChoice = 'revert' | 'keep'

export interface SitePackageClient {
  /** Plans the file against the site, with the decisions made so far. Writes nothing. */
  plan(file: unknown, decided?: Partial<SitePackageDecisions>): Promise<SitePackagePlanAnswer>
  /** Both sides of up to ten items. Writes nothing. */
  compare(file: unknown, keys: readonly string[]): Promise<SitePackageComparison[]>
  apply(file: unknown, decided: SitePackageDecisions): Promise<SitePackageApplyAnswer>
  undoPlan(importId: string): Promise<SitePackageUndoPlan>
  undo(
    importId: string,
    choices: { decisions: Record<string, SitePackageUndoChoice>; otherwise: SitePackageUndoChoice },
  ): Promise<SitePackageUndoAnswer>
  /** The site's manifest alone. */
  catalog(): Promise<SitePackageCatalog>
  /** The file: everything, or the items named, with what they need when asked. */
  exportPackage(selection: {
    items?: readonly string[]
    dependencies?: boolean
  }): Promise<{ fileName: string; body: Blob }>
}

/** How many items one compare may name; the route's own limit. */
export const SITE_PACKAGE_COMPARE_MAX = 10
