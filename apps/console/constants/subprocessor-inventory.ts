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
 * Every third-party host this repo's own code names, and what it receives
 * (AGL-1648).
 *
 * ## The defect this exists to fix
 *
 * On 2026-08-24 Linear was found to be a live subprocessor receiving customer
 * personal data, appearing on no published list. The console's "Report an
 * issue" dialog posts to `api.linear.app/graphql` with the reporter's email
 * and account id, their organization's id, name, plan and their role, the host
 * id and name, a correlation id, the build identifiers, the viewport and the
 * user-agent, plus whatever they typed.
 *
 * The missing row was the cheap half and is already published. The expensive
 * half is that FOUR green checks were running over that code and every one of
 * them was structurally incapable of seeing it:
 *
 *   `check:dependency-egress`   walks the PACKAGE CLOSURE for host literals.
 *                               This is a first-party `fetch` in our own
 *                               source; no package on disk names Linear.
 *   `cookie-inventory.spec.ts`  keys on cookie WRITES. Linear sets none.
 *   `assist-anthropic-…gate`    pins one env var name, `ANTHROPIC_API_KEY`.
 *                               A guard keyed on a name only ever finds the
 *                               vendor it was already written about.
 *   `check:legal-drift`         compares PROSE TO PROSE. It cannot see code,
 *                               by design, and says so.
 *
 * Four detectors, four different blind spots, one uncovered union. So the key
 * here is deliberately none of theirs: it is the OUTBOUND HOST, because that
 * is the thing data actually leaves through. A host is what an Annex III row
 * is ultimately about, it is invariant to which env var holds the credential
 * and to whether the vendor ships a package, and it is the one property
 * `api.linear.app` could not have hidden behind.
 *
 * ## The registry is the source for the published list
 *
 * `/legal/subprocessors` is besigner content on the live marketing site — not
 * a file in this repo — and `/legal/dpa` §7.1 makes that page Annex III to the
 * SCCs by incorporation. Nothing in the build can read it. What the build CAN
 * do is refuse the state that makes it wrong: a third-party host reached by
 * our code with no declaration here, and no declaration here without a
 * `publishedOn` date recording that the page and its change log were updated.
 *
 * That is why `publishedOn` is required rather than optional. It is not
 * decoration: writing it is the moment someone has to go and look at the page.
 * `derivePublishedRows()` turns this file into the row set the page must
 * carry, so the comparison is mechanical for whoever next edits it.
 *
 * ## ⚠️ NO NOTICE-PERIOD ARITHMETIC LIVES HERE, AND THAT IS DELIBERATE
 *
 * Do not assert `mayBeginProcessingOn === publishedOn + 30 days`, or any other
 * notice window, anywhere in this registry.
 *
 * DPA §7.2 and the Subprocessors intro carry NO advance-notice obligation —
 * not thirty days, and not an unfixed period either. Code that computed a
 * notice window would reassert a commitment the legal text does not make, and
 * a guard that enforces a promise the DPA does not contain is a liability
 * rather than a control.
 *
 * **That reasoning expires the moment the first customer signs.** From the
 * first signature, any subsequent subprocessor addition needs a real
 * notification mechanism, and re-adding both the DPA clause and the arithmetic
 * becomes work, not a nicety. GDPR Art. 28(2) contemplates the controller
 * having an opportunity to object; the DPA currently offers none, which was
 * flagged before the decision and accepted. Whoever reads this after the first
 * customer signs: this paragraph is the trigger.
 *
 * ## What the sweep cannot see — read before trusting a green
 *
 *  - **A host built at runtime.** Firebase Realtime Database is reached
 *    through `databaseURL` from client config, so no literal for it exists in
 *    `apps/` or `libs/` at all. That whole class lives in `SDK_EGRESS` below
 *    and is pinned by an imported symbol instead, the same trick
 *    `THIRD_PARTY_COOKIES` uses for cookies no scan of ours can find.
 *  - **A host inside a comment.** The sweep skips comment lines, because
 *    otherwise the Apache licence header in every file would drown it. A
 *    `fetch` commented out is not a data flow; a `fetch` whose URL is only in
 *    a docblock is invisible, and that is the accepted cost.
 *  - **What a marketplace plugin bundle contacts.** Not in this repo.
 *  - **A host an AUTHOR typed.** The largest invisible class, and the one
 *    most likely to be misfiled — in either direction. A site owner may paste
 *    any `https` address into an image field, a post, a cover, or a `url(...)`
 *    in their own CSS, and the visitor's browser then fetches it directly. No
 *    literal for it can exist here, because our code never names it, and no
 *    input validator sees it either: `sanitizeAuthorCss` refuses the SCHEME
 *    and deliberately never the host.
 *
 *    **Those hosts are not Annex III rows, and must not be added as ones**
 *    (AGL-1736). Annex III lists the sub-processors AGLYN engages; this
 *    recipient was engaged by the customer, who is the controller for their
 *    own visitors, and we introduced nobody — we provided a canvas. The set
 *    is also per-customer, unbounded, and changes with any edit, so it is not
 *    enumerable even in principle and a catch-all row naming the CATEGORY
 *    would be a vendor entry that names no vendor.
 *
 *    Note the boundary against `not-a-subprocessor` below, because it is
 *    narrow and the YouTube and Vimeo entries sit on the other side of it:
 *    that disposition is for a customer-chosen destination OUR CODE NAMES, so
 *    a reader who greps the tree and finds the literal has somewhere to land.
 *    A host only the customer ever names has no literal to declare, so it
 *    gets no entry here at all. Silence in this file is therefore NOT the
 *    disclosure — the disclosure is a product property, stated on the trust
 *    page and in the Privacy Policy and DPA clauses that say Aglyn does not
 *    proxy the request and that the site owner names their own hosts.
 *  - **What a vendor's own package contacts.** That is
 *    `check:dependency-egress` and its 152-row register; this file is its
 *    complement, not its replacement. Neither subsumes the other — that was
 *    the whole lesson.
 *  - **Whether the published page actually says any of this.** No repo check
 *    can read besigner content. `derivePublishedRows()` makes the comparison
 *    one a person can do in a minute; it does not do it for them.
 */

