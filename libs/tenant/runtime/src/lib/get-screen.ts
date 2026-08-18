/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin, screenConverter } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * Backstop TTL only (AGL-1302): a screen publish flips `versionId` on this
 * doc, and the publish path already busts `tenant-data:{hostId}` through the
 * tenant `/api/revalidate` route, so publishes stay as instant as AGL-1150
 * made them. 60s matches the page's own ISR window for everything else.
 */
const SCREEN_DOC_TTL_SECONDS = 60

async function readScreenDoc(
  hostId: string,
  screenId: string,
  /** Compose-time reads that WANT the template document — see {@link getScreen}. */
  allowTemplate = false,
): Promise<Aglyn.AglynScreen | null> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('screens')
    .withConverter(screenConverter)
    .doc(screenId)
    .get()
  if (!snapshot.exists) return null
  const screen = snapshot.data() as Aglyn.AglynScreen
  // Serve-side agreement with the quota (AGL-1383). `countBillableScreens`
  // subtracts soft-deleted and `kind: 'email'` screens from `screensPerHost`,
  // and both fields are client-writable — so before this, one `updateDoc` on
  // the screen's own document took it off the plan while leaving it live: the
  // host's routing map still pointed at it and nothing on this path ever
  // looked. Refusing them here is what makes the exclusion honest — an
  // excluded screen genuinely is not a page — and it turns the bypass into a
  // trade (the field costs you the page) rather than a discount.
  //
  // Indistinguishable from a missing screen on purpose: every caller already
  // treats `null` as a 404, and this must not become a probe for which
  // screens exist. Not cached either (`store` refuses `null`), so clearing
  // the field brings the page back on the next request rather than in 60s.
  //
  // The Emails page is untouched: campaign sends read the email screen and
  // its version straight off Firestore in `loadEmailTemplate`, never through
  // the tenant runtime — email documents are not, and never were, URLs.
  //
  // `kind: 'template'` joins them (AGL-1400) and needs the escape hatch they do
  // not, because a template IS rendered by this runtime — just never at an
  // address of its own. `composeCollectionTemplatePage` and commerce's
  // site-page resolver ask for it deliberately, against a routed entry or
  // product; every other caller is resolving a REQUEST PATH, and for those a
  // template is a 404 exactly as an email document is.
  if (allowTemplate && screen?.kind === Aglyn.SCREEN_KIND_TEMPLATE) {
    return screen.deletedAt == null ? screen : null
  }
  // `kind: 'error'` (AGL-2092) is served, and served UNCONDITIONALLY — no
  // opt-in flag like `allowTemplate` above, on purpose.
  //
  // The two exclusions this function refuses are refused because refusing is
  // what makes them honest: they are client-writable, so `kind: 'email'` had to
  // cost the page or it would have been a discount (AGL-1383). Neither half of
  // that argument holds here. A client cannot write `kind` at all — the rules
  // have frozen it since AGL-1383 and only /api/hosts/screens stamps this
  // value, bounded at `ERROR_SCREEN_MAX_PER_HOST` — and, decisively, an error
  // screen that is still in the host's routing map still COUNTS, because the
  // map outranks the document for this value. So there is no page being had for
  // free to refuse, and refusing would only mean that assigning a 404 screen
  // silently broke it: the very error-render callers below fetch it through
  // this function, and a host that ALSO still publishes it at `/404` (which is
  // exactly how every error screen on the platform exists today) would find
  // that address 404ing the moment somebody used the Error pages card.
  //
  // What keeps the exclusion honest instead is the routing map: the screen
  // stops counting when, and only when, it stops having an address of its own.
  if (screen?.kind === Aglyn.SCREEN_KIND_ERROR) {
    return screen.deletedAt == null ? screen : null
  }
  return Aglyn.screenClaimsToBeAPage(screen as Aglyn.ScreenPageClaim)
    ? screen
    : null
}

export async function getScreen(options: {
  screenId: Aglyn.ScreenUid
  hostId: Aglyn.HostUid
  /**
   * Serve a `kind: 'template'` document too (AGL-1400).
   *
   * Set ONLY by the two composers that render a template against a routed
   * subject — the collection entry page and commerce's PDP/catalog pages. A
   * caller resolving a request path must leave it off: that is what makes the
   * exclusion honest (an excluded screen genuinely is not a page) and it is the
   * same trade AGL-1383 made for `kind: 'email'`.
   *
   * It also keys the render cache, so a template fetched for composition can
   * never be handed back to a path-resolving caller out of the same slot.
   */
  allowTemplate?: boolean
}) {
  const { screenId, hostId, allowTemplate = false } = options
  const data = {
    screen: undefined as Aglyn.AglynScreen,
    nextPageToken: '',
    error: null,
  }

  try {
    const screen = await withRenderCache({
      key: [
        allowTemplate ? 'tenant-screen-doc-template' : 'tenant-screen-doc',
        hostId as string,
        screenId as string,
      ],
      revalidate: SCREEN_DOC_TTL_SECONDS,
      tags: [tenantDataTag(hostId as string)],
      read: () =>
        readScreenDoc(hostId as string, screenId as string, allowTemplate),
      // Never store a missing screen, and never store a doc carrying a
      // PENDING publish schedule: `applyDuePublishSchedule` reads
      // `publishSchedule.publishAt.seconds` off a live Timestamp, and the
      // JSON round trip a cache hit implies decays that to `_seconds` —
      // which would make every pending schedule look already due. A pending
      // schedule therefore keeps its doc read fresh until it resolves.
      store: (value) =>
        value !== null &&
        (value as { publishSchedule?: { status?: string } }).publishSchedule
          ?.status !== 'pending',
    })
    if (screen) data.screen = screen
  } catch (error) {
    console.error(error)
    data.error = error
  }

  return data
}

export default getScreen
