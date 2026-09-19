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

import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { AI_PLUGIN_ID } from '../constants'

/**
 * AI switched off for ONE site (AGL-3028).
 *
 * A site switches AI off through its `disabledPlugins` deny-list, the same
 * field every per-site plugin switch writes. The plugin API dispatcher already
 * answers 404 for a door whose request names that site as a top-level
 * `hostId`, before the handler runs. What this module covers is everything
 * the dispatcher cannot see:
 *
 * - a door whose site rides somewhere else in the body — the assistant's
 *   `context.hostId`, the agency batch's `sites[].hostId`;
 * - a job already QUEUED for the site, which the jobs beat runs with no
 *   request at all.
 *
 * The workspace half of AI never passes through here. The add-on, credits,
 * allotments, overage charging and close-out, the billing webhooks and the
 * staff doors carry no site, so no site's switch can stop them.
 *
 * Read with the Firestore handle the caller already runs on, never through
 * the admin barrel: the jobs machine and its specs hold no default app.
 */

/** What a person reads when a site's AI switch refused them. */
export const AI_OFF_FOR_SITE_COPY = 'AI is switched off for this site.'

/** The refusal's status: the dispatcher's answer for a site-disabled plugin. */
export const AI_OFF_FOR_SITE_STATUS = 404

/**
 * Whether AI runs on the site this host document describes, under this org.
 *
 * Fails OPEN on an absent host document, as the dispatcher does: a site that
 * cannot be read is not a site that switched AI off, and the doors below this
 * refuse an unknown site for reasons of their own.
 */
export function isAiOnForSite(org: unknown, host: unknown): boolean {
  return isHostPluginEnabled(
    (org ?? null) as { enabledPlugins?: string[] } | null,
    (host ?? null) as { disabledPlugins?: string[]; enabledPlugins?: string[] } | null,
    AI_PLUGIN_ID,
  )
}

/**
 * The shape of a site id this module will read. A request body names a site
 * in free text, and a value carrying `/` is a different document PATH, which
 * the SDK refuses by throwing — so anything that cannot be a site id is
 * answered as no site rather than read.
 */
const SITE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Whether the named site has AI switched off. `false` for no site: a request
 * that names none is workspace-level, and no site's switch applies to it.
 */
export async function isAiOffForSite(
  firestore: FirebaseFirestore.Firestore,
  org: unknown,
  hostId: string | null | undefined,
): Promise<boolean> {
  if (!hostId || !SITE_ID.test(hostId)) return false
  const snapshot = await firestore.collection('hosts').doc(hostId).get()
  if (!snapshot.exists) return false
  return !isAiOnForSite(org, snapshot.data())
}

/** The door's answer when the site it names has AI switched off. */
export function aiOffForSiteResponse(): Response {
  return Response.json(
    { error: AI_OFF_FOR_SITE_COPY, reason: 'site-off' },
    { status: AI_OFF_FOR_SITE_STATUS },
  )
}
