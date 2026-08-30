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
 * Email rendering model (AGL-412): besigner-built email HTML rendering + merge tags, relocated from core app-utils.
 * Context-free — importable by client components, /server handlers, and
 * other plugins/apps via `@aglyn/plugins-email/model`.
 */
// The renderer and merge-tag helpers moved to `@aglyn/shared-util-email`
// (AGL-750): they are pure functions over a node map with no imports at all,
// and the console's own API routes need them to render system email
// templates. Apps are forbidden to import feature plugins (the `scope:app`
// → `aglyn:addons` boundary), so leaving them here made them unreachable
// from exactly the code that has to send the mail.
//
// Re-exported so `@aglyn/plugins-email/model` keeps working unchanged.
export {
  renderEmailHtml,
  substituteMergeTokens,
  resolveMergeTags,
  type EmailRenderOptions,
  type EmailRenderProduct,
  type RenderedEmail,
} from '@aglyn/shared-util-email'

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

/**
 * The same math taken across every message sent from one TEMPLATE. Separate
 * from `campaign-report` because a sum has a membership: which messages went
 * into it, and therefore which population the rate describes.
 */
export * from './template-report'

/** Reading one message record — its state, and when it went out. */
export * from './email-record'

/**
 * Whose template this is: authored here, or installed from a marketplace
 * listing and versioned by somebody else.
 */
export * from './template-provenance'

/**
 * One campaign message, rendered. Shared by the send loop, the composer's
 * pre-send preview and any other surface that has to show what will be
 * mailed — a preview that renders the message a second way previews
 * something else.
 */
export * from './campaign-email-render'

/**
 * The campaign CONTAINER — its window, its lists, and the arithmetic that
 * rolls its sends into one set of figures.
 */
export * from './campaign-container'

/**
 * How each sending-domain state reads, said once for the list and the
 * domain's own page — including why `inconclusive` is neither of them.
 */
export * from './sending-domain-status'
