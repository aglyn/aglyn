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

// By path: which sources exist is editor business, kept out of every barrel.
import type { RepeatRowsAnswer } from '@aglyn/aglyn/app-utils/repeat-sources'
import { createContext } from 'react'
import {
  createHeldAnswersStore,
  type HeldAnswersSource,
  type HeldAnswersStore,
} from '../utils/held-answers-store'

/**
 * The rows a canvas repeat is drawn from (AGL-3111).
 *
 * A repeating element holds its source and key here; the host app renders one
 * reader per held request, which asks the registered repeat source for the
 * rows and files the answer back under {@link repeatRowsKey}. The canvas then
 * draws the copies and the badge from that answer, through the published
 * page's own expansion.
 *
 * ABSENT when no host app reads rows: every repeat then draws its template
 * once, with no badge.
 */
export interface RepeatRowsRequest {
  /** The registered repeat source's id. */
  sourceId: string
  /** The key exactly as the node stores it, trimmed. */
  key: string
}

export type RepeatRowsSource = HeldAnswersSource<
  RepeatRowsRequest,
  RepeatRowsAnswer
>
export type RepeatRowsStore = HeldAnswersStore<
  RepeatRowsRequest,
  RepeatRowsAnswer
>

/**
 * Where a request's answer is filed.
 *
 * NUL joins the two parts because it cannot appear in a source id or in a
 * stored repeat key, so no pair can forge another pair's key. It is written
 * as the `\x00` ESCAPE and never as a raw NUL byte (AGL-1890): a literal NUL
 * in the first 8000 bytes makes the whole file BINARY to git, which leaves it
 * with no diff, no blame and nothing for `grep` to find. The escape parses to
 * the identical one-character string, so nothing about the key changes.
 */
export function repeatRowsKey(request: RepeatRowsRequest): string {
  return `${request.sourceId}\x00${request.key}`
}

/** An in-memory store. How each request is read is the host app's business. */
export function createRepeatRowsStore(): RepeatRowsStore {
  return createHeldAnswersStore<RepeatRowsRequest, RepeatRowsAnswer>(
    repeatRowsKey,
  )
}

export const RepeatRowsContext = createContext<RepeatRowsSource | undefined>(
  undefined,
)
RepeatRowsContext.displayName = 'RepeatRowsContext'

export default RepeatRowsContext
