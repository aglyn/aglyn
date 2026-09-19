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

import type {
  PluginEgressHostDeclaration,
  PluginEgressUseDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { GMAIL_API_BASE } from './transport/gmail-client'
import { GOOGLE_OAUTH_ENDPOINTS } from './transport/google-oauth'

/**
 * The hosts Outreach's code names (AGL-2978), declared here rather than in
 * the console's subprocessor inventory. Named under `subprocessors` in
 * `plugins.config.json`; the manifest generator calls
 * {@link outreachSubprocessors} and the inventory folds the answer in.
 *
 * Outreach sends a rep's one-to-one mail from the rep's OWN Google mailbox,
 * through the Gmail API, under an OAuth grant the rep gives from their own
 * Google account. `not-a-subprocessor` on the SECOND admissible reason: the
 * mailbox provider is the customer's, engaged by the customer for their own
 * mail, and Outreach acts in it at the rep's direction — Aglyn selects no
 * mail vendor for this, any more than it selects the video host an author
 * embeds. ⚑ A classification for legal to confirm when Outreach leaves staff
 * preview; the consent screen is Internal to the aglyn.com Workspace until
 * then.
 *
 * Google's token endpoint is already declared by the inventory, for the
 * platform's own service-account exchange, so Outreach adds its use of it
 * rather than a second declaration.
 *
 * Each host is read off the constant the transport calls, so a moved
 * endpoint moves its declaration with it.
 */

/** The Gmail REST API: the rep's own mailbox. */
export const OUTREACH_GMAIL_HOST: PluginEgressHostDeclaration = {
  host: new URL(GMAIL_API_BASE).host,
  disposition: 'not-a-subprocessor',
  reason:
    "Customer-chosen destination. The Gmail REST API of the rep's own Google Workspace mailbox, which the rep connects in Outreach → Mailboxes (`libs/plugins/outreach/src/lib/transport/gmail-client.ts`): the account's profile and verified send-as addresses at connect, a plain-text test the rep sends to themselves, and — for the sending runtime (AGL-2981) — the sequence messages it sends, and the reads and searches of that same mailbox that find what came back: replies, out-of-office answers, bounces and unsubscribe requests. The provider is the one the customer runs its mail on; nothing is sent to a mailbox the rep did not connect.",
  dataReceived:
    "The rep's own OAuth access token, and the mail the rep sends from their own mailbox — each recipient's address, the subject and the plain-text body. The runtime's searches carry the addresses of the people the rep is writing to, the rep's `+unsubscribe` address and the Message-IDs of mail it sent. What the runtime reads back is the rep's own mail: the ids of newly received messages, and whole messages — headers and plain-text or HTML bodies, delivery reports included — of the rep's Outreach threads and of the replies, bounces and unsubscribe requests its searches find. No other customer record, and nothing about a site visitor.",
}

/** Google's consent address, which only the rep's browser opens. */
export const OUTREACH_GOOGLE_CONSENT_HOST: PluginEgressHostDeclaration = {
  host: new URL(GOOGLE_OAUTH_ENDPOINTS.authorize).host,
  disposition: 'no-request',
  reason:
    "Google's OAuth consent address, built by `buildGoogleAuthorizationUrl` in `libs/plugins/outreach/src/lib/transport/google-oauth.ts` and handed to the rep's own browser, which opens it to grant Outreach access to the rep's own mailbox. No server of ours requests it; the browser's visit is between the rep and their Google account.",
  dataReceived:
    "Nothing from our servers. The rep's browser carries the OAuth client id, the requested scopes, a signed state, a PKCE challenge and a login hint — the rep's own sign-in address.",
}

/** Google's token and revocation endpoint, declared by the inventory. */
export const OUTREACH_GOOGLE_TOKEN_USE: PluginEgressUseDeclaration = {
  host: new URL(GOOGLE_OAUTH_ENDPOINTS.token).host,
  reason:
    "Since AGL-2978 also Outreach's OAuth token endpoint for a rep's own Google mailbox grant — the code exchange at connect, the access-token refresh before each Gmail call, and the revocation on disconnect, org erasure or account erasure — which is the rep's own account at the rep's own provider, the same footing as `gmail.googleapis.com`.",
  dataReceived:
    "For Outreach: the deployment's OAuth client credentials and, for the rep's own grant, the authorization code, PKCE verifier, refresh token and access token Google itself issued — credentials, never message content. ⚑ Legal to confirm the Annex III cell needs no change for the Outreach use.",
}

/** The plugin's `subprocessors` entry: no recipient of its own, two hosts and one use. */
export function outreachSubprocessors(): PluginSubprocessorsAnswer {
  return {
    subprocessors: [],
    hosts: [OUTREACH_GMAIL_HOST, OUTREACH_GOOGLE_CONSENT_HOST],
    uses: [OUTREACH_GOOGLE_TOKEN_USE],
  }
}
