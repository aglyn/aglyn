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

/**
 * Server-safe app-utils: every app-util EXCEPT the client-only React
 * contexts (see ./contexts). Nothing here calls `createContext` at module
 * scope, so this barrel — re-exported by `@aglyn/aglyn/server` — is safe to
 * import from tenant Server Components (AGL-405). The full `./index` barrel
 * re-adds the contexts for client consumers.
 */
export * from './binding-token-catalog'
export * from './binding-tokens'
export * from './collection-delete'
export * from './collection-entries'
export * from './collection-kind'
export * from './collection-slug'
export * from './content-authors'
export * from './child-contract'
export * from './child-contract-compose'
export * from './console-routes'
// What a stored screen-link value means, with no React attached — the
// where-used scan reads these on the server (AGL-703).
export * from './screen-link-value'
export * from './analytics-path-key'
export * from './contacts'
// The consent JOIN (`docs/specs/email-overhaul.md` §3f). Pure, and it composes
// `contacts` for the normalizer, so it sits directly beside it. No Node
// builtin, which is what keeps it out of the `/server`-only group `person-key`
// belongs to.
export * from './consent-groups'
export * from './marketing-consent'
// The ENROLLMENT-time half of the same question, beside its reader for the
// same reason: `marketing-consent` decides whether a recorded basis lets us
// mail somebody, and this decides what basis putting them on a list may
// record. Two enrollment surfaces import it — the Inbox assignment route and
// the Emails console's audience card — and neither could import the other.
export * from './list-assignment-policy'
// Reading the FILE a merchant arrives with (`docs/specs/email-competitive-gaps.md`
// G5/P4), directly after the policy it hands its addresses to: parsing and
// mechanical screening only, so that an import asks the enrollment question
// through the same module the one-address add path asks it through rather
// than answering it a second way.
export * from './list-import'
// The dynamic-list rule (§3b/§3c), beside it for the same reasons: pure, and
// it composes `contacts` for the segment vocabulary rather than restating it.
export * from './dynamic-list-rule'
// The subscribable streams a recipient can leave one at a time
// (`docs/specs/email-competitive-gaps.md` §1f). Pure, and read from all three
// sides of the feature: the composer picks one, the send path signs it into
// the unsubscribe link, and the unauthenticated preference page renders the
// catalog. No Node builtin, so it stays out of the `/server`-only group.
export * from './email-topics'
export * from './compose-layout-nodes'
export * from './functions'
export * from './compose-reusable-components'
export * from './compress'
export * from './merge-node-sx'
export * from './palette-sx'
export * from './scheme-sx'
export * from './create-resource-uid'
export * from './decompress'
export * from './stored-nodes'
export * from './strip-undefined'
export * from './organizations'
export * from './org-permissions'
export * from './password-policy'
export * from './idp-profile'
export * from './onboarding-deep-link'
// Where an account came from (AGL-1731). Beside the plan intent because
// they are the same hop — the marketing CTA's query string — and both are
// remembered on `users/{uid}` across the verification wall.
export * from './campaign-attribution'
export * from './deployment-shape'
// Which browser origins may complete a signed direct-to-GCS upload (AGL-1452).
// GCS matches the origin list EXACTLY, so every serving console name needs its
// own entry — the rule nobody could be expected to remember at attach time.
export * from './upload-cors'
// The docs-help subset the first-party plugin consoles read (AGL-2213) — the
// console's own registry lives in apps/console/constants and a lib cannot
// import an app.
export * from './docs-help'
export * from './platform-brand'
export * from './plan-entitlements'
// The free plan's bandwidth hard cap (AGL-1967/2070/2155). After
// `plan-entitlements`, which owns the predicate it keys off.
export * from './bandwidth-cap'
export * from './form-abuse-ceiling'
export * from './forms'
// What a form's DESIGN must still satisfy for its submissions to arrive.
// After `forms`, whose field walk it reads the drawn fields with.
export * from './form-contract'
export * from './visitor-record-ceiling'
export * from './health-report'
// Did a webhook delivery actually DO anything (AGL-1954)? After
// `health-report`, whose billing verdict consumes the counts this produces.
export * from './webhook-delivery'
export * from './support-tiers'
export * from './release-flags'
// Who runs THIS deployment, and where its notices go (AGL-2016). Ordered
// before the four surfaces that print it, all of which used to declare their
// own `support@aglyn.com` literal.
export * from './operator-identity'
export * from './lockdown'
export * from './media-quarantine'
export * from './media-takedown-reach'
export * from './upload-inspection'
export * from './abuse-report'
// The other three quarters of §512 (AGL-1983): the put-back procedure that
// answers a notice, and the strike ledger that conditions the safe harbour.
export * from './dmca-counter-notice'
export * from './repeat-infringer'
// `addBusinessDays` briefly existed TWICE — once here in './support-tiers'
// and once in './dmca-counter-notice' — and two `export *` made the name
// ambiguous, TS2308'ing this barrel and every tsconfig that reads it. The
// interleave was fixed twice in parallel: once by naming a winner here, and
// once by deleting the second definition so './dmca-counter-notice' imports
// this one. Only the deletion survives, so the disambiguating re-export that
// stood on this line is gone with it — `export *` is unambiguous again.
//
// The concern that argued for keeping two copies is worth answering rather
// than dropping: a later tweak to the SUPPORT SLA window must never silently
// move the §512(g)(2)(C) put-back deadline. It cannot. This function embeds
// no window — it is "add N business days", and N is the argument. The two
// windows live in their own constants (`SUPPORT_*` there,
// `COUNTER_NOTICE_*_BUSINESS_DAYS` in the DMCA module) and never meet. What
// SHOULD stay shared is the day arithmetic itself: two copies of a weekend
// rule are two chances to disagree about which day a deadline falls on.
export * from './org-override-reason'
export * from './host-tokens'
export * from './variables'
export * from './workflows'
export * from './datasets'
export * from './expand-repeatables'
export * from './org-roles'
export * from './markdown-lite'
export * from './notifications'
export * from './definition-canvas-tree'
export * from './ensure-canvas-root'
export * from './detect-template-placeholders'
export * from './guarded-version-save'
export * from './local-storage-budget'
export * from './measure-node-map'
export * from './resolve-named-tokens'
export * from './screen-route'
export * from './host-naming'
export * from './marketplace-verification'
export * from './name-search'
export * from './name-match'
export * from './api-plugins'
export * from './plugin-api-rate-limit'
// The same-origin gate on visitor-facing plugin writes (AGL-1880). After
// `plugin-api-rate-limit`, whose `isMachinePluginApiPath` it reuses so the
// two gates exempt exactly the same machine surfaces.
export * from './plugin-api-cross-origin'
export * from './actions'
export * from './element-animation'
export * from './attribution-guard'
export * from './node-interactions'
export * from './element-ui'
export * from './image-upload-types'
export * from './sanitize-svg'
export * from './media-folders'
export * from './media-metadata'
export * from './media-ref'
export * from './author-css'
// The isomorphic HTML rule (AGL-1901), after the CSS one it depends on.
export * from './author-html'
export * from './dataset-models'
// The record-view descriptors, after the model and formatter they build on.
export * from './dataset-record-view'
export * from './dataset-csv'
export * from './marketplace-merge'
export * from './marketplace-provenance'
export * from './marketplace-update-state'
export * from './dataset-query'
export * from './plugin-manifest'
// After `plugin-manifest`, whose revocation predicates it asks the kill
// question with, and after `media-ref`, whose grammar decides what counts as a
// first-party image.
export * from './email-starter-policy'
export * from './safe-json-ld'
export * from './request-geo'
export * from './request-ip'
export * from './search-indexing'
export * from './seo-title'
export * from './visitor-consent'
export * from './social-image'
export * from './scope-tokens'
export * from './org-billing-doc'
export * from './stripe-deployment-mode'
export * from './deferred-image'
