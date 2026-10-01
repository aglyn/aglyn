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

import { loadAnalyticsProviders } from '@aglyn/aglyn/app-utils/analytics-provider'
import { installWebVitalsReporting } from '@aglyn/aglyn/app-utils/web-vitals-rum'
import { platformAnalyticsAllowed } from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { ANALYTICS_PROVIDER_LOADERS } from '../constants/plugins.analytics.generated'

/**
 * Real-user Core Web Vitals for the console (AGL-1642) — the `ErrorBeacon`
 * shape: module-scope install, null render, mounted from the root layout
 * OUTSIDE every page boundary so a wedged page still measures.
 *
 * Delivery is to the analytics tag the console's analytics SDK injects at
 * runtime, through its vendor's adapter (`analytics-provider.ts`). The module
 * holds metrics reported before that injection lands and flushes when it
 * does, so TTFB survives the boot window. The AGL-1582
 * `traffic_type: 'internal'` stamp rides these hits too: the SDK's
 * `setDefaultEventParameters` sets it on the tag itself, which applies to
 * every event the tag sends.
 *
 * ## Why the adapters are loaded here
 *
 * The console's tag is not one this app mounts, so nothing else would fetch
 * the adapter that speaks to it — and two things need it on every console
 * page: this module's delivery, and a consent withdrawal, which has to tell
 * the resident tag because a page cannot unload a script. The root layout
 * renders this component on every page, so its module is where the fetch
 * starts. A withdrawal made before the adapter lands is handed to it the
 * moment it registers.
 *
 * ## Why this one needs its own consent gate
 *
 * Because it is the console's only analytics path that does NOT go through
 * `deliver()`. Everything else in the console reaches the tag through the
 * transport the layout registers, so withholding consent there is enough —
 * the layout swaps in a transport that drops. This module hands events to
 * the tag itself, and on this surface the tag outlives a withdrawal: the SDK
 * injected it and a page cannot unload a script. Without the gate a visitor
 * who opts out mid-session keeps reporting their vitals until they navigate
 * away.
 *
 * A visitor who was never granted needs nothing extra — no consent, no tag,
 * nothing resident to deliver to, and the module drops what it held after
 * its wait expires. The gate is for the ones who had it and took it back.
 *
 * Install is guarded per page load inside the module, so this component
 * rendering twice (strict mode, remounts) registers nothing twice.
 */
if (typeof window !== 'undefined') {
  void loadAnalyticsProviders(ANALYTICS_PROVIDER_LOADERS)
}
installWebVitalsReporting({
  surface: 'console',
  allowed: platformAnalyticsAllowed,
})

export default function WebVitalsReporter(): null {
  return null
}
