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
 * Commerce domain model (AGL-411): pure types + logic relocated from the
 * core `@aglyn/aglyn` app-utils — the commerce plugin owns its domain.
 * Context-free and framework-free, so both the plugin's client components
 * and its `/server` handlers (and other plugins/apps via
 * `@aglyn/plugins-commerce/model`) can import it.
 */
export * from './commerce'
export * from './commerce-cart'
export * from './commerce-discounts'
export * from './commerce-io'
export * from './commerce-orders'
export * from './commerce-reservations'
export * from './commerce-shipping'
export * from './commerce-tax'
export * from './purchase-analytics'
