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
 * Client-only React contexts that live in @aglyn/aglyn (not a UI lib) so
 * every canvas-rendering surface — console, plugins, tenant render — shares
 * ONE context module instance (a second instance renders the site blank).
 * They call `createContext` at module scope, which App Router forbids in a
 * Server Component's module graph, so they are split out of the server-safe
 * `./server` barrel and only reachable via the full `@aglyn/aglyn` barrel
 * (client) — never `@aglyn/aglyn/server` (AGL-405).
 */
export * from './entity-picker-context'
export * from './media-picker-context'
export * from './screen-link-context'
export * from './site-context'
