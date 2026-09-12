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

import { HelpTip } from '@aglyn/shared-ui-jsx'
import type { SxProps } from '@mui/material'
import type { ReactNode } from 'react'
import {
  buildDocsUrl,
  type DocsHelpAnchor,
  DOCS_HELP_TOPICS,
  type DocsHelpTopicKey,
} from '../constants/docs-links'
import DocsHelpExcerpt from './docs-help-excerpt.component'

export interface DocsHelpTipProps<
  K extends DocsHelpTopicKey = DocsHelpTopicKey,
> {
  /** Registry key of the docs page this affordance explains. */
  topic: K
  /**
   * Heading on that page to land on, rather than its top (AGL-1943).
   *
   * Type-checked against the page's real headings, exactly as `docsHelp()`'s
   * `anchor` is — so a docs restructure that renames the heading is a compile
   * error here rather than a link that quietly drops the reader at the top of
   * a long page and lets them believe they're in the right place.
   *
   * Worth having because the pages this tip points at have grown: the billing
   * lifecycle page is now four distinct subjects, and "open the docs" is a
   * materially worse answer than "open the section that explains the dialog
   * you are standing in".
   */
  anchor?: DocsHelpAnchor<K>
  /** Override the tooltip title (defaults to the topic's docs page title). */
  title?: string
  /** Override the tooltip excerpt (defaults to the topic's docs excerpt). */
  excerpt?: ReactNode
  sx?: SxProps
}

/**
 * Unobtrusive question-mark affordance that surfaces a docs excerpt on hover
 * and deep-links to the full documentation page in a new tab (AGL-599).
 *
 * The affordance is the shared `HelpTip`, the same one every `docsHelp()` tip
 * renders, so the two kinds of tip are labeled, placed and re-placed alike.
 * This component only resolves a registry topic into that tip's content.
 */
export function DocsHelpTip<K extends DocsHelpTopicKey>(
  props: DocsHelpTipProps<K>,
) {
  const { topic, anchor, sx } = props
  const topicEntry = DOCS_HELP_TOPICS[topic]
  const { path } = topicEntry
  const title = props.title ?? topicEntry.title
  // The excerpt arrives with the tooltip rather than with this button: it is
  // read only once the tooltip opens, and the registry's prose is ~20 KB the
  // console shell would otherwise carry on every page (AGL-2706). The title
  // and path stay synchronous below — they are this control's accessible name
  // and its href.
  const excerpt = props.excerpt ?? <DocsHelpExcerpt topic={topic} />
  const href = `${buildDocsUrl(path)}${anchor ?? ''}`

  return <HelpTip title={title} excerpt={excerpt} href={href} sx={sx} />
}
DocsHelpTip.displayName = 'DocsHelpTip'
DocsHelpTip.aglyn = true

export default DocsHelpTip
