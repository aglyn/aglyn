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
import { GRAPH_API_BASE } from './transport/graph-client'
import { MICROSOFT_LOGIN_ORIGIN } from './transport/microsoft-oauth'

/**
 * The hosts this plugin's code names (AGL-2978), declared here rather than in
 * the console's subprocessor inventory. Named under `subprocessors` in
 * `plugins.config.json`; the manifest generator calls
 * {@link outreachSubprocessors} and the inventory folds the answer in.
 *
 * A sequence sends a rep's one-to-one mail from the rep's OWN Google mailbox,
 * through the Gmail API, under an OAuth grant the rep gives from their own
 * Google account. `not-a-subprocessor` on the SECOND admissible reason: the
 * mailbox provider is the customer's, engaged by the customer for their own
 * mail, and a sequence acts in it at the rep's direction — Aglyn selects no
 * mail vendor for this, any more than it selects the video host an author
 * embeds. ⚑ A classification for legal to confirm when Sequences leaves staff
 * preview; the consent screen is Internal to the aglyn.com Workspace until
 * then.
 *
 * A rep's Microsoft 365 mailbox (AGL-3489) stands on the same footing:
 * Microsoft Graph is the customer's own mail provider, and Microsoft's
 * identity platform is where the rep grants the access.
 *
 * Google's token endpoint is already declared by the inventory, for the
 * platform's own service-account exchange, so this plugin adds its use of it
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
    "Customer-chosen destination. The Gmail REST API of the rep's own Google Workspace mailbox, which the rep connects in Sequences → Mailboxes (`libs/plugins/outreach/src/lib/transport/gmail-client.ts`): the account's profile and verified send-as addresses at connect, a plain-text test the rep sends to themselves, and — for the sending runtime (AGL-2981) — the sequence messages it sends, and the reads and searches of that same mailbox that find what came back: replies, out-of-office answers, bounces and unsubscribe requests. The provider is the one the customer runs its mail on; nothing is sent to a mailbox the rep did not connect.",
  dataReceived:
    "The rep's own OAuth access token, and the mail the rep sends from their own mailbox — each recipient's address, the subject and the plain-text body. The runtime's searches carry the addresses of the people the rep is writing to, the rep's `+unsubscribe` address and the Message-IDs of mail it sent. What the runtime reads back is the rep's own mail: the ids of newly received messages, and whole messages — headers and plain-text or HTML bodies, delivery reports included — of the rep's sequence threads and of the replies, bounces and unsubscribe requests its searches find. No other customer record, and nothing about a site visitor.",
}

/** Google's consent address, which only the rep's browser opens. */
export const OUTREACH_GOOGLE_CONSENT_HOST: PluginEgressHostDeclaration = {
  host: new URL(GOOGLE_OAUTH_ENDPOINTS.authorize).host,
  disposition: 'no-request',
  reason:
    "Google's OAuth consent address, built by `buildGoogleAuthorizationUrl` in `libs/plugins/outreach/src/lib/transport/google-oauth.ts` and handed to the rep's own browser, which opens it to grant Sequences access to the rep's own mailbox. No server of ours requests it; the browser's visit is between the rep and their Google account.",
  dataReceived:
    "Nothing from our servers. The rep's browser carries the OAuth client id, the requested scopes, a signed state, a PKCE challenge and a login hint — the rep's own sign-in address.",
}

/** Google's token and revocation endpoint, declared by the inventory. */
export const OUTREACH_GOOGLE_TOKEN_USE: PluginEgressUseDeclaration = {
  host: new URL(GOOGLE_OAUTH_ENDPOINTS.token).host,
  reason:
    "Since AGL-2978 also the Sequences OAuth token endpoint for a rep's own Google mailbox grant — the code exchange at connect, the access-token refresh before each Gmail call, and the revocation on disconnect, org erasure or account erasure — which is the rep's own account at the rep's own provider, the same footing as `gmail.googleapis.com`.",
  dataReceived:
    "For Sequences: the deployment's OAuth client credentials and, for the rep's own grant, the authorization code, PKCE verifier, refresh token and access token Google itself issued — credentials, never message content. ⚑ Legal to confirm the Annex III cell needs no change for the Sequences use.",
}

/** Microsoft Graph: the rep's own Microsoft 365 mailbox (AGL-3489). */
export const OUTREACH_GRAPH_HOST: PluginEgressHostDeclaration = {
  host: new URL(GRAPH_API_BASE).host,
  disposition: 'not-a-subprocessor',
  reason:
    "Customer-chosen destination. Microsoft Graph for the rep's own Microsoft 365 (Exchange Online) mailbox, which the rep connects in Sequences → Mailboxes (`libs/plugins/outreach/src/lib/transport/graph-client.ts`): the account's id, address and display name at connect, a plain-text test the rep sends, the sequence messages the sending runtime sends — each created as a draft in the rep's mailbox and sent from there — and the reads of that same mailbox that find what came back: replies, out-of-office answers, bounces and unsubscribe requests. The provider is the one the customer runs its mail on; nothing is sent to a mailbox the rep did not connect.",
  dataReceived:
    "The rep's own OAuth access token, and the mail the rep sends from their own mailbox — each recipient's address, the subject and the body. The runtime's reads carry a received-time window, conversation ids and the Message-IDs of mail it sent. What the runtime reads back is the rep's own mail: the ids, senders, recipients and received times of the window's messages, and whole messages — headers and bodies, delivery reports included — of the rep's sequence conversations and of the replies, bounces and unsubscribe requests among them. No other customer record, and nothing about a site visitor.",
}

/**
 * Microsoft's identity platform: the consent address the rep's browser opens,
 * and the token endpoint the console calls for that same grant.
 */
export const OUTREACH_MICROSOFT_LOGIN_HOST: PluginEgressHostDeclaration = {
  host: new URL(MICROSOFT_LOGIN_ORIGIN).host,
  disposition: 'not-a-subprocessor',
  reason:
    "Customer-chosen destination. Microsoft's identity platform for the rep's own Microsoft 365 account (`libs/plugins/outreach/src/lib/transport/microsoft-oauth.ts`): the consent address `buildMicrosoftAuthorizationUrl` hands the rep's browser, and the token endpoint the console calls for the code exchange at connect and the access-token refresh before each Graph call — the rep's own account at the rep's own provider, the same footing as `graph.microsoft.com`.",
  dataReceived:
    "From the rep's browser, the app registration's client id, the requested permissions, a signed state, a PKCE challenge and a login hint. From our servers, the deployment's client credentials and, for the rep's own grant, the authorization code, PKCE verifier and the refresh token Microsoft itself issued — credentials, never message content.",
}

/** The plugin's `subprocessors` entry: no recipient of its own, four hosts and one use. */
export function outreachSubprocessors(): PluginSubprocessorsAnswer {
  return {
    subprocessors: [],
    hosts: [OUTREACH_GMAIL_HOST, OUTREACH_GOOGLE_CONSENT_HOST, OUTREACH_GRAPH_HOST, OUTREACH_MICROSOFT_LOGIN_HOST],
    uses: [OUTREACH_GOOGLE_TOKEN_USE],
  }
}
