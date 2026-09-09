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
'use client'

import { DOCS_HELP_EXCERPTS } from '../constants/docs-help-excerpts.generated'
import type { DocsHelpTopicKey } from '../constants/docs-help.generated'

export interface DocsHelpExcerptProps {
  /** Registry key of the docs page whose description to render. */
  topic: DocsHelpTopicKey
}

/**
 * One topic's tooltip prose.
 *
 * The static import of the excerpt registry is deliberate and belongs to this
 * module alone: `docs-help-excerpt.component.tsx` reaches it through
 * `next/dynamic`, so the prose is the payload of that chunk rather than of the
 * console shell.
 */
export function DocsHelpExcerptText({ topic }: DocsHelpExcerptProps) {
  return DOCS_HELP_EXCERPTS[topic]
}
DocsHelpExcerptText.displayName = 'DocsHelpExcerptText'

export default DocsHelpExcerptText
