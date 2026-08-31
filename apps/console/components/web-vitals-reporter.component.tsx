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
'use client'

import { installWebVitalsReporting } from '@aglyn/aglyn/app-utils/web-vitals-rum'
import { platformAnalyticsAllowed } from '@aglyn/aglyn/app-utils/platform-visitor-consent'

/**
 * Real-user Core Web Vitals for the console (AGL-1642) — the `ErrorBeacon`
 * shape: module-scope install, null render, mounted from the root layout
 * OUTSIDE every page boundary so a wedged page still measures.
 *
 * Delivery is `window.gtag` — the tag Firebase Analytics injects at runtime
 * on this surface (`G-YW5PG16YTM`). The module holds metrics reported before
 * that injection lands and flushes when it does, so TTFB survives the boot
 * window. The AGL-1582 `traffic_type: 'internal'` stamp rides these hits too:
 * `setDefaultEventParameters` issues a global `gtag('set')`, which applies to
 * direct gtag events as well as Firebase `logEvent` ones.
 *
 * ## Why this one needs its own consent gate
 *
 * Because it is the console's only analytics path that does NOT go through
 * `deliver()`. Everything else in the console reaches GA through the
 * transport the layout registers, so withholding consent there is enough —
 * the layout swaps in a transport that drops. This module calls
 * `window.gtag` itself, and on this surface that global outlives a
 * withdrawal: Firebase injected gtag.js and a page cannot unload a script.
 * Without the gate a visitor who opts out mid-session keeps reporting their
 * vitals until they navigate away.
 *
 * A visitor who was never granted needs nothing extra — no consent, no tag,
 * no `window.gtag` to find, and the module drops what it held after its wait
 * expires. The gate is for the ones who had it and took it back.
 *
 * Install is guarded per page load inside the module, so this component
 * rendering twice (strict mode, remounts) registers nothing twice.
 */
installWebVitalsReporting({
  surface: 'console',
  allowed: platformAnalyticsAllowed,
})

export default function WebVitalsReporter(): null {
  return null
}
