/**
 * @license
 * Copyright 2022 Aglyn LLC
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
 * Server-safe entry point for @aglyn/aglyn (AGL-405). Identical to the main
 * barrel except it re-exports `app-utils/server` (no client React contexts)
 * instead of the full `app-utils`, so tenant Server Components can import the
 * framework's types + pure functions without dragging `createContext` into
 * the RSC module graph. Client code keeps using `@aglyn/aglyn`.
 */
export * from './lib/aglyn'
export * from './lib/app-utils/server'
export * from './lib/foundation'
// The Web↔(req,res) API adapter (AGL-407) imports `node:stream`, so it is
// exposed ONLY through this `/server` entry — never re-exported by the full
// `@aglyn/aglyn` barrel (which client code bundles).
export * from './lib/app-utils/api-adapter'
export * from './lib/plugin-manager/realm-server'
