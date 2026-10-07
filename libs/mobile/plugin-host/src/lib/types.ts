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
  /**
   * The device's card reader (Tap to Pay or a connected Bluetooth reader),
   * when the app drives one: Aglyn POS does, the Aglyn app does not, so a
   * screen that takes a card shows its alternative when this is absent.
   */
  readonly cardReader?: MobileCardReader | null
  /**
   * Scans one barcode or QR code with the camera and resolves its text, or
   * null when the person closed the scanner. Absent in an app that ships no
   * camera scanner.
   */
  readonly scanCode?: (prompt: string) => Promise<string | null>
  /** False while the device has no connection; screens hold writes then. */
  readonly online?: boolean
}

/*==========================================
 * DEVICE CAPABILITIES (AGL-3618).
 *
 * What an app's hardware does for a plugin, described by what it does and
 * never by the SDK behind it. The money stays the server's: a plugin's route
 * makes the payment intent, the reader only presents the card to it, and the
 * plugin's route reads the outcome back from the processor rather than
 * trusting the device's word.
 *=========================================*/

/** One card-present payment for the reader to collect. */
export interface MobileCardCollectRequest {
  readonly paymentIntentId: string
  /** The intent's client secret, which names the intent it belongs to. */
  readonly clientSecret: string
  /**
   * What the customer was shown, tip included. The reader refuses an intent
   * for any other amount before it asks for the card.
   */
  readonly amountCents: number
  /** Let a reader that can show a tip screen ask the customer for one. */
  readonly tipEligible?: boolean
}

export type MobileCardCollectOutcome =
  | { status: 'collected'; paymentIntentId: string; amountCents: number; tipCents: number }
  | { status: 'canceled'; paymentIntentId: string }
  | { status: 'failed'; paymentIntentId: string; message: string }

export interface MobileCardReaderState {
  readonly connected: boolean
  readonly kind: 'tapToPay' | 'bluetooth' | null
  /** The reader's name for the person ("Tap to Pay", "Stripe Reader M2"). */
  readonly label: string | null
  /** A payment is being collected. */
  readonly busy: boolean
  /** Test-mode keys: simulated readers and test cards only. */
  readonly testMode: boolean
  /** What the reader asks the customer to do right now. */
  readonly prompt: string | null
}

export interface MobileCardReader {
  readonly state: MobileCardReaderState
  /** Never rejects: every outcome is one of the three. */
  collect(request: MobileCardCollectRequest): Promise<MobileCardCollectOutcome>
  /** Stops the collection in progress, if any. */
  cancel(): Promise<void>
  /** Opens the app's reader setup: find, connect and update readers. */
  manage(): void
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
