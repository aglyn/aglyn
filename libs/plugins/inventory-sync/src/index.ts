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

// The client barrel: constants, the client-safe model and the console
// registrar. Nothing here reaches a server module or React beyond `lazy`;
// the routes are `@aglyn/plugins-inventory-sync/server`.
export * from './lib/constants'
export * from './lib/model/inventory-sync'
export * from './lib/plugin'
