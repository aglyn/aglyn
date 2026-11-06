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

import { useEffect } from 'react'
import { prunePreviewStates } from '../constants/preview-state'

/** Long enough after boot that the prune never competes with first paint. */
export const PREVIEW_PRUNE_DELAY_MS = 10_000

/**
 * Drops stale besigner preview snapshots once per console load (AGL-4204).
 *
 * `writePreviewState` prunes on every Preview click, but a browser that
 * stopped previewing would keep what it already holds, and a full origin
 * fails the Firestore client. Renders nothing.
 */
export default function PreviewStatePrune() {
  useEffect(() => {
    const timer = setTimeout(() => prunePreviewStates(), PREVIEW_PRUNE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return null
}
