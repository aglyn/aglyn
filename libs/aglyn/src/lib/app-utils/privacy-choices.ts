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
 * "Your Privacy Choices": the regulated title, and the words the native apps' panel shows.
 *
 * No imports, so the apps read every word here through their generated contracts
 * (`tools/scripts/native-contracts.json`) rather than typing a second copy.
 */

/**
 * The title of the persistent opt-out control — **fixed by regulation, not a
 * copy choice**.
 *
 * Once a business "shares" personal information for cross-context behavioral
 * advertising, CCPA §1798.135(b) requires a clear and conspicuous opt-out
 * link, and CCPA regs §7015 permit a SINGLE combined link only when it is
 * titled with these exact words. Aglyn crossed that line when advertising
 * technology went onto aglyn.com, so the pill's previous label — "Privacy
 * choices" — stopped being compliant the moment the tag shipped.
 *
 * Capitalisation is part of the specified title. Do not sentence-case it to
 * match the rest of the overlay copy, do not shorten it to fit a narrow
 * viewport, and do not translate it away on a US-facing site: it is pinned by
 * `consent-opt-out-title.spec.tsx`, which renders the real control and reads
 * the text back.
 */
export const CONSENT_OPT_OUT_TITLE = 'Your Privacy Choices'

/**
 * The native apps' Privacy Choices panel (Console chrome row 3; the owner's decision of 2026-11-19): one switch for the
 * app's analytics, kept on the device. The console's panel sentences (`CONSOLE_CONSENT_COPY` in the console's
 * `visitor-consent.component.tsx`) with "app" for "console", and without the cookie clause.
 */
export const NATIVE_PRIVACY_CHOICES_INTRO = 'Choose what this app may use.'

export const NATIVE_PRIVACY_CHOICES_STRICTLY_NECESSARY =
  'Strictly necessary features — signing in, keeping you signed in, and ' +
  'remembering this choice — are always on because the app cannot work ' +
  'without them.'

export const NATIVE_PRIVACY_CHOICES_ANALYTICS_LABEL = 'Analytics'

export const NATIVE_PRIVACY_CHOICES_ANALYTICS_DETAIL =
  'Google Analytics — which pages are used and where things go wrong.'
