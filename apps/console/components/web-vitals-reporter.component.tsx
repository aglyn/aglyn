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

/**
 * Real-user Core Web Vitals for the console (AGL-1642) — the `ErrorBeacon`
 * shape: module-scope install, null render, mounted from the root layout
 * OUTSIDE every page boundary so a wedged page still measures.
 *
 * Delivery is `window.gtag` — the tag Firebase Analytics injects at runtime
 * on this surface (`G-YW5PG16YTM`). The module holds metrics reported before
 * that injection lands and flushes when it does, so TTFB survives the boot
 * window. The console's GA runs unconditionally (AGL-118 posture, disclosed
 * in legal v3), and the AGL-1582 `traffic_type: 'internal'` stamp rides
 * these hits too: `setDefaultEventParameters` issues a global `gtag('set')`,
 * which applies to direct gtag events as well as Firebase `logEvent` ones.
 *
 * Install is guarded per page load inside the module, so this component
 * rendering twice (strict mode, remounts) registers nothing twice.
 */
installWebVitalsReporting({ surface: 'console' })

export default function WebVitalsReporter(): null {
  return null
}
