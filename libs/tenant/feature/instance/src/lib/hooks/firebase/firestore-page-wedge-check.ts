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

import type { Firestore } from 'firebase/firestore'

import {
  bootWedgeCheckPartsFor,
  runBootWedgeCheck,
  type BootWedgeOutcome,
} from './firestore-multitab-wedge'
import { firestoreLastServerAnswerAt } from './firestore-stall-recovery'

/**
 * A PAGE OPENED IN A TAB THAT IS ALREADY RUNNING FINDS ANOTHER TAB'S LOCK IN
 * SECONDS TOO (AGL-4204).
 *
 * The boot check (`runBootWedgeCheck`, AGL-4201) rescues a tab that is still
 * loading its first page: when another tab's transaction holds the shared
 * cache, it reloads onto the memory cache in about 5 s. A tab that is already
 * running and moves to another page never had that. Its new page's readers
 * wait on the same lock, and only the stall watch rescues them: 8 s stall, 1 s
 * prompt read, 3 s settle, a 20 s lock read and the reload. About half a
 * minute on a spinner. Measured in production on 2026-11-11 (v1.20.2): a
 * background console tab on a heavily loaded machine held the store for 40 s,
 * then for about 2.5 min, and a page opened in a running tab sat on its
 * spinner while a fresh tab drew the same page in 4.8 s.
 *
 * The stall watch's long budget is there to protect what was typed into a page
 * (AGL-4135): a reload loses it. A page nobody has touched since it opened has
 * nothing typed into it, which is the boot check's own premise. So when the
 * path changes, the page gets the boot check, with two more ways to stand
 * down:
 *
 * - **The server answers this client after the page opened.** The store is not
 *   locked for it: nothing reaches a tab's views while another tab's
 *   transaction holds every store.
 * - **The page is used** (a pointer press, a key, typing, a paste or a drop on
 *   it), **or replaced** by the next page, whose own check takes over. From
 *   then on the page has the stall watch's budget, as every page had before.
 *
 * Only the path counts as a page. A query string change (a tab, a filter) is
 * the same page, possibly with something typed into it.
 *
 * A press or key on the old page that leads to the new one (a link, a menu
 * item) is the old page's: interactions are stamped with the path they
 * happened on, and only those on the new path after it was first seen count.
 *
 * The path is read on a short timer ({@link PAGE_POLL_MS}) rather than from
 * the router, so this lib does not depend on one: reading `location.pathname`
 * costs nothing, and the check's own two-second delay dwarfs the lag.
 */

/** How often the path is read for a page change. */
export const PAGE_POLL_MS = 500

/** The events that mean someone is using the page. */
export const PAGE_INTERACTION_EVENTS = [
  'pointerdown',
  'keydown',
  'input',
  'paste',
  'drop',
] as const

/** The two ways a page's check asks about the page it was started for. */
export interface PageCheckScope {
  /** Whether the server has answered this client since the page opened. */
  isAnswered: () => boolean
  /** Whether the page has been used since it opened, or replaced. */
  isInUse: () => boolean
}

export interface PageWedgeWatchDeps {
  /** The current page's path. */
  readPath: () => string
  /** When the server last answered this client, if ever. */
  lastServerAnswerAt: () => number | undefined
  /** Runs the boot check for one page. */
  runCheck: (page: PageCheckScope) => Promise<BootWedgeOutcome>
  now?: () => number
}

export interface PageWedgeWatch {
  /** Records that the page on the current path was used, now. */
  noteInteraction: () => void
  /**
   * Reads the path. On a change, starts the new page's check and returns its
   * outcome; otherwise returns `undefined`.
   */
  poll: () => Promise<BootWedgeOutcome> | undefined
}

/** The page watch, with its browser parts injected. Pure over `deps`. */
export function createPageWedgeWatch(deps: PageWedgeWatchDeps): PageWedgeWatch {
  const { readPath, lastServerAnswerAt, runCheck, now = Date.now } = deps
  let path = readPath()
  /** When `path` was last read unchanged: the new page opened after it. */
  let lastSeenAt = now()
  let page = 0
  let interaction: { path: string; at: number } | undefined

  return {
    noteInteraction: () => {
      interaction = { path: readPath(), at: now() }
    },
    poll: () => {
      const at = now()
      const next = readPath()
      if (next === path) {
        lastSeenAt = at
        return undefined
      }
      const openedAfter = lastSeenAt
      path = next
      lastSeenAt = at
      const mine = ++page
      return runCheck({
        isAnswered: () => {
          const answeredAt = lastServerAnswerAt()
          return answeredAt !== undefined && answeredAt > openedAfter
        },
        isInUse: () =>
          page !== mine ||
          (interaction !== undefined &&
            interaction.path === next &&
            interaction.at > openedAfter),
      })
    },
  }
}

/**
 * Starts the page check for `firestore`, which `markMultiTabFirestore` has
 * registered. Returns `stop`. Does nothing outside a browser or for a client
 * that does not run the durable multi-tab cache. Never throws.
 */
export function startPageWedgeChecks(firestore: Firestore): () => void {
  const parts = bootWedgeCheckPartsFor(firestore)
  if (parts === undefined || typeof window === 'undefined') return () => undefined
  try {
    const watch = createPageWedgeWatch({
      readPath: () => window.location.pathname,
      lastServerAnswerAt: () => firestoreLastServerAnswerAt(firestore),
      runCheck: (page) =>
        runBootWedgeCheck({
          ...parts,
          hasServerAnswered: page.isAnswered,
          isInUse: page.isInUse,
        }),
    })
    const onInteraction = () => watch.noteInteraction()
    for (const type of PAGE_INTERACTION_EVENTS) {
      window.addEventListener(type, onInteraction, { capture: true, passive: true })
    }
    const timer = setInterval(() => void watch.poll(), PAGE_POLL_MS)
    return () => {
      clearInterval(timer)
      for (const type of PAGE_INTERACTION_EVENTS) {
        window.removeEventListener(type, onInteraction, { capture: true })
      }
    }
  } catch {
    return () => undefined
  }
}