/** What a declaration says about a host the sweep found. */
export type EgressDisposition =
  /**
   * A third party that receives data. It MUST appear on `/legal/subprocessors`
   * and MUST carry the change-log date on which it was published.
   */
  | 'subprocessor'
  /**
   * A request really is made to this host, and it is still not an Annex III
   * row. Only two reasons qualify, and the entry has to say which: no personal
   * data of a customer or their visitors reaches it, or the destination is
   * chosen by the customer rather than by Aglyn. "It seemed minor" is not one.
   */
  | 'not-a-subprocessor'
  /**
   * The literal is never fetched: an XML namespace, a JSON-LD `@context`, a
   * link we render for a human to click, a placeholder in a form field, an
   * example value in a config fixture. No request, no recipient.
   */
  | 'no-request'

/** One third-party host, and the reason it is allowed to be in the tree. */
export interface EgressHost {
  readonly disposition: EgressDisposition
  /**
   * Why this host is in the codebase at all, in the words the next reader
   * needs. For `no-request` and `not-a-subprocessor` this is the evidence for
   * the claim, not a restatement of it.
   */
  readonly reason: string
  /**
   * What the recipient actually receives. For a `subprocessor` this is the
   * text the Annex III "data processed" cell has to cover — write it from the
   * code, not from the vendor's marketing. For the other dispositions it says
   * what does NOT go, which is the load-bearing half.
   */
  readonly dataReceived: string
  /** The legal entity, where one receives data. */
  readonly entity?: string
  /** Where it processes, as the published table states it. */
  readonly region?: string
  /** The published purpose cell, grouped per entity on the page. */
  readonly purpose?: string
  /**
   * The `/legal/subprocessors` change-log date on which this host's entity was
   * published, `YYYY-MM-DD`. Required for every `subprocessor`.
   *
   * This is the whole mechanism. A new vendor host cannot go green here
   * without a date, and a date cannot be written honestly without opening the
   * page. It is NOT a notice period and nothing computes with it — see the
   * warning at the top of this file.
   */
  readonly publishedOn?: string
}

/**
 * Data-protection supervisory authorities, rendered as links in the member
 * lodging-a-complaint disclosure (`apps/console/utils/server/member-state-exposure.ts`).
 *
 * Thirty hosts from one file, all the same shape: GDPR Art. 77 gives a data
 * subject the right to complain to their own authority, so the console prints
 * that authority's address. Aglyn never requests any of them, and pushing them
 * through the same declaration as a real recipient would bury the four rows
 * that matter under thirty that do not.
 */
export const SUPERVISORY_AUTHORITY_HOSTS: readonly string[] = [
  'azop.hr',
  'cnpd.public.lu',
  'dataprotection.gov.sk',
  'ico.org.uk',
  'idpc.org.mt',
  'naih.hu',
  'tietosuoja.fi',
  'uodo.gov.pl',
  'uoou.gov.cz',
  'vdai.lrv.lt',
  'www.aepd.es',
  'www.aki.ee',
  'www.autoriteitpersoonsgegevens.nl',
  'www.autoriteprotectiondonnees.be',
  'www.bfdi.bund.de',
  'www.cnil.fr',
  'www.cnpd.pt',
  'www.cpdp.bg',
  'www.dataprotection.gov.cy',
  'www.dataprotection.ie',
  'www.dataprotection.ro',
  'www.datatilsynet.dk',
  'www.datatilsynet.no',
  'www.datenschutzstelle.li',
  'www.dpa.gr',
  'www.dsb.gv.at',
  'www.dvi.gov.lv',
  'www.garanteprivacy.it',
  'www.imy.se',
  'www.ip-rs.si',
  'www.personuvernd.is',
]

