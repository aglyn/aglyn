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

import { screenRoutePathToUrl } from '@aglyn/aglyn'
import { Box } from '@mui/material'

/** One live page below the page being taken down. */
export interface LiveDescendantPage {
  id: string
  /** Its routing-map path. */
  path: string
  name?: string
}

/** How many pages the note names before it summarizes the rest. */
const NAMED_MAX = 8

/**
 * The pages below a parent that STAY LIVE when the parent is unpublished or
 * deleted (AGL-3463).
 *
 * Neither act removes more than the parent's own routing entry, so every page
 * nested under it keeps serving at its own address. A confirmation that said
 * nothing about them would leave the author believing the whole section went
 * down; this names them, with their addresses, so the author can take them
 * down one by one if that is what they meant.
 *
 * Renders nothing when there are none. Rendered inside the confirm dialog's
 * `DialogContentText`, which is a `<p>`, so every element here is a `<span>`
 * (block-displayed where it needs a line of its own) — a `<ul>` or `<div>`
 * would be invalid nesting.
 */
export function LiveDescendantsNote(props: { pages: LiveDescendantPage[] }) {
  const { pages } = props
  if (!pages.length) return null
  const named = pages.slice(0, NAMED_MAX)
  const rest = pages.length - named.length
  return (
    <Box component="span" sx={{ display: 'block', mt: 1.5 }}>
      <span>
        {pages.length === 1
          ? 'This page under it stays live at its own address:'
          : 'These pages under it stay live at their own addresses:'}
      </span>
      <Box
        component="span"
        role="list"
        sx={{ display: 'block', mt: 0.5, pl: 2 }}
      >
        {named.map((page) => (
          <Box
            key={page.id}
            component="span"
            role="listitem"
            sx={{ display: 'block' }}
          >
            {page.name ? `${page.name} — ` : ''}
            {screenRoutePathToUrl(page.path)}
          </Box>
        ))}
        {rest > 0 ? (
          <Box component="span" role="listitem" sx={{ display: 'block' }}>
            {`and ${rest} more`}
          </Box>
        ) : null}
      </Box>
      <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
        {pages.length === 1
          ? 'Unpublish it separately to take it off the site.'
          : 'Unpublish them separately to take them off the site.'}
      </Box>
    </Box>
  )
}
LiveDescendantsNote.displayName = 'LiveDescendantsNote'

/**
 * The same fact for a surface that unpublishes without a confirmation (the
 * besigner and the page details view): a clause to append to its toast, or
 * `''` when nothing below the page is live.
 */
export function liveDescendantsToastClause(count: number): string {
  if (count <= 0) return ''
  return count === 1
    ? ' — the page under it stays live at its own address'
    : ` — the ${count} pages under it stay live at their own addresses`
}

export default LiveDescendantsNote
