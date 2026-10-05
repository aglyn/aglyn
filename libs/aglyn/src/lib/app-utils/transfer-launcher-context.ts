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
  /** The resource key the plugin declared in `transferResources`. */
  resource: string
  scope: TransferLaunchScope
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
  /** The resource key the plugin declared in `transferResources`. */
  resource: string
  scope: TransferLaunchScope
  /** The site, for a `host` resource. */
  hostId?: string | null
  /** The record ids the person selected in the list, when there is a selection. */
  selection?: readonly string[]
  /** The list's current filter: a name for it, and the value the resource's `readPage` reads. */
  filter?: { label: string; value: unknown }
}

/** What the shell offers: open the wizard or the dialog, or close whichever is open. */
export interface TransferLauncher {
  openImport(launch: TransferImportLaunch): void
  openExport(launch: TransferExportLaunch): void
  close(): void
}

export const TransferLauncherContext = createContext<TransferLauncher | null>(null)
TransferLauncherContext.displayName = 'TransferLauncherContext'

/** The shell's launcher, or `null` outside the console shell. */
export function useTransferLauncher(): TransferLauncher | null {
  return useContext(TransferLauncherContext)
}