const SUPERVISORY_AUTHORITY_ENTRY: EgressHost = {
  disposition: 'no-request',
  reason:
    'A GDPR Art. 77 supervisory-authority address, printed as a link in the console so a member can find their own regulator. Rendered, never requested.',
  dataReceived:
    'Nothing from us. A member who clicks the link visits their regulator directly, and that visit is between them and the regulator.',
}

/**
 * Every third-party host named in `apps/`, `libs/` and `tools/`, keyed by
 * host, checked in both directions by `subprocessor-inventory.spec.ts`.
 *
 * Adding an entry with `disposition: 'subprocessor'` is the point at which
 * someone must publish the row. Do not add one to make the suite pass.
 */
export const EGRESS_HOSTS: Record<string, EgressHost> = {
  // MARK – Stripe

  'api.stripe.com': {
    disposition: 'subprocessor',
    entity: 'Stripe, Inc.',
    region: 'United States',
    purpose:
      'Payment processing, subscription billing, and payouts to merchants who sell through the Services',
    publishedOn: '2026-08-05',
    reason:
      'The payments API, reached from 44 first-party server modules — platform billing, storefront checkout, bookings, marketplace, Connect onboarding and the refund paths. The broadest first-party egress in the repo.',
    dataReceived:
      "The paying person's name, email and billing address, card details entered directly into Stripe's own elements, line items and amounts, the merchant's Connect account identity and payout details, and the org identifiers carried on metadata.",
  },

  // MARK – Vercel

  'api.vercel.com': {
    disposition: 'subprocessor',
    entity: 'Vercel Inc.',
    region: 'United States',
    purpose:
      'Application hosting, and programmatic management of the custom domains customers attach to their sites',
    publishedOn: '2026-08-05',
    reason:
      'The domains API, called when a customer attaches or detaches a custom domain, when a workspace subdomain redirect is reconciled, and by the deploy and firewall tooling.',
    dataReceived:
      'The customer-chosen domain name, the project it is attached to, and the verification records for it. Hosting itself carries every request to the Services, which is the wider basis for the row.',
  },

  // MARK – Resend

  'api.resend.com': {
    disposition: 'subprocessor',
    entity: 'Resend (Plus Five Five, Inc.)',
    region: 'United States',
    purpose: 'Transactional email delivery',
    publishedOn: '2026-08-05',
    reason:
      'The single send endpoint every system email leaves through — invitations, security alerts, receipts, and the storefront mail a merchant sends their own customers.',
    dataReceived:
      "The recipient's email address, the rendered subject and body — which for storefront mail contains the merchant's customer's name and order — and the delivery tag used to attribute webhooks.",
  },

  // MARK – Linear
  //
  // THE ONE THIS FILE EXISTS FOR. It is left first in the reader's mind on
  // purpose: this row is the regression test, and the spec names the host
  // explicitly in its anti-vacuity assertion so a broken sweep cannot quietly
  // stop finding it.

  'api.linear.app': {
    disposition: 'subprocessor',
    entity: 'Linear Orbit, Inc.',
    region: 'United States',
    purpose:
      "Filing and triage of issue reports submitted through the console's \"Report an issue\" dialog",
    publishedOn: '2026-08-24',
    reason:
      'The GraphQL endpoint the console files issue reports into, live on `LINEAR_API_KEY` in production. Undisclosed until 2026-08-24 while four separate green checks ran over it — see the header of this file.',
    dataReceived:
      "The report text the reporter writes, their email address and account identifier, their organization's name, identifier, plan and their role in it, the site the report was filed from, a correlation id, the application build identifiers, and the browser viewport and user-agent.",
  },

  // MARK – Anthropic

  'api.anthropic.com': {
    disposition: 'subprocessor',
    entity: 'Anthropic PBC',
    region: 'United States',
    purpose:
      'Generating the responses of the in-product assistant and the besigner copy assistant',
    publishedOn: '2026-08-18',
    reason:
      "Two model endpoints. `apps/console/app/api/assist/chat/route.ts` is gated by `release_assist` AND the key; `libs/plugins/marketplace/src/lib/server/ai-assist.ts` carries NO release flag, so setting `ANTHROPIC_API_KEY` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-reader detail and is the deeper guard for this one vendor.",
    dataReceived:
      "The customer's question and a trailing window of the thread, and — for the besigner assistant — the site copy, blog bodies and section briefs being written. On Pro and above the current route, host and organization name travel with the question.",
  },

  // MARK – Google LLC
  //
  // One legal entity, many hosts, and they are NOT collapsed into one entry.
  // Collapsing is how a Google product ends up undisclosed while "Google" is
  // on the page: `www.google-analytics.com` below receives commerce events
  // under no consent gate, which is a different disclosure from Firestore
  // holding a customer's documents, and a single "Google" row hides that.

  'firestore.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'The database REST surface, used by the export and backup-health routes and by the index tooling. The SDK path to the same store is pinned in `SDK_EGRESS`.',
    dataReceived:
      'Everything the product stores: organization and member records, site content, orders and their customers, and the audit log.',
  },
  'firebasestorage.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'Media upload, replace, download-token and preview-image paths, plus the API v1 resource URLs handed to customers.',
    dataReceived:
      'Every file a customer or their site visitors upload, and the filenames and paths around them.',
  },
  'storage.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'The bucket surface behind backup verification, the media-reference backfill and the marketplace artifact store — the GCS bucket that is deliberately invisible to Firebase tooling.',
    dataReceived:
      'Database export archives, which contain the full contents of the store, and published plugin artifacts.',
  },
  'identitytoolkit.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'The Identity Platform admin surface, used by the org lockdown path to disable accounts and by the authorized-domains tooling.',
    dataReceived:
      'Account identifiers, email addresses, and the disabled/enabled state a lockdown sets.',
  },
  'logging.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-18',
    reason:
      'Cloud Logging `entries:write`, the sink for client-side error reports and beacons from customer sites.',
    dataReceived:
      "The error message and stack, the URL it happened on, the host and build identifiers, and the reporting browser's user-agent.",
  },
  'recaptchaenterprise.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'The reCAPTCHA Enterprise admin API, used to keep the App Check key\'s domain allowlist in step with the custom console domains customers add.',
    dataReceived:
      'Domain names customers have attached. No end-user data — the assessment traffic itself is browser-side and belongs to the App Check integration.',
  },
  'firebaserules.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'The security-rules control plane, reached by the rules deploy and drift tooling and by the publish-journey health probe, which reads the live ruleset to confirm publishing is still authorized (AGL-2586).',
    dataReceived:
      'Rule source text. A control plane for the same store, carrying no customer data of its own — listed rather than exempted because the entity is the unit a reader cares about.',
  },
  'www.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'The Drive API surface used by the legal-document drift and snapshot checkers to read the master Docs, and the service-account certificate URL in the self-host CI fixture.',
    dataReceived:
      "Aglyn's own legal document text, read not written. No customer data.",
  },
  'oauth2.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Firebase / Google Cloud)',
    region: 'United States',
    purpose:
      'Primary application database, file storage, authentication, backups, and platform logging',
    publishedOn: '2026-08-05',
    reason:
      'Service-account token exchange for the Drive reads above and for the admin surfaces.',
    dataReceived: "Aglyn's own service-account assertion. No customer data.",
  },

  /**
   * ⚑ The under-disclosed one, and the reason a "Google" row is not enough.
   *
   * `libs/tenant/data/admin/src/lib/server/ga4-measurement-protocol.ts` posts
   * `purchase`, `refund`, `subscription_cancelled` and `site_published` to the
   * Measurement Protocol from the SERVER. Two properties make it different
   * from the browser-side analytics already disclosed:
   *
   *  1. There is no consent gate on this path. The browser tag is behind the
   *     consent banner; a server POST is not, and cannot be.
   *  2. The protocol requires a `client_id`. Where the browser's real one was
   *     not captured at checkout start, the code SYNTHESIZES one from the
   *     Stripe customer id — a stable pseudonymous identifier for a specific
   *     paying person, derived from a payment record, sent to an analytics
   *     product.
   *
   * `sanitizeEventParams` mitigates the payload. It does not change either of
   * those two facts, and neither is covered by an analytics row written about
   * a browser tag. Recorded here as under-disclosed rather than quietly
   * folded into the Firebase entry.
   */
  'www.google-analytics.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Google Analytics)',
    region: 'United States',
    purpose:
      'Product and commerce analytics, including server-reported purchase and subscription events',
    publishedOn: '2026-08-18',
    reason:
      'The GA4 Measurement Protocol endpoint, posted to from the server on `GA4_MEASUREMENT_ID` + `GA4_API_SECRET`. Under-disclosed: the published analytics row was written about the browser tag, and this path has no consent gate.',
    dataReceived:
      'Purchase, refund, subscription-cancellation and site-publication events with their amounts and currency, the host they belong to, and a `client_id` that is either the browser\'s own GA id or, failing that, a value synthesized from the Stripe customer id.',
  },
  'www.googletagmanager.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Google Analytics)',
    region: 'United States',
    purpose:
      'Product and commerce analytics, including server-reported purchase and subscription events, and the Google Tag Manager container and Google Ads tag where either is configured',
    publishedOn: '2026-08-18',
    reason:
      "The gtag loader injected into a customer site that has configured its own measurement id, and the same host serving `gtm.js` for a Google Tag Manager container and `gtag/js` for a Google Ads id on Aglyn's own surfaces. Browser-side, and behind the consent gate — unlike the Measurement Protocol path above.",
    dataReceived:
      "Page views and events from a visitor's browser, with the identifiers gtag sets. Loaded only where an id is configured and, in prior-consent regions, only after the visitor allowed analytics. ⚠️ A CONTAINER is a loader rather than a tag: what it fetches is configured in Google's interface and is not visible from this repository, so this row describes what the container can carry and cannot enumerate what a given container holds.",
  },
  'fonts.googleapis.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Google Fonts)',
    region: 'United States',
    purpose: 'Serving web fonts to site visitors and to the editor',
    publishedOn: '2026-08-18',
    reason:
      'The stylesheet host for the font families a site owner picks in the theme, and for the blog-cover generator.',
    dataReceived:
      "A visitor's IP address and user-agent, as an unavoidable property of the browser fetching the stylesheet. No account or order data.",
  },
  'fonts.gstatic.com': {
    disposition: 'subprocessor',
    entity: 'Google LLC (Google Fonts)',
    region: 'United States',
    purpose: 'Serving web fonts to site visitors and to the editor',
    publishedOn: '2026-08-18',
    reason:
      'The font-file host preconnected from the besigner editor pages and from a published site layout.',
    dataReceived:
      "A visitor's IP address and user-agent. No account or order data.",
  },

  // MARK – Meta

  'connect.facebook.net': {
    disposition: 'subprocessor',
    entity: 'Meta Platforms, Inc.',
    region: 'United States',
    purpose:
      "Advertising measurement and retargeting on Aglyn's own surfaces — the marketing site, the console and the docs — and on a customer site whose owner has enabled the advertising question and configured a pixel",
    publishedOn: '2026-08-20',
    reason:
      'The Meta Pixel loader in `libs/aglyn/src/lib/app-utils/advertising-tags.ts`, mounted on a tenant page by the tenant runtime, on the console by `apps/console/components/advertising-tags.component.tsx`, and on the docs site by its standalone copy in `apps/docs/src/advertising-tags.ts`. Disclosed by CAPABILITY rather than by rollout, which is the standing rule — the code can load it, so the document says so.',
    dataReceived:
      'Page views and conversion events from a visitor whose recorded consent grants advertising on a surface that asks about it, with the identifiers the pixel sets. On the console that visitor may be signed in, so the pageviews describe an identified account holder moving through a product rather than an anonymous reader of a marketing page.',
  },

  // MARK – LinkedIn

  'snap.licdn.com': {
    disposition: 'subprocessor',
    entity: 'LinkedIn Corporation',
    region: 'United States',
    purpose:
      "Advertising measurement and retargeting on Aglyn's own surfaces — the marketing site, the console and the docs — and on a customer site whose owner has enabled the advertising question and configured a partner id",
    publishedOn: '2026-08-27',
    reason:
      'The LinkedIn Insight Tag loader in `libs/aglyn/src/lib/app-utils/advertising-tags.ts`, mounted on the same three first-party surfaces as the Meta Pixel above. Disclosed by CAPABILITY rather than by rollout, the same standing rule Meta is declared under — the code can load it, so the document says so.',
    dataReceived:
      "Page views and conversion events from a visitor whose consent state permits advertising on a surface that asks about it, with the identifiers the tag sets. LinkedIn additionally sets cookies on its own domain, which a page on our origin cannot read or clear. On the console that visitor may be signed in, so the same caveat the Meta row carries applies here.",
  },

  // MARK – Requests that are made, and are still not Annex III rows
  //
  // Two admissible reasons only: nothing personal reaches the host, or the
  // customer chose the destination rather than Aglyn. Each entry says which.

  'www.youtube-nocookie.com': {
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. The embed block renders an iframe for a URL a site author pasted into their own page. Aglyn selected no video vendor; the author did, and could equally paste a different one. The privacy-enhanced host is used precisely so the default carries less.",
    dataReceived:
      "Whatever an embedded player receives from the visitor's browser — IP and user-agent — on a page the site author chose to put it on. Nothing from Aglyn's own records.",
  },
  'player.vimeo.com': {
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination, identical shape to the YouTube embed above.',
    dataReceived:
      "Whatever an embedded player receives from the visitor's browser, on a page the site author chose to put it on.",
  },
  'picsum.photos': {
    disposition: 'not-a-subprocessor',
    reason:
      'Placeholder imagery in the demo-seed and screenshot-capture scripts. It reaches production only as image URLs on Aglyn-owned demo orgs; no customer site is seeded with it, and no customer record ever names it.',
    dataReceived:
      "A demo page visitor's IP and user-agent when their browser loads the placeholder. No customer data exists on those orgs to send.",
  },

  // The two Google control-plane endpoints `check:app-check-debug-tokens`
  // calls (AGL-2402). Google LLC is already an Annex III recipient and these
  // add no new one — but the registry keys on the HOST and deliberately does
  // not collapse a vendor into one entry (see the note above the Google
  // block), so each is declared on its own terms.
  //
  // They are `not-a-subprocessor` on the FIRST admissible reason, not the
  // second: no customer chose them, and nothing personal reaches them. This
  // is Aglyn asking Google about Aglyn's own project, from an operator's
  // shell. No tenant, member or site-visitor record is in scope of the
  // process, so there is none to send.
  //
  // NOT `no-request`: both are really fetched. That disposition would be a
  // lie, and the lie is the failure mode this registry exists to prevent.

  'firebase.googleapis.com': {
    disposition: 'not-a-subprocessor',
    reason:
      'Firebase Management `projects.searchApps`, called only by the operator CLI `npm run check:app-check-debug-tokens` to enumerate Aglyn\'s OWN Firebase apps so the next call can ask whether a debug token is still registered on each. It is never imported by the console or tenant runtime — no request-serving code path reaches it — and it authenticates as the operator running it, not as any customer.',
    dataReceived:
      "Aglyn's own project id and the operator's own Google ADC access token. No customer, member or visitor personal data exists anywhere in this path to send; what comes back is Aglyn's own app list.",
  },
  'firebaseappcheck.googleapis.com': {
    disposition: 'not-a-subprocessor',
    reason:
      'App Check `debugTokens.list`, called by the same operator CLI to prove no standing attestation bypass is registered on a live app. Same shape as the Management call above: Aglyn interrogating Aglyn\'s own project configuration, outside any request-serving path.',
    dataReceived:
      "Aglyn's own project and app ids, plus the operator's own access token. No customer data is in scope; the response carries debug-token metadata (`name`, `displayName`, `updateTime`) and, by API design, never a token value.",
  },
  'cloudfunctions.googleapis.com': {
    disposition: 'not-a-subprocessor',
    reason:
      'Cloud Functions `functions.list`, read by the operator CLI `npm run check:functions-drift` and by the promotion deploy guard to ask when each scheduled function was last deployed. `firebase deploy --only functions` ships outside the git pipeline, so this is the only way to tell a shipped function from a merged one. It is never imported by the console or tenant runtime — no request-serving code path reaches it — and it authenticates as the operator running it, using Application Default Credentials rather than the Firebase service account, which carries no permission on this API at all.',
    dataReceived:
      "Aglyn's own project id and the operator's own access token. No customer, member or visitor personal data exists anywhere in this path to send; what comes back is deployment metadata about Aglyn's own functions — resource name, region, state and `updateTime`.",
  },

  // MARK – Literals that are never fetched
  //
  // Namespaces, contexts, link text, form placeholders, fixture values. Each
  // one is here so the sweep stays exhaustive: an unexplained host is the
  // failure state, and "obviously fine" is what was said about Linear.

  'www.w3.org': {
    disposition: 'no-request',
    reason:
      'XML namespace URIs, in the RSS `atom:` declaration, the admin bar and the icon and image components. A namespace is an identifier that happens to look like a URL.',
    dataReceived: 'Nothing. No request is made.',
  },
  'www.sitemaps.org': {
    disposition: 'no-request',
    reason:
      'The sitemap XML namespace URI, declared on the sitemap the tenant app serves. An identifier, dereferenced by nobody.',
    dataReceived: 'Nothing. No request is made.',
  },
  'base.google.com': {
    disposition: 'no-request',
    reason:
      'The `g:` namespace URI of the Google Merchant product feed the commerce plugin generates. The feed is served BY us and fetched by whoever the merchant gives it to.',
    dataReceived: 'Nothing. No request is made.',
  },
  'schema.org': {
    disposition: 'no-request',
    reason:
      'The JSON-LD `@context` value emitted in structured data on published pages and product details. Consumed by crawlers reading our HTML; never dereferenced by us.',
    dataReceived: 'Nothing. No request is made.',
  },
  'schemas.xmlsoap.org': {
    disposition: 'no-request',
    reason:
      'SAML attribute-name URIs used to read claims out of an enterprise IdP assertion. Identifiers in a document we parse.',
    dataReceived: 'Nothing. No request is made.',
  },
  'console.cloud.google.com': {
    disposition: 'no-request',
    reason:
      'A deep link staff click from the plugin-review screen to inspect an artifact. Rendered as an anchor.',
    dataReceived:
      'Nothing from us. A staff member who clicks it authenticates to Google themselves.',
  },
  'console.firebase.google.com': {
    disposition: 'no-request',
    reason:
      'A staff deep link from the email-health admin screen, pointing at the Firebase console for the same project.',
    dataReceived:
      'Nothing from us. A staff member who clicks it authenticates to Google themselves.',
  },
  'groups.google.com': {
    disposition: 'no-request',
    reason:
      'Printed in the contact-address checker\'s error text, telling an operator where to confirm a Google Group exists before adding it to PROVISIONED_CONTACT_ADDRESSES — an unprovisioned @aglyn.com address accepts mail and suppresses the bounce (AGL-1577), so it cannot be verified by sending to it. The operator opens the URL themselves; no code path fetches it.',
    dataReceived: 'Nothing. It is a sentence in a diagnostic.',
  },
  'console.developers.google.com': {
    disposition: 'no-request',
    reason:
      'Printed in the legal-drift checker\'s error text, telling an operator where to enable the Drive API when the call is refused.',
    dataReceived: 'Nothing. It is a sentence in a diagnostic.',
  },
  'dashboard.stripe.com': {
    disposition: 'no-request',
    reason:
      'A staff deep link from the email-health admin screen, pointing at the Stripe dashboard for the same account.',
    dataReceived:
      'Nothing from us. A staff member who clicks it authenticates to Stripe themselves.',
  },
  'linear.app': {
    disposition: 'no-request',
    reason:
      'Issue-URL construction in the release-notes tooling, so a changelog line links to its issue. The API host is the separate `api.linear.app` entry, which IS a subprocessor.',
    dataReceived: 'Nothing. The URL is written into a changelog.',
  },
  // MARK – GitHub
  //
  // `api.github.com` arrived with AGL-2537, when Main Gate's red reporter
  // stopped deduplicating against a Linear issue and started writing a commit
  // status instead. It is CI tooling reaching the forge that already holds the
  // repository, not a path any customer record travels.

  'api.github.com': {
    disposition: 'not-a-subprocessor',
    reason:
      "Main Gate's red reporter reads and writes a commit status on this repository, keyed on the graded sha, so the same red is not announced twice. It runs only inside GitHub Actions, against the repository GitHub already hosts, with the workflow's own GITHUB_TOKEN. No product code path reaches it and no Service request can trigger it.",
    dataReceived:
      'A commit sha from this repository, a status context naming the failing gate jobs, and a link to the Actions run. No personal data and no customer data exist on that path to send.',
  },
  'github.com': {
    disposition: 'no-request',
    reason:
      'A form placeholder on the plugin publish form, the seller panel\'s repository link, the docs site footer, and the release tooling\'s tag URLs.',
    dataReceived:
      'Nothing from us. A publisher who types their own repository URL is choosing where their readers go.',
  },
  'x.com': {
    disposition: 'no-request',
    reason:
      'Social-profile link construction in the marketplace seller panel, from a handle the seller entered.',
    dataReceived: 'Nothing. A link is rendered.',
  },
  'twitter.com': {
    disposition: 'no-request',
    reason:
      'Share-link construction in the collection block, built from the page URL.',
    dataReceived: 'Nothing until a visitor clicks, at which point they are the one visiting.',
  },
  'linkedin.com': {
    disposition: 'no-request',
    reason:
      'Social-profile link construction in the marketplace seller panel.',
    dataReceived: 'Nothing. A link is rendered.',
  },
  'www.linkedin.com': {
    disposition: 'no-request',
    reason: 'Share-link construction in the collection block.',
    dataReceived: 'Nothing until a visitor clicks.',
  },
  'www.facebook.com': {
    disposition: 'no-request',
    reason:
      'Share-link construction in the collection block. Distinct from `connect.facebook.net`, which is the pixel loader and IS declared as a subprocessor.',
    dataReceived: 'Nothing until a visitor clicks.',
  },
  'operator-ci.firebaseio.com': {
    disposition: 'no-request',
    reason:
      "A placeholder value in the self-host CI environment fixture — the database URL shape an operator's own project would have. The project does not exist.",
    dataReceived: 'Nothing. It is an example string in a fixture.',
  },
}

