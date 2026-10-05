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

// The import/export core (AGL-3522): pure and domain-neutral, with no Node
// builtin and no React, so the browser wizard and the server job engine run
// the same code. Reached only as `@aglyn/aglyn/data-transfer`: neither
// `@aglyn/aglyn` nor `@aglyn/aglyn/server` re-exports it, so the shells that
// open those barrels never load it.
export * from './resource'
export * from './similarity'
export * from './field-catalog'
export * from './derive'
export * from './header-match'
export * from './picklist-map'
export * from './match'
export * from './policy'
export * from './plan'
export * from './job'
export * from './package'
export * from './source'
export * from './transfer-api'
