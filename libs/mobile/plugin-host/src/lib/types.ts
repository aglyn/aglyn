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
 * The mobile plugin surface (AGL-3620): what a plugin contributes to the
 * Aglyn app, and what the app hands a plugin's screens.
 *
 * It mirrors the web plugin manager's shape on purpose. A plugin declares its
 * contributions under `mobile` in `plugins.config.json`; the generator writes
 * them into the app's mobile manifest; the app loads each plugin's `./mobile`
 * entry and calls its registrar, which calls the `registerMobile…` functions
 * here. The shell reads only this registry, so it never names a plugin.
 *
 * Nothing in this file may import React Native: the types are read by the
 * manifest generator's validation and by plugin specs that run anywhere.
 */

import type { ComponentType } from 'react'

/** A route parameter bag, as navigation and deep links carry it. */
export type MobileParams = Readonly<Record<string, string | undefined>>

/**
 * The app's typed client for console API routes. Implemented in
 * `@aglyn/mobile-core`; declared here structurally so a plugin's registrar
 * does not need the core to type its screens. `path` is the full route path
 * (`/api/...`); a non-2xx rejects with a `ConsoleApiError` carrying
 * `status` and the route's `error` as its message.
 */
export interface MobileApiClient {
  request<T = unknown>(
    path: string,
    init?: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
      signal?: AbortSignal
      /** Sent as `Idempotency-Key`; makes a write safe to retry. */
      idempotencyKey?: string
    },
  ): Promise<T>
}

/**
 * What a plugin's screen, widget or action is given. The workspace and site
 * are the ones the person picked in the switcher; `hostId` is null until a
 * site is picked, and a contribution that needs one says `requiresSite`.
 */
export interface MobilePluginContext {
  readonly uid: string
  readonly orgId: string | null
  readonly hostId: string | null
  /** The console's URL slugs for the same pick (`/{orgSlug}/hosts/{hostSlug}`). */
  readonly orgSlug: string | null
  readonly hostSlug: string | null
  /** The Firebase JS SDK Firestore instance, under the console's own rules. */
  readonly firestore: unknown
  readonly api: MobileApiClient
  /** Opens a registered screen by id. */
  navigate(screenId: string, params?: MobileParams): void
  /**
   * Opens a console path in the authenticated WebView (the long tail).
   * `site` and `org` put the picked site's or workspace's prefix in front,
   * so a plugin names its own page (`/redirects`) and not the console's
   * URL scheme.
   */
  openConsolePath(path: string, scope?: 'site' | 'org' | 'absolute'): void
}

export interface MobileScreenProps {
  readonly params: MobileParams
  readonly context: MobilePluginContext
}

export interface MobileWidgetProps {
  readonly context: MobilePluginContext
}

/** A lazily loaded component module, the shape `React.lazy` takes. */
export type LazyComponent<P> = () => Promise<{ default: ComponentType<P> }>

interface Owned {
  /** The plugin id from `plugins.config.json`. */
  readonly pluginId: string
  /** Unique across the app; by convention `<pluginId>.<name>`. */
  readonly id: string
}

export interface MobileScreen extends Owned {
  readonly title: string
  readonly load: LazyComponent<MobileScreenProps>
  /** True when the screen reads the picked site; the shell asks for one first. */
  readonly requiresSite?: boolean
}

export interface MobileTab extends Owned {
  readonly title: string
  /** An Ionicons glyph name from `@expo/vector-icons`. */
  readonly icon: string
  /** The screen this tab opens at its root. */
  readonly screen: string
  /** Lower first. The shell's own Home is 0 and More is 1000. */
  readonly order: number
}

export interface MobileDashboardWidget extends Owned {
  readonly title: string
  readonly order: number
  /** `half` pairs two widgets on a row on tablets; phones stack everything. */
  readonly size?: 'half' | 'full'
  readonly requiresSite?: boolean
  readonly load: LazyComponent<MobileWidgetProps>
}

export interface MobileQuickAction extends Owned {
  readonly title: string
  readonly icon: string
  readonly order: number
  readonly requiresSite?: boolean
  /** Opens this screen... */
  readonly screen?: string
  readonly params?: MobileParams
  /** ...or this console path in the WebView. Exactly one of the two. */
  readonly consolePath?: string
}

export interface MobileDeepLink extends Owned {
  /**
   * A console path pattern this plugin answers natively, e.g.
   * `/redirects/:redirectId`. `:name` segments become screen params; the
   * org/site prefix the console puts in front is stripped before matching.
   */
  readonly path: string
  readonly screen: string
}

export type MobileContributionKind =
  | 'screens'
  | 'tabs'
  | 'widgets'
  | 'quickActions'
  | 'deepLinks'

/**
 * A plugin's mobile declaration as `plugins.config.json` states it and the
 * generated manifest carries it: the ids it registers, by kind. The loader
 * refuses a registration the declaration does not name, so the config is the
 * honest inventory of what a plugin adds to the app.
 */
export type MobileContributionDeclaration = Partial<
  Record<MobileContributionKind, readonly string[]>
>

export interface MobilePluginManifestEntry {
  readonly id: string
  /** The registrar's export name in the plugin's `./mobile` entry. */
  readonly register: string
  readonly contributes: MobileContributionDeclaration
  readonly load: () => Promise<Record<string, unknown>>
}

export type MobilePluginManifest = readonly MobilePluginManifestEntry[]
