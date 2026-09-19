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
 * Outreach's SERVER half (AGL-2974), `@aglyn/plugins-outreach/server`.
 *
 * Every write to an `outreach*` collection is made here: the Firestore rules
 * refuse all of them to clients, so a mailbox, a sequence, an enrollment and a
 * credential only ever change through a handler registered below, behind the
 * session, entitlement and permission checks that handler makes.
 *
 * `outreach/ping` exists so the wiring is proven rather than assumed, as the
 * CRM's does: `plugins.config.json` names `registerOutreachConsoleApi` and the
 * `outreach` prefix, the generated server manifest loads this module, and the
 * console's `/api/[...pluginApi]` dispatcher reaches the handler — after its
 * own gates, which already refuse a request while `release_outreach` is off
 * for the caller. A first real route that also had to be the first wiring
 * test would be two things to debug at once.
 *
 * A route that reads or writes org data resolves the caller the way the CRM's
 * org routes do (`resolveOrgMembership` / `memberHasOrgPermission` from
 * `@aglyn/tenant-data-admin`) and asks `checkEntitlement(org, 'outreach')`
 * and `outreach.use` before it touches a document.
 */

import {
  registerPluginApiRoute,
  registerPluginPermissions,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { OUTREACH_API_ROUTES } from './constants/api-routes'
import {
  OUTREACH_PERMISSIONS,
  OUTREACH_PLUGIN_ID,
} from './constants/bundle-common'
import { registerOutreachMailboxRoutes } from './mailboxes/register-mailbox-routes'

/**
 * No auth, no org, no data: it answers whether this server bundle was loaded
 * and its routes registered, which is a fact about the process rather than
 * about any workspace.
 */
export const outreachPingHandler: PluginApiHandler = (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  res.status(200).json({ ok: true, plugin: OUTREACH_PLUGIN_ID })
}

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerOutreachConsoleApi(): void {
  // The server resolves plugin permission keys from this registry, so a
  // route's `outreach.use` check and the console's gate read the same tier
  // defaults.
  registerPluginPermissions(OUTREACH_PERMISSIONS)
  registerPluginApiRoute(OUTREACH_API_ROUTES.ping, outreachPingHandler)
  // Connect a Google mailbox, its settings, pause, test and disconnect
  // (AGL-2978).
  registerOutreachMailboxRoutes()
}

// The transport the sending runtime reaches a connected mailbox through
// (AGL-2978): open a mailbox's Gmail client, mark one reconnect-required,
// send the engine's composed email through the one RFC 5322 writer, and read
// a thread whole for the engine's reply and bounce classifier.
export {
  markOutreachMailboxReconnectRequired,
  openOutreachMailboxClient,
  type OpenedOutreachMailbox,
} from './mailboxes/mailbox-transport'
export {
  GmailTransportError,
  isReconnectRequired,
  type GmailTransportErrorCode,
} from './transport/gmail-errors'
export type {
  GmailClient,
  GmailFullThread,
  GmailMessageMetadata,
  GmailThread,
} from './transport/gmail-client'
export {
  buildRfc5322Message,
  encodeGmailRawMessage,
  LIST_UNSUBSCRIBE_ONE_CLICK,
  Rfc5322MessageError,
  type OutreachComposedMessage,
  type OutreachMailAddress,
} from './transport/rfc5322'
export {
  sendComposedOutreachEmail,
  sendOutreachMessage,
  type OutreachSentMessage,
  type SendOutreachMessageOptions,
} from './transport/send-message'
