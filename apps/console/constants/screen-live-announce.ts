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

import type { HostUid, ScreenUid } from '@aglyn/aglyn'
import revalidateLivePages, {
  describeRevalidateShortfall,
} from '../utils/revalidate-live-pages'
import type { PublishAnnouncer } from './screen-publishing'

/** A saved change to a screen whose address stayed where it was. */
export interface LiveScreenChange extends PublishAnnouncer {
  hostId: HostUid
  screenId: ScreenUid
  /**
   * The screen's entry in the host's `screens` routing map, or nothing when
   * it has none.
   *
   * The routing map is what the tenant serves from, so it is also the whole
   * answer to "is there a live page to drop". A screen with no entry has no
   * cached page anywhere, and a write to it announces nothing (AGL-2573).
   *
   * The caller narrows it further when the field it wrote is live only on
   * one version: a layout binding on a version the screen is not serving
   * changes nothing a visitor can see, so that caller passes nothing.
   */
  livePath: string | null | undefined
  /**
   * Where the shortfall sentence goes — the page's `enqueueSnackbar`.
   *
   * The options are fixed here rather than chosen at each call site, for the
   * reason `describeRevalidateShortfall` fixes the wording: surfaces that
   * report the same fact differently are the drift that helper exists to
   * prevent.
   */
  notify: (
    message: string,
    options: { variant: 'warning'; persist: false },
  ) => unknown
}

/**
 * ANNOUNCE A SAVED CHANGE TO A LIVE SCREEN THAT MOVES NO ADDRESS (AGL-2934).
 *
 * `screen-publishing.ts` announces every write to the routing map, because
 * those are the writes that change which addresses exist. A screen's own
 * settings change what an address SERVES without touching the map — its
 * search title and description, its social card, its password, its
 * visibility, its name, the layout the live version is framed in — so
 * nothing there ever sees them. The tenant renders all of them from the
 * screen and version documents, and holds both behind caches that only an
 * announcement drops: the catch-all page's ISR window, and the
 * `tenant-data:{hostId}` render cache underneath it. Unannounced, the save
 * lands, the toast says so, and the live page keeps its old `<title>` — or
 * stays public after it was protected — until those windows lapse.
 *
 * Named by `screenId` rather than by path. The address did not change, so the
 * console route's resolution through the routing map is correct here, and it
 * reads the map on the server rather than trusting this tab's copy of it.
 *
 * BEST EFFORT, ALWAYS, and never awaited. The write has already landed when
 * this runs, and a cache hint that fails must never make a successful save
 * look failed. The rejection is caught here for the reason
 * `announceRouteChange` gives: an unawaited promise that rejects is a console
 * error on a successful save in a browser, and fatal under Node.
 *
 * A drop that fell short is still reported, with "Saved." as its lead. These
 * are saves: telling someone who fixed a meta description that they
 * published something is its own error.
 */
export function announceLiveScreenChange(change: LiveScreenChange): void {
  const { user, hostId, screenId, livePath, notify } = change
  if (!livePath) return
  void revalidateLivePages({ user, hostId, screenId })
    .then((result) => {
      const shortfall = describeRevalidateShortfall(result, 'Saved.')
      if (shortfall) notify(shortfall, { variant: 'warning', persist: false })
    })
    .catch((error: unknown) => {
      console.error('[screen-live-announce] announce failed', error)
    })
}