for (const host of SUPERVISORY_AUTHORITY_HOSTS) {
  EGRESS_HOSTS[host] = SUPERVISORY_AUTHORITY_ENTRY
}

/**
 * Recipients reached through an SDK that builds its own host, which the URL
 * sweep is structurally unable to find.
 *
 * Same idea as `THIRD_PARTY_COOKIES` in `cookie-inventory.ts`: where a scan of
 * our source cannot see the thing, pin a symbol that proves we still load it,
 * so at minimum a dropped integration loses its published row.
 */
export interface SdkEgress {
  /** A symbol that must still appear in the tree, proving we still reach it. */
  readonly token: string
  readonly entity: string
  readonly reason: string
  readonly dataReceived: string
  readonly publishedOn: string
}

export const SDK_EGRESS: Record<string, SdkEgress> = {
  /**
   * ⚑ The second under-disclosed finding. Realtime Database is a DIFFERENT
   * Google product from Firestore, with its own storage, its own rules file
   * (`cloud/firebase-database.rules.json`) and its own retention behaviour,
   * and its host comes from `databaseURL` in client config — so no literal for
   * it exists anywhere in `apps/` or `libs/` and the sweep above will never
   * name it. Presence writes who is editing what, live, from every console
   * session. The published entry covers the entity; it does not name this
   * product, and a reader asking "where does my editing activity go" cannot
   * find out from the page.
   */
  'Firebase Realtime Database (presence)': {
    token: 'getDatabase',
    entity: 'Google LLC (Firebase / Google Cloud)',
    reason:
      'Live co-editing presence in `apps/console/hooks/use-presence.ts`. Its host is assembled from client config, so the URL sweep cannot see it.',
    dataReceived:
      'Which account is viewing or editing which screen, component or layout, with a display name and a connection heartbeat, for as long as the tab is open.',
    publishedOn: '2026-08-05',
  },
  /**
   * The browser half of the payments integration. `api.stripe.com` above is
   * ours calling Stripe; this is Stripe's own script running in the payer's
   * browser, which is why the card number never reaches our servers at all.
   */
  'Stripe.js (browser)': {
    token: 'loadStripe',
    entity: 'Stripe, Inc.',
    reason:
      "Stripe's own elements, loaded into the console checkout and every storefront that takes payment.",
    dataReceived:
      'Card details, typed directly into fields Stripe serves, plus the device signals Stripe uses for fraud prevention.',
    publishedOn: '2026-08-05',
  },
  /**
   * App Check's attestation traffic is browser-side and reaches Google's
   * reCAPTCHA endpoints under a host the provider chooses. The admin API we
   * call ourselves is the separate `recaptchaenterprise.googleapis.com` entry.
   */
  'reCAPTCHA Enterprise (App Check)': {
    token: 'ReCaptchaEnterpriseProvider',
    entity: 'Google LLC (Firebase / Google Cloud)',
    reason:
      'Firebase App Check attestation, run in the browser on every console and storefront session.',
    dataReceived:
      'The device and behavioural signals reCAPTCHA collects to score the session as human, tied to the site key rather than to an account.',
    publishedOn: '2026-08-05',
  },
}

