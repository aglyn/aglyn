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

/** The plugin's id, as `plugins.config.json` names it. */
export const TAX_ENGINES_PLUGIN_ID = 'tax-engines'

/**
 * The plan entitlement every surface is gated on: the plans that sell. A tax
 * engine prices a sale, so a plan without commerce has nothing for it to do.
 */
export const TAX_ENGINES_ENTITLEMENT = 'commerce'

/**
 * The plugin whose sales a tax engine prices. Named as an id only: this plugin
 * never imports it, and a site with it off has nothing to tax.
 */
export const SELLER_PLUGIN_ID = 'commerce'
