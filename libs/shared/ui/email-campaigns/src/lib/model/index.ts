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
 * The email-campaign document model: the stored shapes and the pure
 * arithmetic over them.
 *
 * Nothing here imports React or MUI, so a server handler that needs a field
 * name or a rate can take this barrel without dragging a component graph
 * into its bundle. The renderers live one directory over, behind
 * `@aglyn/shared-ui-email-campaigns/components/report-figures`.
 */

/**
 * Campaign reporting: the rate math, the populations the send recorded, and
 * the link rollup — pure, so every denominator is named once and provable
 * rather than chosen in JSX.
 */
export * from './campaign-report'

/**
 * What a campaign EARNED: the last-click window, the gross/refunded pair and
 * the per-currency buckets that are never added together. Separate from the
 * rate math because it reads a different document and answers the merchant's
 * second question rather than their first.
 */
export * from './campaign-revenue'

/** Reading one message record — its state, and when it went out. */
export * from './email-record'

/**
 * The campaign CONTAINER — its window, its lists, and the arithmetic that
 * rolls its sends into one set of figures.
 */
export * from './campaign-container'
