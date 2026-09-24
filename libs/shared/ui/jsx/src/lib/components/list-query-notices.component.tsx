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

import { Alert, Stack } from '@mui/material'

export interface ListQueryNoticesProps {
  /**
   * What the list was asked and could not put on its query, each as the thing
   * asked ("Tags contains vip", "Search") and why.
   */
  refused: ReadonlyArray<{ label: string; reason: string }>
  /** Said about what WAS served, e.g. that search matched one word. */
  notices?: readonly string[]
}

/**
 * WHAT THE QUERY DID NOT TAKE, said above the list (AGL-3321).
 *
 * Every filter and search word a list applies is on its Firestore query, and
 * one query holds one array clause, one range and thirty disjunctions. A
 * combination past that is not applied at all rather than applied to the
 * rows that happen to be loaded — and a filter the reader set that is not
 * applied must say so, or the list reads as the answer to a question it did
 * not ask.
 */
export function ListQueryNotices(props: ListQueryNoticesProps) {
  const { refused, notices = [] } = props
  if (!refused.length && !notices.length) return null
  return (
    <Stack spacing={1} role="status" aria-label="Filter notices">
      {refused.map((entry) => (
        <Alert key={`${entry.label}:${entry.reason}`} severity="warning">
          {`${entry.label} is not applied: ${entry.reason}.`}
        </Alert>
      ))}
      {notices.map((notice) => (
        <Alert key={notice} severity="info">
          {notice}
        </Alert>
      ))}
    </Stack>
  )
}
ListQueryNotices.displayName = 'ListQueryNotices'

export default ListQueryNotices
