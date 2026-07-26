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

import type { ComponentType } from 'react'

/**
 * Site-runtime registry (AGL-419): non-visual (or overlay) components a
 * plugin runs on every rendered tenant page — experiment runners,
 * automation engines, announcement bars/popups. Registered from the
 * plugin's SITE register fn (same surface as canvas components) and
 * rendered generically by the tenant catch-all, which passes the page
 * props bag; each runtime picks the slices it owns (the shapes it wrote
 * server-side via its page enricher).
 */
export interface SiteRuntimeProps {
  hostId?: string
  /** Host routing map (screen id → path) for rename-safe navigation. */
  screens?: Record<string, string>
  /** The page props composed by load-page-data (enricher output included). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: Record<string, any>
}

/**
 * Context handed to {@link SiteRuntimeEntry.loadPreviewProps} (AGL-830). The
 * besigner Preview renders draft nodes with no server enricher, so a runtime
 * that needs page-props (e.g. the marketing automations engine) rebuilds its
 * own slice client-side from the passed Firestore instance.
 */
export interface SiteRuntimePreviewContext {
  hostId?: string
  /** Client Firestore instance (typed `unknown` to avoid a firebase dep here). */
  firestore: unknown
}

export interface SiteRuntimeEntry {
  pluginId: string
  runtimeId: string
  Component: ComponentType<SiteRuntimeProps>
  /**
   * Optional (AGL-830): build this runtime's `page`-props slice client-side
   * for the editor Preview, where no server enricher runs. The returned bag
   * is passed as the runtime's `page` prop. Absent → the runtime gets `{}`.
   */
  loadPreviewProps?: (
    ctx: SiteRuntimePreviewContext,
  ) => Promise<Record<string, unknown>>
}

const runtimes: SiteRuntimeEntry[] = []

export function registerSiteRuntime(entry: SiteRuntimeEntry): void {
  if (runtimes.some((r) => r.runtimeId === entry.runtimeId)) return
  runtimes.push(entry)
}

export function listSiteRuntimes(): readonly SiteRuntimeEntry[] {
  return runtimes
}
