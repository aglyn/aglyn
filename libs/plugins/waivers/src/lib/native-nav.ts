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

import { nativeNavRef, type NativeNavElsewhere } from '@aglyn/aglyn/app-utils/native-nav'

/**
 * Waivers in the native apps' navigation (AGL-4042). The console's Waivers
 * tab has no native screen yet: a rider's status shows at check-in through
 * the waivers routes, and the Waivers page itself opens in the console.
 *
 * Imports only the core's plain nav module, so the native contracts read it.
 */
export const NATIVE_NAV_ELSEWHERE: readonly NativeNavElsewhere[] = [
  { console: nativeNavRef('hostPluginTab', '/waivers'), where: 'The console’s Waivers page; no native screen yet' },
]
