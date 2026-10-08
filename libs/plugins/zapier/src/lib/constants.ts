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

/**
 * The Zapier plugin (AGL-3643): the REST hooks Aglyn's Zapier app subscribes
 * to, and their delivery.
 *
 * A merchant connects THEIR OWN Zapier account to Aglyn with one of their own
 * API keys. Each Zap that starts on an Aglyn trigger subscribes a hook here
 * (`POST /v1/sites/{siteId}/hooks`), with the URL Zapier minted for that Zap;
 * the plugin posts each event the hook takes to that URL until the Zap is
 * turned off (`DELETE …/hooks/{id}`), the key is revoked, or Zapier answers
 * `410 Gone`. Actions run the other way, through the REST API the key
 * already reaches.
 *
 * HIDDEN UNTIL PUBLISHED. The app itself (`apps/zapier`) is published from
 * Zapier's developer platform by the operator. Until the deployment sets
 * `ZAPIER_APP_URL` — the app's public or invite link — the console draws no
 * Zapier card and the user docs say nothing; the REST hook endpoints answer
 * whoever calls them, undocumented, so the app can be tested privately first.
 */

export const ZAPIER_PLUGIN_ID = 'zapier'

/** The console card in the site setup page's `hostSettings` zone. */
export const ZAPIER_WIDGET_ID = 'zapier-connections'

/** The console's route for the card: list and disconnect a site's Zaps. */
export const ZAPIER_HOOKS_ROUTE = 'zapier/hooks'

/** The `/v1/sites/{siteId}/<resource>` the Zapier app subscribes through. */
export const ZAPIER_HOOKS_RESOURCE = 'hooks'

/**
 * The deployment's gate: the published Zapier app's link. Unset, the console
 * card draws nothing. Server-side, read by the card's route.
 */
export const ZAPIER_APP_URL_ENV = 'ZAPIER_APP_URL'

/**
 * The only origin a hook may post to. Zapier mints every REST hook URL on
 * this host, so a key cannot be used to make the platform post a site's
 * orders to any other server — the egress the subprocessor inventory
 * declares is exactly this.
 */
export const ZAPIER_HOOK_ORIGIN = 'https://hooks.zapier.com'

/** The hostnames of {@link ZAPIER_HOOK_ORIGIN}, which a hook's URL must be on. */
export const ZAPIER_HOOK_HOSTS: readonly string[] = [new URL(ZAPIER_HOOK_ORIGIN).hostname]

/** Hooks one site may hold: a Zap holds one per Aglyn trigger it starts on. */
export const ZAPIER_MAX_HOOKS_PER_SITE = 100

/** Zapier has this long to answer a delivery before the attempt counts as failed. */
export const ZAPIER_DELIVERY_TIMEOUT_MS = 10_000

/**
 * How long a "delivered" marker is kept: longer than the outbox's whole
 * retry ladder (under a day, over eight attempts), so a retry
 * never re-posts to a hook that already took the event.
 */
export const ZAPIER_DELIVERY_MARKER_RETENTION_MS = 3 * 86_400_000

/**
 * The plugin's own domain event: a host event (a contact created, a form
 * submitted) moved onto the outbox, so its delivery is retried like an
 * order's rather than attempted once inside the visitor's request.
 */
export const ZAPIER_RELAY_EVENT = 'zapier.relay'
