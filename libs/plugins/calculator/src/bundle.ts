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

import { registerCalculatorPlugin } from './lib/site'

/**
 * The marketplace bundle's entry (AGL-3394). The host runs it once the bundle
 * has verified, in the browser and, since AGL-3390, on the server rendering a
 * page that places one of these elements. Everything it reads from
 * `@aglyn/aglyn`, `react` and `@mui/material` is the host's own copy.
 */
export function register(): void {
  registerCalculatorPlugin()
}
