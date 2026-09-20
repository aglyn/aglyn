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
 * Which content collection ENTRIES a page's links name (AGL-3118).
 *
 * An entry link is stored as `entry:<collectionId>/<entryId>` — ids, so a
 * renamed post or a renamed collection cannot break it — and resolving one
 * needs the entry's current slug, which lives on the entry's own document.
 * The routing map carries every screen and listing of a site, but a site's
 * entries can number in the thousands, so a page carries only the entries it
 * names: this walk finds them, and the tenant reads exactly those documents.
 *
 * A reference can sit in two kinds of place:
 *
 * - a node's PROPS, anywhere in the bag: the `screenId`/`href` pair of a
 *   linking element, a `Link`-typed component prop in either slot, and the
 *   item arrays a nav strip, a tab set or a menu keeps its targets in — deep
 *   for the reason `nodesReferenceScreen` is deep;
 * - MARKDOWN — a Markdown element's content, an entry body — where a link
 *   names its target as `[text](entry:…)`.
 *
 * Collecting one too many costs one more document in a bounded read, and a
 * string that is not a rendered link is never made into one, so a string is
 * scanned for markdown links wherever it sits, code sample or not. Missing
 * one is the failure that matters: a live link rendered as plain text.
 */

import {
  ENTRY_LINK_VALUE_PREFIX,
  formatEntryLinkValue,
  parseEntryLinkValue,
} from './screen-link-value'

/** What a page composes, as {@link collectEntryLinkRefs} reads it. */
export interface EntryLinkRefSources {
  /**
   * Flat node maps — the composed page (screen, layout chain, grafted
   * components, a collection template) and any tree composed beside it.
   * Each node's `props` bag is walked.
   */
  nodes?: ReadonlyArray<Record<string, unknown> | null | undefined>
  /**
   * Markdown-lite rendered with no node to carry it: the entry body of the
   * legacy article surface, and of the Markdown twin of an entry.
   */
  markdown?: ReadonlyArray<string | null | undefined>
}

/**
 * A markdown-lite link whose target is an entry reference. The target half
 * is the parser's own (`[^)\s]+`), so this finds what the parser keeps.
 */
const MARKDOWN_ENTRY_LINK = /\]\((entry:[^)\s]+)\)/g

/**
 * How deep a prop bag is followed. Stored props are JSON and cannot cycle,
 * but a composed tree is data from any writer, and a stack overflow inside a
 * render is a 500 on a page that would otherwise serve.
 */
const MAX_PROP_DEPTH = 64

/**
 * Every entry a page's links name, as canonical `entry:<collectionId>/<entryId>`
 * keys — deduplicated and sorted, so the same page always asks the same
 * question and a cache keyed by the answer is hit.
 */
export function collectEntryLinkRefs(sources: EntryLinkRefSources): string[] {
  const refs = new Set<string>()
  const add = (value: string): void => {
    const entry = parseEntryLinkValue(value)
    if (entry) refs.add(formatEntryLinkValue(entry.collectionId, entry.entryId))
  }
  const scan = (value: string): void => {
    // Nearly every string on a page names no entry; one substring test
    // keeps the walk from trimming and splitting all of them.
    if (!value.includes(ENTRY_LINK_VALUE_PREFIX)) return
    add(value)
    if (!value.includes(`](${ENTRY_LINK_VALUE_PREFIX}`)) return
    for (const match of value.matchAll(MARKDOWN_ENTRY_LINK)) add(match[1] ?? '')
  }
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === 'string') return scan(value)
    if (!value || typeof value !== 'object' || depth >= MAX_PROP_DEPTH) return
    const children = Array.isArray(value)
      ? value
      : Object.values(value as Record<string, unknown>)
    for (const child of children) walk(child, depth + 1)
  }
  for (const nodes of sources.nodes ?? []) {
    if (!nodes || typeof nodes !== 'object') continue
    for (const node of Object.values(nodes)) {
      walk((node as { props?: unknown } | null | undefined)?.props, 0)
    }
  }
  for (const markdown of sources.markdown ?? []) {
    if (typeof markdown === 'string') scan(markdown)
  }
  return [...refs].sort()
}
