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

import {
  SCREEN_ROOT_PATH,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/app-utils/screen-route'
import { sanitizePublishOutboxPaths } from './publish-outbox'

/*
 * WHAT A ROUTING-MAP WRITE CHANGES, decided without a Firestore SDK.
 *
 * The console applies the plan through the web SDK (`screen-publishing.ts`)
 * and the pages route applies it through the Admin SDK for the native apps
 * (`api/hosts/pages`), so a publish, an unpublish or a move changes the same
 * fields whichever surface made it.
 */

/** The routing state a write is planned against: the map and the placeholder home page. */
export interface ScreenRouteState {
  screens: Record<string, string>
  defaultHomeScreenId?: string
}

/** What a routing write does beyond its own entries. */
export interface ScreenRoutePlan {
  /** Host-document field paths to remove (`screens.<id>`, `defaultHomeScreenId`). */
  hostDeletes: string[]
  /** The placeholder home page, when this write takes its root: its `publishedAt` goes too. */
  placeholderUnpublished?: string
  /** The site addresses whose cache the write changes, for the announcement. */
  paths: string[]
}

/**
 * THE FIRST REAL HOME PAGE REPLACES THE PLACEHOLDER (AGL-3408), AND THE
 * PLACEHOLDER ITSELF STOPS BEING ONE THE MOMENT ITS OWNER PUBLISHES IT
 * (AGL-3478). `entries` are the routing entries the write sets (a string) or
 * removes (`null`); `published` names the screen the write puts on the site,
 * as opposed to the ones it only re-addresses.
 */
export function planScreenRouteWrite(
  state: ScreenRouteState,
  entries: Record<string, string | null | undefined>,
  published?: string,
): ScreenRoutePlan {
  const hostDeletes: string[] = []
  let released: Record<string, null> = {}
  let placeholderUnpublished: string | undefined
  const placeholder = state.defaultHomeScreenId
  if (placeholder) {
    if (published === placeholder && entries[placeholder]) {
      hostDeletes.push('defaultHomeScreenId')
    } else if (state.screens[placeholder] === SCREEN_ROOT_PATH) {
      const takesRoot = Object.entries(entries).some(
        ([screenId, path]) => screenId !== placeholder && path === SCREEN_ROOT_PATH,
      )
      if (takesRoot) {
        hostDeletes.push(`screens.${placeholder}`, 'defaultHomeScreenId')
        placeholderUnpublished = placeholder
        released = { [placeholder]: null }
      }
    }
  }
  return {
    hostDeletes,
    ...(placeholderUnpublished ? { placeholderUnpublished } : {}),
    paths: changedRoutePaths(state.screens, { ...released, ...entries }),
  }
}

/**
 * The addresses a routing write changes: each entry's old address and its
 * new one. An entry rewritten to the address it already had changes nothing
 * a visitor can see, so a whole-map sync announces only what moved.
 */
export function changedRoutePaths(
  before: Record<string, string>,
  after: Record<string, string | null | undefined>,
): string[] {
  const paths = new Set<string>()
  for (const [screenId, next] of Object.entries(after)) {
    const previous = before[screenId]
    const nextPath = next ?? undefined
    if (previous === nextPath) continue
    if (previous) paths.add(screenRoutePathToUrl(previous))
    if (nextPath) paths.add(screenRoutePathToUrl(nextPath))
  }
  return sanitizePublishOutboxPaths([...paths])
}
