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
export * from './child-contract'
export * from './child-contract-compose'
export * from './console-routes'
export * from './contacts'
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
export * from './deployment-shape'
export * from './platform-brand'
export * from './plan-entitlements'
export * from './form-abuse-ceiling'
export * from './health-report'
export * from './support-tiers'
export * from './release-flags'
// Who runs THIS deployment, and where its notices go (AGL-2016). Ordered
// before the four surfaces that print it, all of which used to declare their
// own `support@aglyn.com` literal.
export * from './operator-identity'
export * from './lockdown'
export * from './media-quarantine'
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
export * from './api-plugins'
export * from './plugin-api-rate-limit'
export * from './actions'
export * from './element-ui'
export * from './media-folders'
export * from './media-metadata'
export * from './media-ref'
export * from './author-css'
export * from './dataset-models'
export * from './marketplace-merge'
export * from './marketplace-provenance'
export * from './marketplace-update-state'
export * from './dataset-query'
export * from './plugin-bundle-checks'
export * from './plugin-manifest'
export * from './safe-json-ld'
export * from './request-geo'
export * from './search-indexing'
export * from './seo-title'
export * from './visitor-consent'
export * from './social-image'
export * from './scope-tokens'
export * from './org-billing-doc'