/** A row as `/legal/subprocessors` has to carry it. */
export interface PublishedRow {
  readonly entity: string
  readonly purpose: string
  readonly region: string
  readonly publishedOn: string
  /** Every declared host and SDK folded into this entity's row. */
  readonly reaches: readonly string[]
}

/**
 * The row set the published table must carry, derived from the registry.
 *
 * This is what makes the registry the source rather than a second opinion.
 * Grouped by entity because the page is a table of entities, not of hosts —
 * one Google row covers many endpoints, and the endpoints are what the "data
 * processed" cell has to be written from.
 *
 * Comparing this to the live page is still a human step: the page is besigner
 * content, no check in this repo can read it, and pretending otherwise is the
 * exact failure mode `check:legal-drift` already documents about itself. What
 * this removes is the part that was actually hard — knowing what the page
 * ought to say.
 */
export function derivePublishedRows(): PublishedRow[] {
  const rows = new Map<string, PublishedRow & { reaches: string[] }>()
  const add = (
    entity: string,
    purpose: string,
    region: string,
    publishedOn: string,
    reach: string,
  ) => {
    const existing = rows.get(entity)
    if (existing) {
      existing.reaches.push(reach)
      return
    }
    rows.set(entity, { entity, purpose, region, publishedOn, reaches: [reach] })
  }

  for (const [host, entry] of Object.entries(EGRESS_HOSTS)) {
    if (entry.disposition !== 'subprocessor') continue
    add(
      String(entry.entity),
      String(entry.purpose),
      String(entry.region),
      String(entry.publishedOn),
      host,
    )
  }
  for (const [name, entry] of Object.entries(SDK_EGRESS)) {
    const row = rows.get(entry.entity)
    if (row) {
      row.reaches.push(name)
      continue
    }
    // An SDK-only recipient still owes a row; it just has no host to group
    // under, so the purpose has to be written on the page by hand.
    add(entry.entity, '(SDK-only recipient)', '(see page)', entry.publishedOn, name)
  }

  return [...rows.values()]
    .map((row) => ({ ...row, reaches: [...row.reaches].sort() }))
    .sort((a, b) => a.entity.localeCompare(b.entity))
}
