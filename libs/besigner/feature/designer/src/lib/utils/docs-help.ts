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
  process.env['NEXT_PUBLIC_AGLYN_DOCS_URL'] || 'https://docs.aglyn.com'
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
