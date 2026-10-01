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

/*==========================================
 * THE STREAMS THIS PLUGIN'S MAIL IS SENT UNDER.
 *
 * Declared in `plugins.config.json` (`subscriptionTopics`), which is where
 * their names, descriptions and preference-page order live; named here
 * wherever a send declares which stream it belongs to, because a mistyped id
 * does not fail loudly. It names a stream nobody has opted out of, so the
 * send path finds no opt-out and the send goes to everybody — the control
 * silently doing nothing.
 *
 * Each value is a wire format: a Firestore path component and a component of
 * the unsubscribe link's signed subject, so changing one orphans every
 * opt-out already recorded against it. A cart reminder rides the platform's
 * default stream (`DEFAULT_SUBSCRIPTION_TOPIC_ID`), as a campaign does.
 *=========================================*/

/** Regular news and stories, including a site's posts to its members. */
export const NEWSLETTER_TOPIC_ID = 'newsletter'

/** New products, restocks, and changes to what a site offers. */
export const PRODUCT_UPDATES_TOPIC_ID = 'product-updates'
