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

import { createContext, useContext } from 'react'
import type { TransferUnfinishedImportSummary } from '../data-transfer/transfer-api'

/**
 * The console shell's import wizard and export dialog, for a plugin to open.
 *
 * The wizard and the dialog are the console's private UI kit, which a
 * published plugin cannot depend on. So the shell hands down a launcher
 * through this context, and a plugin's list or hub opens the wizard for its
 * own resource — the key it declared in `transferResources` — with
 * `useTransferLauncher()?.openImport({ resource, scope })`.
 *
 * Outside the console shell — a spec, a tenant page, a surface mounted by
 * something else — the context holds `null`, and a plugin hides its Import
 * and Export actions: with no shell there is no workspace to move data into.
 *
 * Inside it, `can('import' | 'export', target)` says which of the two this
 * person may use (AGL-3546): a plugin shows Import only when `can('import')`
 * and Export only when `can('export')`. The transfer routes stay the
 * enforcement; `can` answers what they would.
 *
 * Only types and a context: it names no resource, imports nothing from the
 * transfer core, and so costs the barrel nothing past React.
 *
 * A client-only context like the others in `contexts.ts`: it calls
 * `createContext` at module scope, so it is reachable from the full
 * `@aglyn/aglyn` barrel (and this subpath) and never from
 * `@aglyn/aglyn/server` (AGL-405).
 */

/** Where the records live: the workspace, or one of its sites. */
export type TransferLaunchScope = 'org' | 'host'

/** Opens the import wizard on one resource. */
export interface TransferImportLaunch {
  /**
   * The resource key the plugin declared in `transferResources` — for one
   * declared with `instances`, the key naming the instance
   * (`data.dataset:<datasetId>`).
   */
  resource: string
  scope: TransferLaunchScope
  /** The wizard's title, naming the instance ("Import into Products"); "Import <resource label>" when absent. */
  title?: string
  /** The site, for a `host` resource. */
  hostId?: string | null
  /** Resume this import instead of starting a new one. */
  jobId?: string | null
  /**
   * What the file is imported as, as the `importMapping` zone's widgets know
   * it (`contacts`); omitted, the mapping step shows no zone.
   */
  mappingZone?: string
  /** Called when the person leaves the wizard from its results with Done. */
  onFinished?(): void
}

/** Opens the export dialog on one resource. */
export interface TransferExportLaunch {
  /** The resource key the plugin declared in `transferResources`, naming the instance for one declared with `instances`. */
  resource: string
  scope: TransferLaunchScope
  /** The dialog's title, naming the instance ("Export Products"); "Export <resource label>" when absent. */
  title?: string
  /** The site, for a `host` resource. */
  hostId?: string | null
  /** The record ids the person selected in the list, when there is a selection. */
  selection?: readonly string[]
  /** The list's current filter: a name for it, and the value the resource's `readPage` reads. */
  filter?: { label: string; value: unknown }
  /**
   * One of the resource's own presets to open on (`TransferResourcePreset.id`)
   * — a list's "Export for Pirate Ship" — instead of the person's last
   * choice. An id the resource does not offer is ignored.
   */
  preset?: string
}

/** What a person may do with a resource's records. */
export type TransferAction = 'import' | 'export'

/** The resource a list asks {@link TransferLauncher.can} about. */
export interface TransferAccessTarget {
  /** The resource key, naming the instance for one declared with `instances`. */
  resource: string
  scope: TransferLaunchScope
  /** The site, for a `host` resource or a workspace resource read through one site. */
  hostId?: string | null
}

/**
 * An import the person started and left before it wrote anything
 * (AGL-3549) — a tab closed mid-wizard — which `openImport({ jobId })`
 * reopens on the step it was left at.
 */
export type TransferUnfinishedImport = TransferUnfinishedImportSummary

/** What the shell offers: open the wizard or the dialog, or close whichever is open. */
export interface TransferLauncher {
  openImport(launch: TransferImportLaunch): void
  openExport(launch: TransferExportLaunch): void
  close(): void
  /**
   * Whether the person may `action` the target's records (AGL-3546) — the
   * answer the transfer routes give, from the permissions the shell already
   * holds: synchronous, with no request per button, and `false` until those
   * permissions have answered. Importing needs "Manage data" (on the named
   * site, for a site's records); exporting needs only access to the
   * records — membership, and reaching the named site — unless the resource
   * declares a `readPermission`. The routes stay the enforcement.
   */
  can(action: TransferAction, target: TransferAccessTarget): boolean
  /**
   * The person's own unfinished imports (AGL-3549), newest first: of the
   * target's resource — the exact key, so one dataset's are not another's —
   * on the target's site when it names one, when a target is given; every
   * one otherwise. Empty
   * until the shell has read them; the first ask starts the read, and the
   * list is read again whenever the wizard closes. Only for a person who may
   * import into the workspace.
   */
  unfinished?(target?: TransferAccessTarget): readonly TransferUnfinishedImport[]
  /**
   * Throws an unfinished import away now — its job, its file and its saved
   * choices — instead of leaving it to expire. Refused for an import that
   * has written anything, which is undone instead.
   */
  discard?(jobId: string): Promise<void>
}

export const TransferLauncherContext = createContext<TransferLauncher | null>(null)
TransferLauncherContext.displayName = 'TransferLauncherContext'

/** The shell's launcher, or `null` outside the console shell. */
export function useTransferLauncher(): TransferLauncher | null {
  return useContext(TransferLauncherContext)
}

