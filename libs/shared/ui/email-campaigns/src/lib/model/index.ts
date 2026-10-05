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
 * The bulk-send reporting math: a send's stored counters, the rate a figure
 * is taken as (always with its denominator named), and the link rollup.
 *
 * Generic to every plugin that mails in bulk — the campaign sender, the
 * sequence runner — and owned by none of them (AGL-3080). Nothing here
 * imports React or MUI, so a server handler that needs a rate can take this
 * barrel without dragging a component graph into its bundle. The renderers
 * live one directory over, behind
 * `@aglyn/shared-ui-jsx/components/measured-figures.component`.
 */
export * from './send-report'
