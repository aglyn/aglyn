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
 * Outreach's console API routes, as the dispatcher keys them (AGL-2974).
 *
 * One table both halves import, because the server registers the path and the
 * client fetches it, and a route spelled twice is a route that 404s the day
 * one spelling changes. Every path sits under the `outreach` prefix that
 * `plugins.config.json` gives this plugin, which is what lets the console's
 * `/api/[...pluginApi]` dispatcher gate a request on the plugin being enabled
 * and released before the handler runs. Client-safe: constants only.
 */
export const OUTREACH_API_ROUTES = {
  /** `GET` — proves the server bundle loaded and registered; see `server.ts`. */
  ping: 'outreach/ping',
  // Mailboxes (AGL-2978). Every one names its org (`orgId`, query or body)
  // so the dispatcher's release gate asks about that organization.
  /** `GET ?orgId` — whether this deployment can connect a Google mailbox. */
  mailboxesAvailability: 'outreach/mailboxes/availability',
  /** `POST` — Google's consent address for a new connect. */
  mailboxesConnect: 'outreach/mailboxes/connect',
  /**
   * `GET` — Google's redirect back. It carries no bearer token: the signed
   * state names the org and the member, and the route hands the code to the
   * Mailboxes page in a fragment rather than acting on it.
   */
  mailboxesOAuthCallback: 'outreach/mailboxes/oauth/callback',
  /** `POST` — finishes a connect with the member's own session. */
  mailboxesConnectComplete: 'outreach/mailboxes/connect/complete',
  /** `POST` — send-as, display name, daily cap, sending window, timezone. */
  mailboxesSettings: 'outreach/mailboxes/settings',
  /** `POST` — pause or resume. */
  mailboxesStatus: 'outreach/mailboxes/status',
  /** `POST` — a plain-text test to the account's own address. */
  mailboxesTest: 'outreach/mailboxes/test',
  /** `POST` — revoke the grant at Google and delete the mailbox. */
  mailboxesDisconnect: 'outreach/mailboxes/disconnect',
  // Settings, sequences and enrollments (AGL-2980). Every one names its org
  // (`orgId`, query or body); the contract is `model/outreach-api.ts`.
  /** `GET ?orgId` — the compliance settings; `POST` — save them. */
  settings: 'outreach/settings',
  /** `POST` — create a sequence, or save an edit to one. */
  sequencesSave: 'outreach/sequences/save',
  /** `POST` — activate, pause or archive a sequence. */
  sequencesStatus: 'outreach/sequences/status',
  /** `POST` — delete a draft nobody was enrolled in. */
  sequencesDelete: 'outreach/sequences/delete',
  /** `POST` — who a saved view or a search would enroll, and where each stands. */
  enrollPreview: 'outreach/enroll/preview',
  /** `POST` — enroll them, every gate checked again. */
  enroll: 'outreach/enroll',
  /** `POST` — pause, resume, stop, or mark do-not-contact. */
  enrollmentsAction: 'outreach/enrollments/action',
  /**
   * `GET ?orgId` — the domains on the organization's do-not-contact list
   * (AGL-3244); `POST` — add one, or take one off.
   */
  doNotContactDomains: 'outreach/do-not-contact/domains',
  /**
   * `GET ?orgId` — each connected mailbox domain's click-tracking host
   * (AGL-3306), `links.<domain>`; `POST` — set one up, check it, or remove
   * it. Setting up and removing are an owner's or admin's.
   */
  linkDomains: 'outreach/link-domains',
  /** `POST` — one email of a saved sequence, for a contact or a sample person. */
  preview: 'outreach/preview',
  /**
   * `POST` — one step of a saved sequence, rendered as the preview renders
   * it and sent through the sequence's mailbox to the member (AGL-3325):
   * `[Test]` in the subject, its links minted as test links, and counted
   * on nothing but the mailbox's test tally.
   */
  stepTest: 'outreach/steps/test',
  /**
   * `POST` — one person's own copies of a sequence's email steps, drafted by
   * the workspace's AI (AGL-3324): for a person about to be enrolled, or for
   * the next step of an enrollment. Nothing is stored.
   */
  curateDraft: 'outreach/curate/draft',
  /** `POST` — stores a member's confirmed copy of one step on an enrollment, or clears it. */
  curateSave: 'outreach/curate/save',
  // The one route a RECIPIENT reaches (AGL-2981): no session, a signed
  // token instead, and registered as a recipient link so it answers whether
  // or not Outreach is released for the organization now.
  /** `GET` and the RFC 8058 one-click `POST` — `?t=<signed token>`. */
  unsubscribe: 'outreach/unsubscribe',
  /**
   * `GET` — a link in a tracked sequence email (AGL-3239). `?t=<signed
   * token>`; answers a redirect to the destination the token names, and
   * records the click afterwards. A recipient link like the unsubscribe
   * one: no session, and it answers whether or not Outreach is released to
   * the organization now, because a link in an email that already left must
   * not stop working when a rollout is paused.
   */
  click: 'outreach/click',
  /**
   * `GET` — the short tracking link (AGL-3297): `outreach/l/<id>`, where the
   * id names a stored `outreachLinks` document holding the destination. It
   * replaced the signed `click` link for every send since; `click` keeps
   * answering the links already in inboxes. A recipient link, for `click`'s
   * reasons.
   */
  shortLink: 'outreach/l/:linkId',
} as const
