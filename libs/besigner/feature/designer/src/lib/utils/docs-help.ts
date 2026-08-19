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

// BESIGNER_DOCS + anchor types are GENERATED from the docs site — see
// docs/DOCS_HELP_REGISTRY.md. This lib can't import the console constants, so
// it carries its own subset. Regenerate with:
//   node tools/scripts/generate-docs-help.mjs
import {
  BESIGNER_DOCS,
  type BesignerDocsAnchor,
  type BesignerDocsKey,
} from './docs-help.generated'

export {
  BESIGNER_DOCS,
  type BesignerDocsAnchor,
  type BesignerDocsKey,
} from './docs-help.generated'

// Same env override + fallback as the console's constants/docs-links.ts —
// this lib can't import app code, so the base URL is resolved here too.
const DOCS_BASE_URL = (
  // Dot notation (AGL-2037): this is a designer lib that ships in the client
  // bundle, and the bracket form is never substituted there — so every help
  // link pointed at Aglyn's docs regardless of what an operator configured.
  //
  // Canonical name first, older name as a fallback (AGL-2186) — see
  // apps/console/constants/docs-links.ts for why there were two.
  process.env.NEXT_PUBLIC_DOCS_ORIGIN ||
  process.env.NEXT_PUBLIC_AGLYN_DOCS_URL ||
  'https://docs.aglyn.com'
).replace(/\/+$/, '')

/** Absolute docs URL for a besigner docs page, with an optional heading anchor
 * constrained to that page's real headings (e.g.
 * `besignerDocsUrl('responsiveStyling', '#box-stylers')`). */
export function besignerDocsUrl<K extends BesignerDocsKey>(
  page: K,
  anchor?: BesignerDocsAnchor<K>,
): string {
  return `${DOCS_BASE_URL}${BESIGNER_DOCS[page]}${anchor ?? ''}`
}
