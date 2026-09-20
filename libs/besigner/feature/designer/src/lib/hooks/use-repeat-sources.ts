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

// By path: what an element can repeat OVER is editor business, and nothing
// on a published page asks, so this stays out of every `@aglyn/aglyn` barrel.
import {
  getRepeatSourcesVersion,
  listRepeatSources,
  type RepeatSource,
  subscribeRepeatSources,
} from '@aglyn/aglyn/app-utils/repeat-sources'
import { useSyncExternalStore } from 'react'

const NONE: readonly RepeatSource[] = []

/**
 * The repeat sources registered right now (AGL-3111).
 *
 * A plugin registers one from the function its loader calls by name, so the
 * set is empty until that plugin has loaded and grows when it does. Subscribed
 * rather than read once for exactly that reason: an author who enables the
 * plugin mid-session gets the field without reloading the besigner.
 *
 * On the server there are none — registration happens in the browser, and a
 * server snapshot that claimed otherwise would hydrate into a different form
 * than it rendered.
 */
export function useRepeatSources(): readonly RepeatSource[] {
  return useSyncExternalStore(
    subscribeRepeatSources,
    listRepeatSources,
    () => NONE,
  )
}

/** Moves whenever the registered set changes; memo keys read it. */
export function useRepeatSourcesVersion(): number {
  return useSyncExternalStore(
    subscribeRepeatSources,
    getRepeatSourcesVersion,
    () => 0,
  )
}

export default useRepeatSources
