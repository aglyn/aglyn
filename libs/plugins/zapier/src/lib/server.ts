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

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { ZAPIER_HOOKS_ROUTE } from './constants'

/**
 * The Zapier plugin's console API (AGL-3643): the card's route, with the
 * Admin SDK and the store loaded on its first request.
 */
export function registerZapierConsoleApi(): void {
  registerPluginApiRoute(ZAPIER_HOOKS_ROUTE, async (req, res) =>
    (await import('./server/platform-deps')).zapierConsoleHooksHandler()(req, res),
  )
}
