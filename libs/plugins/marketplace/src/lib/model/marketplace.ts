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
 * Marketplace marketplace v1 (AGL-44): shared types + the server-side
 * sanitization pass that gates publishing a host component definition as a
 * public listing. Pure data module — safe to import from API routes.
 */

// The leaf module, not a barrel: this model is reached from both the browser
// and API routes, and `@aglyn/aglyn` carries `createContext` (illegal in a
// Server Component) while `@aglyn/aglyn/server` carries `node:fs` (illegal in
// the browser). Neither is safe from here; the deep path has no dependencies.
import { isFirstPartyMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import type { MarketplaceArtifactType } from '@aglyn/aglyn/app-utils/marketplace-provenance'
import type { ListingVerificationRequest } from '@aglyn/aglyn/app-utils/marketplace-verification'
// Visibility lives in core (AGL-876), for the same reason the artifact-type
// union and the verification policy do: the console's listing route asks the
// question and `scope:app` may not depend on `aglyn:addons`. Imported AND
// re-exported — `installTargetsFor` and `listingArtifactLabel` below call
// `listingArtifactType` locally, and a bare `export … from` binds nothing.
// The write-deny classification (AGL-1361) rides along for the same reason:
// it is a statement about the fields this policy reads, and the guard that
// enforces it lives in core beside the rules parser.
import {
  isListingBrowsable,
  isListingDeleted,
  isPrivateListing,
  LISTING_CLIENT_WRITABLE_FIELDS,
  LISTING_UNPERSISTED_FIELDS,
  listingArtifactType,
} from '@aglyn/aglyn/app-utils/marketplace-listing-visibility'

export {
  isListingBrowsable,
  isListingDeleted,
  isPrivateListing,
  LISTING_CLIENT_WRITABLE_FIELDS,
  LISTING_UNPERSISTED_FIELDS,
  listingArtifactType,
}

/**
 * `profiles/{uid}` — a person's public identity.
 *
 * NOT a publisher identity as of AGL-652: publishing is org-only, and the
 * marketplace presence lives on `publisherProfiles/{orgId}` below. This doc
 * survives because it is also the support forum's author identity, which
 * renders poster names from `displayName`.
 */
export interface MarketplaceProfile {
  handle: string
  displayName: string
  bio?: string
  avatarUrl?: string
}

/**
 * `publisherProfiles/{orgId}` — an organization's marketplace presence
 * (AGL-652). Publishing is org-only: an org publishes, an org gets paid, and
 * the org is who buyers see. Keyed by org id so authorization is a plain org
 * role check with no ownership indirection.
 *
 * `stripeAccountId` / `stripeChargesEnabled` are written only by the Connect
 * route via the Admin SDK and are frozen from client writes by the rules —
 * they decide who receives money.
 */
export interface MarketplacePublisherProfile {
  /** Unique marketplace handle; reserved in `publisherHandles/{handle}`. */
  handle: string
  displayName: string
  bio?: string
  avatarUrl?: string
  website?: string
  /** Server-only. */
  stripeAccountId?: string
  /** Server-only; true once Connect onboarding can accept charges. */
  stripeChargesEnabled?: boolean
}

/**
 * `publisherHandles/{handle}` — uniqueness reservation for publisher handles,
 * mirroring `orgSlugs` (AGL-652). Without it two publishers could claim the
 * same handle, which the marketplace URL space cannot represent. `movedTo`
 * tombstones a renamed handle so old links can still resolve.
 */
export interface PublisherHandleReservation {
  orgId: string
  movedTo?: string
}

/**
 * Publisher handles share the org-slug shape: 3–30 chars, lowercase
 * alphanumeric plus internal hyphens. Single source of truth — the two
 * marketplace pages historically applied two subtly different regexes to the
 * same field (AGL-653).
 */
export const PUBLISHER_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

export function isValidPublisherHandle(handle: string): boolean {
  return PUBLISHER_HANDLE_PATTERN.test(handle)
}

/**
 * `marketplaceListings/{listingId}` — public component listing. Version
 * snapshots live in the `versions/{n}` subcollection; installs copy a pinned
 * version into `hosts/{hostId}/components` so the existing drawer/graft
 * pipeline applies unchanged.
 */
export interface MarketplaceListing {
  profileId: string
  displayName: string
  description?: string
  category?: string
  /**
   * What this listing publishes (AGL-654). One discriminator for every
   * artifact type — the previous scheme split across two orthogonal fields
   * (`type: 'component'|'plugin'` plus a separate `kind: 'template'`), so a
   * template was "kind template with no type" and each installer branched on
   * whichever field it happened to care about. That does not survive adding
   * layouts, dataset schemas and email templates.
   *
   * Read it through `listingArtifactType()`, never directly — listings
   * written before this field still carry only the legacy pair.
   */
  artifactType?: MarketplaceArtifactType
  /** @deprecated Legacy discriminator; use `artifactType` (AGL-654). */
  type?: 'component' | 'plugin'
  /** @deprecated Legacy discriminator; use `artifactType` (AGL-654). */
  kind?: 'template'
  latestVersion: number | string
  /** Plugin manifest id, for `type: 'plugin'` listings (AGL-45). */
  pluginId?: string
  /** One-time price in whole USD; 0/absent = free (AGL-46). */
  priceUsd?: number
  deletedAt?: unknown
  // Listing content (AGL-430, Strapi Market parity) — publisher-authored,
  // rendered on the marketplace detail page. All optional; validated by
  // validateListingContent on the API path and SANITIZED at render time
  // (the doc is publisher-writable, so renderers never trust it).
  logoUrl?: string
  screenshots?: string[]
  /** Markdown documentation shown on the listing page (no raw HTML). */
  readme?: string
  homepageUrl?: string
  repositoryUrl?: string
  /** SPDX-ish license label, e.g. "MIT". */
  license?: string
  categories?: string[]
  /**
   * Marketplace review lifecycle (AGL-432). Absent = legacy listing,
   * treated as 'listed'. New plugin listings start 'submitted'; staff move
   * them through the queue. Only 'listed'/'verified' (or legacy) plugin
   * listings appear in browse for non-owners.
   */
  reviewStatus?: ListingReviewStatus
  /**
   * The publisher's standing ask for the Verified badge (AGL-1217).
   *
   * Its own field, never a `reviewStatus` member — see
   * {@link ListingVerificationRequest}. Server-owned: the publisher route only
   * moves it to `pending`/`withdrawn`, and only staff can decide it. Asking
   * never grants anything; the checklist gate on `verify` stays the one route
   * to the badge.
   */
  verificationRequest?: ListingVerificationRequest
  // Server-managed. These were written by the publish/install/review paths
  // but never declared, so callers reached for `as any` (AGL-654).
  /** Publishing org id — the publisher profile's doc id (AGL-652). */
  publisherOrgId?: string
  /** Source component for a `component` listing. */
  sourceComponentId?: string
  /** Source site for a `template` listing. */
  sourceHostId?: string
  /** Incremented by the install API; frozen from client writes. */
  installCount?: number
  /**
   * How many installs are LIVE right now — `installCount`'s sibling, and
   * undeclared here until AGL-1420 went looking for it.
   *
   * That omission was the whole bug. AGL-1361's coverage guard builds the
   * listing's field universe from this interface, the rules deny-list and the
   * resolvers, so a server-owned field in none of the three is not classified
   * as exposed — it is INVISIBLE to the guard, which is a worse failure than
   * being classified wrongly. `installCount` was denied and this was not, so
   * the sibling counter a publisher-org owner/admin could write was the one
   * the browse grid and the listing header print to buyers.
   *
   * Written by the install/uninstall routes and by AGL-1419's derivation.
   */
  activeInstalls?: number
  /**
   * AGL-1419's derived-count cache: the pin count as last verified, the wall
   * clock it was verified at, and the per-version split.
   *
   * Server-owned for a stronger reason than the counters themselves. They are
   * not merely a number that could be wrong — `verifiedLivePins` treats the
   * triple as FRESH when `pinnedActiveInstalls === activeInstalls` and the
   * timestamp is inside the TTL, and then returns `pinnedVersionInstalls`
   * without querying anything. A client that could write all four could pin
   * the cache open on numbers it chose and suppress the re-derivation that
   * exists to bring a count back down.
   */
  pinnedActiveInstalls?: number
  pinsVerifiedAtMs?: number
  pinnedVersionInstalls?: Record<string, number>
  previewImageUrl?: string
  screenCount?: number
  versionHistory?: Array<{ version: number | string; publishedAt?: unknown }>
  createdAt?: unknown
  updatedAt?: unknown
  /** Staff review audit (AGL-432); server-owned (AGL-651). */
  reviewedBy?: string
  reviewedAt?: unknown
  rejectionReason?: string
}

/**
 * Everything an org can publish to the marketplace (AGL-654).
 *
 * Defined in core and re-exported here (AGL-1016): the console needs it to
 * render update state for installed artifacts, and an app may not depend on an
 * addon lib. Publishing code keeps importing it from this model unchanged.
 */
export type { MarketplaceArtifactType }

/**
 * Human-readable label for each artifact type (AGL-864).
 *
 * Shared by browse cards, the listing detail page, and the seller panel so
 * "what kind of thing is this" reads the same everywhere. Resolve a listing's
 * label through {@link listingArtifactLabel}, which tolerates the legacy
 * `type`/`kind` shape the way {@link listingArtifactType} does.
 */
export const ARTIFACT_TYPE_LABELS: Record<MarketplaceArtifactType, string> = {
  plugin: 'Plugin',
  component: 'Component',
  template: 'Site template',
  layout: 'Layout',
  datasetSchema: 'Dataset schema',
  emailTemplate: 'Email template',
  theme: 'Theme',
}

/** The friendly artifact-type label for a listing (AGL-864). */
export function listingArtifactLabel(listing: {
  artifactType?: string
  type?: string
  kind?: string
}): string {
  return ARTIFACT_TYPE_LABELS[listingArtifactType(listing)] ?? 'Component'
}

/** Where an installed artifact lives. */
export type InstallTarget = 'org' | 'host'

/**
 * Install targets each artifact type actually supports (AGL-656).
 *
 * This is not a policy choice — it is where the install routes physically
 * write. Only plugins have an org-scoped pin
 * (`orgs/{orgId}/installs/{listingId}`, applying to every site, shadowed by
 * a host pin). Components land in `hosts/{h}/components`, templates and
 * layouts in `hosts/{h}/templates`: all host-scoped by nature, because a
 * screen tree belongs to a site.
 *
 * Exported so the UI can ask rather than assume — an install picker that
 * offers "this whole organization" for a template would be lying.
 */
export const INSTALL_TARGETS: Record<
  MarketplaceArtifactType,
  readonly InstallTarget[]
> = {
  plugin: ['org', 'host'],
  component: ['host'],
  template: ['host'],
  layout: ['host'],
  // Dataset schemas are org-shared data (AGL-237), so they install at org
  // scope — as a new empty dataset, not a pin (AGL-657).
  datasetSchema: ['org'],
  emailTemplate: ['host'],
  // A theme is one site's visual identity, written to `hosts/{h}.theme`
  // (AGL-1020). Applying one org-wide would repaint every site at once from a
  // control that says "install".
  theme: ['host'],
}

/** Targets a listing can be installed to, defaulting to host-only. */
export function installTargetsFor(listing: {
  artifactType?: string
  type?: string
  kind?: string
}): readonly InstallTarget[] {
  return INSTALL_TARGETS[listingArtifactType(listing)] ?? ['host']
}

/** A plugin install pin — the version-pinned doc the install API writes. */
export interface InstallPin {
  version?: number | string
}

/**
 * The install state of a plugin listing for one site, told honestly (AGL-656).
 *
 * A plugin can be pinned at two scopes: the org pin
 * (`orgs/{orgId}/installs/{listingId}`) applies to every site, and a host pin
 * (`hosts/{hostId}/installs/{listingId}`) applies to just this one AND shadows
 * the org pin. Detecting installs from `hosts/{h}/components` — the COMPONENT
 * collection — never sees either pin, so an installed plugin used to read as
 * "not installed" on both the browse grid and the detail page. This resolves
 * the effective state from the two pins the way the loader does.
 */
export interface PluginInstallState {
  /** Effective pin scope for this site — host wins over org — or null. */
  scope: InstallTarget | null
  /** Version pinned at the effective scope, or null when not installed. */
  installedVersion: string | null
  /** Both pins exist: the host pin takes precedence, shadowing the org one. */
  shadowed: boolean
  /** Installed, but the pinned version is behind the listing's latest. */
  updateAvailable: boolean
}

/**
 * Resolves a plugin listing's install state for a site from its two pins
 * (AGL-656). The host pin shadows the org pin, mirroring the loader, so the
 * effective version and update prompt always describe what actually runs here.
 */
export function resolvePluginInstallState(
  latestVersion: number | string | undefined,
  hostPin: InstallPin | null | undefined,
  orgPin: InstallPin | null | undefined,
): PluginInstallState {
  const effective = hostPin ?? orgPin ?? null
  const installedVersion =
    effective?.version != null ? String(effective.version) : null
  return {
    scope: hostPin ? 'host' : orgPin ? 'org' : null,
    installedVersion,
    shadowed: Boolean(hostPin && orgPin),
    // Any difference is an upgrade prompt, matching the installed-plugins card
    // — pins only ever move forward, so "different" means "behind".
    updateAvailable:
      installedVersion != null &&
      latestVersion != null &&
      String(latestVersion) !== installedVersion,
  }
}

/** One site's slice of an org-scope install picture (AGL-997). */
export interface OrgInstallSite {
  hostId: string
  label: string
  /** The version that actually runs here, from the effective pin. */
  version: string | null
  /** Where that pin lives — a host pin shadows the org one, as the loader does. */
  pinnedBy: InstallTarget
  /** This site has its OWN pin on top of an org pin. */
  shadowed: boolean
}

/**
 * The whole org's install picture for one listing (AGL-997).
 *
 * At org scope, "installed" is a SET, not a boolean. The detail page used to
 * resolve state against the single acting host, so a plugin installed on one
 * of five sites reported "Installed on this site" — describing one arbitrary
 * site and staying silent about the other four — and offered an Uninstall
 * that was all-or-nothing.
 *
 * `orgWide` and per-site pins are not exclusive: an org pin covers every
 * site including ones created later, and a host pin on top of it shadows it
 * for that one site. Both facts have to survive into the UI, which is why
 * this returns the sites AND the pins rather than a single scope.
 */
export interface OrgInstallSummary {
  /** An org pin exists: every site is covered, including future ones. */
  orgWide: boolean
  /** Version of the org pin, when there is one. */
  orgVersion: string | null
  /** Every site the listing effectively runs on. */
  sites: OrgInstallSite[]
  /** Sites carrying their own removable host pin. */
  hostPinnedIds: string[]
  /** Sites with no pin of their own and no org pin covering them. */
  availableHostIds: string[]
  installedAnywhere: boolean
}

export function resolveOrgInstallSummary(
  hosts: ReadonlyArray<{ id: string; label: string }>,
  hostPins: Readonly<Record<string, InstallPin | null | undefined>>,
  orgPin: InstallPin | null | undefined,
): OrgInstallSummary {
  const orgWide = Boolean(orgPin)
  const orgVersion = orgPin?.version != null ? String(orgPin.version) : null
  const sites: OrgInstallSite[] = []
  const hostPinnedIds: string[] = []
  const availableHostIds: string[] = []
  for (const host of hosts) {
    const hostPin = hostPins[host.id]
    if (hostPin) hostPinnedIds.push(host.id)
    if (!hostPin && !orgPin) {
      availableHostIds.push(host.id)
      continue
    }
    sites.push({
      hostId: host.id,
      label: host.label,
      version:
        hostPin?.version != null ? String(hostPin.version) : orgVersion,
      pinnedBy: hostPin ? 'host' : 'org',
      shadowed: Boolean(hostPin && orgPin),
    })
  }
  return {
    orgWide,
    orgVersion,
    sites,
    hostPinnedIds,
    availableHostIds,
    installedAnywhere: orgWide || hostPinnedIds.length > 0,
  }
}

/** One site an uninstall would touch, and whether it really loses the plugin. */
export interface UninstallTarget {
  hostId: string
  label: string
  /**
   * The plugin keeps running here. Removing a HOST pin while an org pin still
   * covers the site, or the ORG pin while the site holds its own host pin,
   * changes which pointer is in use and nothing a visitor can see.
   */
  stillCovered: boolean
}

/**
 * Which sites an uninstall actually affects (AGL-1027).
 *
 * The shadowing case is the whole reason this is a function rather than a
 * filter at the call site. A pin is not a boolean per site: an org pin covers
 * everything, a host pin names one site, and where both exist the host pin
 * wins. So "remove" means three different things depending on which pointer is
 * being dropped and what is left underneath — and the one thing the dialog must
 * never do is tell someone a plugin will stop working when it will not.
 *
 * Returns every site the operation touches, including the ones that keep the
 * plugin, so the dialog can say so explicitly instead of omitting them and
 * leaving the count unexplained.
 */
export function resolveUninstallTargets(
  orgInstall: OrgInstallSummary,
  scope: 'org' | 'host',
  hostId?: string,
): UninstallTarget[] {
  if (scope === 'host') {
    const site = orgInstall.sites.find((entry) => entry.hostId === hostId)
    if (!site) return []
    // Its own pin goes; the org pin, if there is one, still covers it.
    return [
      { hostId: site.hostId, label: site.label, stillCovered: orgInstall.orgWide },
    ]
  }
  // Dropping the org pin: every site loses it EXCEPT those holding a host pin
  // of their own, which were already shadowing the org pin anyway.
  return orgInstall.sites.map((site) => ({
    hostId: site.hostId,
    label: site.label,
    stillCovered: site.pinnedBy === 'host',
  }))
}

/** How the admin chose to target an install from the org marketplace. */
export type InstallTargeting = 'all-sites' | 'selected-sites'

/** One concrete install operation: an org pin, or a pin on a named host. */
export interface InstallPlanStep {
  scope: InstallTarget
  /** Present iff `scope === 'host'`. */
  hostId?: string
}

/**
 * Turns a targeting choice into the concrete install operations for a listing
 * (AGL-773), honoring what each artifact type physically supports (see
 * {@link INSTALL_TARGETS}).
 *
 * The rules aren't uniform, and the picker must not promise what an artifact
 * can't do:
 * - **Org-pinnable** (plugin, datasetSchema) + "all sites" → a SINGLE org pin,
 *   which also covers sites created later.
 * - **Host-scoped** (component, template, layout, emailTemplate) has no org
 *   pin, so "all sites" fans out to every CURRENT host — new sites are NOT
 *   covered automatically. The UI has to say so.
 * - "Selected sites" is always host pins, even for an org-pinnable artifact:
 *   the admin named specific sites, so honor that literally — UNLESS the
 *   artifact can't host-pin at all (datasetSchema), where the per-site choice
 *   is meaningless and collapses to the org pin.
 */
export function resolveInstallPlan(
  listing: { artifactType?: string; type?: string; kind?: string },
  targeting: InstallTargeting,
  hosts: {
    selectedHostIds: readonly string[]
    allHostIds: readonly string[]
  },
): InstallPlanStep[] {
  const targets = installTargetsFor(listing)
  const canOrgPin = targets.includes('org')
  const canHostPin = targets.includes('host')
  if (targeting === 'all-sites') {
    if (canOrgPin) return [{ scope: 'org' }]
    return hosts.allHostIds.map((hostId) => ({ scope: 'host', hostId }))
  }
  // selected-sites
  if (!canHostPin) return [{ scope: 'org' }]
  return hosts.selectedHostIds.map((hostId) => ({ scope: 'host', hostId }))
}

export type ListingReviewStatus =
  | 'submitted'
  | 'in_review'
  | 'listed'
  | 'verified'
  | 'rejected'

/**
 * Verification requests live in core (AGL-1217), for the same reason
 * `MarketplaceArtifactType` does (AGL-1016): the console's staff review route
 * needs the policy, and `scope:app` may not depend on `aglyn:addons`.
 * Re-exported here so publishing code keeps one import site.
 */
export {
  VERIFICATION_BLOCK_MESSAGES,
  VERIFICATION_DECLINE_COOLDOWN_DAYS,
  timestampMs,
  verificationRequestBlock,
} from '@aglyn/aglyn/app-utils/marketplace-verification'
export type {
  ListingVerificationRequest,
  TimestampLike,
  VerifiableListing,
  VerificationRequestBlock,
  VerificationRequestState,
} from '@aglyn/aglyn/app-utils/marketplace-verification'


/**
 * Per-VERSION review state (AGL-966).
 *
 * Approval is a statement about specific bytes, so it lives on the version
 * doc beside the verifier verdict and the review checklist — both already
 * keyed to sha256. It used to live on the listing, which meant a publisher
 * could get v1.0.0 verified and then ship v1.0.1 containing anything: the
 * listing kept its status, the queue never surfaced the update, and
 * installs resolved `latestVersion`.
 */
export type PluginVersionReviewState = 'pending' | 'approved' | 'rejected'

export interface ReviewableVersion {
  version?: string
  reviewState?: string
  publishedAt?: { toMillis?: () => number } | null
}

/** Only approved bytes may be installed. Absent state is NOT approval. */
export function isVersionApproved(
  version: { reviewState?: string } | null | undefined,
): boolean {
  return version?.reviewState === 'approved'
}

/**
 * Whether an install would hand the viewer UNREVIEWED bytes (AGL-1083).
 *
 * `install-plugin` deliberately lets a publisher install their own
 * unapproved version — you cannot test a version you cannot install, and
 * the AGL-969 checklist asks them to confirm they tested these exact bytes
 * on a site they control. The route reaches that case through
 * `newestApprovedVersion(...) ?? fallback`, where the fallback is
 * `latestVersion` and applies ONLY when the caller owns the listing and no
 * approved version exists at all.
 *
 * Lives here rather than in the listing component because the UI has to
 * describe exactly what the route will do. Two independent readings of
 * "would this be unreviewed?" is how the affordance ends up warning about
 * the wrong installs, or staying silent on the right ones.
 */
export function installsUnreviewedFallback(
  listing:
    | {
        profileId?: string
        latestVersion?: string | number
        latestApprovedVersion?: string | number
      }
    | null
    | undefined,
  viewerOrgId: string | null | undefined,
): boolean {
  if (!listing?.profileId || !viewerOrgId) return false
  // Only the publishing org gets the fallback; everyone else is refused.
  if (listing.profileId !== viewerOrgId) return false
  // An approved version exists → the route serves THAT, however much newer
  // the pending one is. Not an unreviewed install.
  if (String(listing.latestApprovedVersion ?? '')) return false
  return Boolean(String(listing.latestVersion ?? ''))
}

/**
 * The version a fresh install should pin: newest APPROVED, never
 * `latestVersion`. A pending update is simply not offered, so publishing
 * cannot ship code past review, and the previously approved version keeps
 * installing while the new one waits.
 */
export function newestApprovedVersion<T extends ReviewableVersion>(
  versions: readonly T[],
): T | null {
  const approved = versions.filter((entry) => isVersionApproved(entry))
  if (!approved.length) return null
  return approved.reduce((best, entry) =>
    (entry.publishedAt?.toMillis?.() ?? 0) >
    (best.publishedAt?.toMillis?.() ?? 0)
      ? entry
      : best,
  )
}

/**
 * What a listing is still missing before it can face the marketplace
 * (AGL-968/994).
 *
 * A private plugin is allowed to be undocumented — its only audience already
 * knows what it is and why it exists. A public one is not: description,
 * README and license are what a stranger deciding whether to run your code
 * has to go on, and they are exactly the fields the review checklist asks
 * about. So going public is gated on the METADATA, never on a re-review —
 * approval is a statement about bytes, and the bytes did not change.
 *
 * Returns the human field names, so the caller can say what to fix rather
 * than just refusing.
 */
export function missingPublicListingContent(listing: {
  description?: string
  readme?: string
  license?: string
}): string[] {
  const missing: string[] = []
  if (!listing.description?.trim()) missing.push('a description')
  if (!listing.readme?.trim()) missing.push('a README')
  if (!listing.license?.trim()) missing.push('a license')
  return missing
}

/** Fixed category taxonomy for marketplace listings (AGL-430). */
export const LISTING_CATEGORIES: readonly string[] = [
  'analytics',
  'automation',
  'commerce',
  'communication',
  'content',
  'design',
  'forms',
  'integrations',
  'marketing',
  'productivity',
  'seo',
  'security',
] as const

export const LISTING_README_MAX_CHARS = 20_000
export const LISTING_MAX_SCREENSHOTS = 6

const HTTPS_URL = /^https:\/\/[^\s]+$/

/**
 * The message every listing IMAGE field returns when it is refused. Names the
 * remedy, because "must be an https URL" was true of the value the publisher
 * just typed and told them nothing.
 */
export const LISTING_IMAGE_ERROR =
  'must be an image from your media library — paste a link and the people ' +
  'browsing your listing would be loading it from a server you control'

/** Length cap shared by every listing URL field. */
const LISTING_URL_MAX_CHARS = 500

/**
 * Whether a listing image field is one we will store (AGL-1701).
 *
 * Listing artwork is the one publisher-supplied value that OTHER orgs' users
 * load. It is also, established while fixing this, gated by nothing: review
 * is a statement about a version's bytes (AGL-966), the staff review route
 * never projects `logoUrl`/`screenshots` so a reviewer cannot see them even
 * if the checklist asked, and `update-listing` writes them at any time
 * without touching `reviewStatus` — so a listing can pass review with benign
 * artwork and swap it afterwards while still reading `verified`.
 *
 * Constraining the INPUT rather than sanitizing the output is the whole
 * point: the render sites are three components and an `og:image`, and the
 * next one added would not know to sanitize.
 */
function isListingImageValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= LISTING_URL_MAX_CHARS &&
    isFirstPartyMediaSrc(value)
  )
}

/**
 * Validates publisher-editable listing content (AGL-430). Returns the
 * normalized subset to persist, or an error. Shared by publish and the
 * update-listing action so both paths accept exactly the same shapes.
 *
 * IMAGE fields and LINK fields are validated differently (AGL-1701).
 * `homepageUrl` and `repositoryUrl` stay any-https: they are anchors a reader
 * chooses to follow, and a publisher's homepage living on the publisher's
 * domain is the entire point of the field. `logoUrl` and `screenshots` are
 * `<img src>`, which fetches with no such choice, so those are held to
 * first-party media.
 */
export function validateListingContent(input: Record<string, unknown>): {
  ok: boolean
  error?: string
  content?: Partial<MarketplaceListing>
} {
  const content: Partial<MarketplaceListing> = {}
  for (const key of ['homepageUrl', 'repositoryUrl'] as const) {
    const value = input[key]
    if (value === undefined || value === '') continue
    if (
      typeof value !== 'string' ||
      !HTTPS_URL.test(value) ||
      value.length > LISTING_URL_MAX_CHARS
    ) {
      return { ok: false, error: `${key} must be an https URL` }
    }
    content[key] = value
  }
  const logoUrl = input['logoUrl']
  if (logoUrl !== undefined && logoUrl !== '') {
    if (!isListingImageValue(logoUrl)) {
      return { ok: false, error: `logoUrl ${LISTING_IMAGE_ERROR}` }
    }
    content.logoUrl = logoUrl
  }
  const screenshots = input['screenshots']
  if (screenshots !== undefined) {
    if (
      !Array.isArray(screenshots) ||
      screenshots.length > LISTING_MAX_SCREENSHOTS ||
      screenshots.some((url) => !isListingImageValue(url))
    ) {
      return {
        ok: false,
        error:
          `screenshots must be up to ${LISTING_MAX_SCREENSHOTS} images, and ` +
          `each ${LISTING_IMAGE_ERROR}`,
      }
    }
    content.screenshots = screenshots as string[]
  }
  const readme = input['readme']
  if (readme !== undefined) {
    if (typeof readme !== 'string' || readme.length > LISTING_README_MAX_CHARS) {
      return {
        ok: false,
        error: `readme must be markdown up to ${LISTING_README_MAX_CHARS} chars`,
      }
    }
    if (readme.trim()) content.readme = readme
  }
  const license = input['license']
  if (license !== undefined && license !== '') {
    if (typeof license !== 'string' || license.length > 40) {
      return { ok: false, error: 'license must be a short label (max 40)' }
    }
    content.license = license
  }
  const categories = input['categories']
  if (categories !== undefined) {
    if (
      !Array.isArray(categories) ||
      categories.length > 3 ||
      categories.some((entry) => !LISTING_CATEGORIES.includes(String(entry)))
    ) {
      return {
        ok: false,
        error: 'categories must be up to 3 entries from the fixed taxonomy',
      }
    }
    content.categories = categories.map(String)
  }
  return { ok: true, content }
}

/**
 * Publisher-profile fields beyond the identity trio (AGL-1009): the logo,
 * the support contact, and a FIXED set of external links. Fixed on purpose —
 * the storefront renders each as a known icon, and a free-form list would
 * turn the trust panel into a link farm.
 */
export interface PublisherProfileContent {
  avatarUrl?: string
  website?: string
  supportEmail?: string
  supportUrl?: string
  githubUrl?: string
  xUrl?: string
  linkedinUrl?: string
}

/** Social keys whose URL must live on the network's own host. */
const PUBLISHER_SOCIAL_HOSTS: Record<string, readonly string[]> = {
  githubUrl: ['github.com'],
  xUrl: ['x.com', 'twitter.com'],
  linkedinUrl: ['linkedin.com'],
}

const SUPPORT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validates the publisher-profile extras (AGL-1009), sharing
 * `validateListingContent`'s URL discipline: https only, length capped,
 * validated on the save route (server-owned like the handle — no client
 * write path carries these). An explicit empty string comes back as `''` so
 * the save route can distinguish "clear this field" from "left untouched".
 */
export function validatePublisherProfileContent(
  input: Record<string, unknown>,
): { ok: boolean; error?: string; content?: PublisherProfileContent } {
  const content: PublisherProfileContent = {}
  const urlKeys = [
    'avatarUrl',
    'website',
    'supportUrl',
    'githubUrl',
    'xUrl',
    'linkedinUrl',
  ] as const
  for (const key of urlKeys) {
    const value = input[key]
    if (value === undefined) continue
    if (value === '') {
      content[key] = ''
      continue
    }
    // The same https-or-nothing rule as listing URLs: `javascript:`, `data:`
    // and plain http all fail the one test.
    if (typeof value !== 'string' || !HTTPS_URL.test(value) || value.length > 500) {
      return { ok: false, error: `${key} must be an https URL` }
    }
    const hosts = PUBLISHER_SOCIAL_HOSTS[key]
    if (hosts) {
      let host = ''
      try {
        host = new URL(value).hostname.toLowerCase()
      } catch {
        return { ok: false, error: `${key} must be an https URL` }
      }
      if (!hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
        return { ok: false, error: `${key} must link to ${hosts[0]}` }
      }
    }
    content[key] = value
  }
  const supportEmail = input['supportEmail']
  if (supportEmail !== undefined) {
    if (supportEmail === '') {
      content.supportEmail = ''
    } else if (
      typeof supportEmail !== 'string' ||
      supportEmail.length > 200 ||
      !SUPPORT_EMAIL.test(supportEmail)
    ) {
      return { ok: false, error: 'supportEmail must be an email address' }
    } else {
      content.supportEmail = supportEmail
    }
  }
  return { ok: true, content }
}

/**
 * Render-time guard for publisher links (AGL-1009): only an `https://` URL
 * is ever emitted as an href. The save route already refuses anything else,
 * but the doc is client-updatable on its cosmetic fields historically, so
 * the renderer must not trust stored data it did not write.
 */
export function safePublisherHref(url: unknown): string | undefined {
  return typeof url === 'string' && /^https:\/\//i.test(url) && url.length <= 500
    ? url
    : undefined
}

/**
 * Platform revenue share on paid listings (AGL-46) — UI COPY ONLY. The
 * checkout route prices from the `marketplaceFeePct` ENTITLEMENT
 * (`resolveMarketplaceFeePct`, AGL-1543), which resolves the effective
 * plan and per-org overrides; these constants exist for seller-facing
 * copy and must be kept in step with the plan table.
 */
export const MARKETPLACE_PLATFORM_FEE_PERCENT = 20
/** Free-plan publishers pay a higher share. See AGL-1543 note above. */
export const MARKETPLACE_PLATFORM_FEE_PERCENT_FREE_PLAN = 30
/** One-time listing price ceiling (whole USD). */
export const MARKETPLACE_MAX_PRICE_USD = 1000

/**
 * Component ids publishable to the marketplace. Mirrors the persisted ids in
 * plugins-mui (plugin.spec.ts) minus `reusableInstance` — nested
 * instances would smuggle references to another tenant's private
 * definitions — and minus `layoutSlot`, which is layout chrome. Keep sorted.
 *
 * The rule this list encodes is "inert and self-contained": an element that
 * renders from its own props travels to another workspace intact. What stays
 * out is what cannot — raw-HTML escape hatches (`customHtml`), references to
 * another tenant's documents (`reusableInstance`), third-party code
 * (`plugin`), host chrome (`layoutSlot`) and anything bound to the source
 * site's data (`collection`, `product`).
 *
 * It must cover everything the besigner's palette offers under those terms, or
 * the catalogue promises what the exporter refuses — which is how `section`
 * came to be missing (AGL-1033): every Sections & Blocks preset composes it,
 * so the whole category was unpublishable. `blocks-publishable.spec.ts` walks
 * the presets and fails if this list falls behind them again.
 */
export const MARKETPLACE_COMPONENT_ID_ALLOWLIST: readonly string[] = [
  'form',
  'formField',
  'image',
  'muiAppBar',
  'muiButton',
  'muiContainer',
  'muiList',
  'muiListItem',
  'muiListItemText',
  'muiScreenLink',
  'muiStack',
  'muiToolbar',
  'muiTypography',
  'searchBox',
  // A semantic wrapper — `<section>`/`<footer>`/`<nav>` plus styling, with no
  // behaviour and no binding to the site it came from.
  'section',
  'socialLinks',
  'videoEmbed',
]

/**
 * Email block ids publishable as an `emailTemplate` (AGL-657).
 *
 * A separate list from the page allowlist because the two vocabularies don't
 * overlap — an email design is built entirely from `plugins-email` blocks, and
 * page components (MUI, forms, video) don't survive an email client anyway.
 *
 * `emailHtml` is excluded deliberately, for the same reason `reusableInstance`
 * is excluded above: it is a raw-HTML escape hatch, and a published template
 * lands in another org's OUTGOING CUSTOMER EMAIL. Email clients don't run
 * scripts, so this isn't XSS — it's that arbitrary markup sent from someone
 * else's domain is a phishing and tracking-pixel vector that no amount of
 * render-time sanitization makes reviewable. Keep sorted.
 */
export const MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST: readonly string[] = [
  'emailButton',
  'emailDivider',
  'emailImage',
  'emailProduct',
  'emailRichtext',
  'emailSection',
  'emailSpacer',
  'emailText',
]

/** Serialized definition size cap (Firestore doc limit is 1 MiB). */
export const MARKETPLACE_DEFINITION_MAX_BYTES = 200 * 1024

const KEPT_NODE_KEYS = [
  '$id',
  'componentId',
  'pluginId',
  'parentId',
  'props',
  'nodes',
] as const

/** Only navigable protocols — mirrors ScreenLink/Image/Button hardening. */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i
/**
 * `src` additionally allows inline images, which are inert.
 *
 * `https:` only, unlike {@link SAFE_HREF} (AGL-1701). An `http:` href is a
 * link a reader chooses to follow and their browser will warn about; an
 * `http:` image is fetched automatically, and on the authenticated console —
 * or on any tenant page we serve over TLS — it is mixed content, which every
 * current browser blocks outright. So the permissive form bought a published
 * node nothing: the image did not render either way, it just failed at the
 * viewer instead of at publish time.
 */
const SAFE_SRC = /^(https:\/\/|data:image\/|\/|#)/i

/**
 * Strips props a published node must never carry into someone else's site
 * (AGL-784).
 *
 * `Leaf` spreads a node's props straight onto the rendered component, and MUI
 * passes unknown props through to its root DOM element, so whatever survives
 * publishing reaches the DOM of every org that installs the listing. Marketplace
 * components are auto-listed with no review, and `hosts/{h}/components` is
 * writable by any org member, so a hand-crafted doc is a realistic input here.
 *
 * What each stripped key actually does, measured rather than assumed:
 * - `dangerouslySetInnerHTML` is NOT the stored-XSS it looks like — `Leaf`
 *   always passes a children array, so React throws
 *   "Can only set one of `children` or `props.dangerouslySetInnerHTML`"
 *   (and the void-element variant for self-closing components like `image`).
 *   That is worse in practice than it sounds: the throw happens during SSR,
 *   which is the AGL-579 failure mode that 500s the page and wedges ISR for
 *   the whole site. One published component would take down every consumer.
 * - `on*` handlers can only survive JSON as strings, which React drops with a
 *   warning. Removed for hygiene, and so a future renderer that does eval-ish
 *   prop handling can't turn them back into a vector.
 * - `href`/`src` get the render-time URL policy applied at publish time too.
 *   React already neutralizes `javascript:` hrefs and the mui components run
 *   SAFE_HREF themselves, so this is defense in depth for any component that
 *   forgets to — cheap, and it keeps the stored artifact honest.
 *
 * Deliberately shallow: only top-level props are spread onto the DOM. A nested
 * object (`icon: { path }`) is consumed by the component, never spread, so
 * recursing would strip legitimate data for no security gain.
 */
function sanitizePublishedNodeProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dangerouslySetInnerHTML') continue
    if (/^on[A-Z]/.test(key)) continue
    if ((key === 'href' || key === 'src') && typeof value === 'string') {
      const trimmed = value.trim()
      const pattern = key === 'href' ? SAFE_HREF : SAFE_SRC
      if (!pattern.test(trimmed)) continue
      safe[key] = trimmed
      continue
    }
    safe[key] = value
  }
  return safe
}

/**
 * `nodes` that is still in one of its STORAGE forms rather than a node map
 * (AGL-1395).
 *
 * The two forms `decodeStoredNodes` knows about, tested structurally so this
 * stays a model function with no server import: a byte view — what
 * firebase-admin hands back for a `Bytes` field — and the `{type, data}`
 * envelope `JSON.stringify` makes of a Node `Buffer`, which is what a
 * site-export bundle carries. Neither is a map, and neither is anything the
 * publisher did.
 *
 * The envelope test is deliberately exact, for the reason `decodeStoredNodes`
 * spells out: the alternative reading is a node map with nodes called `type`
 * and `data`, which cannot exist because node-map values are objects.
 */
function isUndecodedNodes(nodes: unknown): boolean {
  if (ArrayBuffer.isView(nodes)) return true
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) {
    return false
  }
  const value = nodes as { type?: unknown; data?: unknown }
  return (
    value.type === 'Buffer' &&
    Array.isArray(value.data) &&
    Object.keys(value).length === 2
  )
}

export type MarketplaceDefinitionNodes = Record<
  string,
  {
    $id: string
    componentId: string
    pluginId?: string
    parentId: string | null
    props?: Record<string, unknown>
    nodes?: string[]
  }
>

/**
 * Validates and strips a host component definition for publishing:
 * - only allowlisted component ids (no reusable instances, no layout chrome)
 * - only the persisted node keys (drops runtime fields like resolvedProps)
 * - the subtree reachable from `rootId` only, and a serialized size cap
 *
 * - per-node prop hardening (see `sanitizePublishedNodeProps`, AGL-784)
 *
 * XSS note: rich-text `html` props stay as-authored here — they are sanitized
 * at render time (sanitize-rich-text allowlist), which also covers definitions
 * written to Firestore directly (see docs/SECURITY_CONTENT_REVIEW.md). Props
 * that are spread onto the DOM (`dangerouslySetInnerHTML`, `on*`, `href`,
 * `src`) are hardened HERE as well, because publishing hands them to a
 * different org's render tree.
 */
export function sanitizeMarketplaceDefinition(
  definition: {
    rootId: string
    nodes: Record<string, any>
  },
  options?: {
    /**
     * Additional component ids permitted for this artifact type.
     *
     * `layoutSlot` is excluded from the shared allowlist because a slot in
     * page content has nowhere to graft — but a published LAYOUT is
     * meaningless without one (AGL-671). Scoped per call rather than added
     * globally so page and component publishing stay unchanged.
     */
    extraComponentIds?: readonly string[]
    /**
     * Replaces the page allowlist outright, for artifact types built from a
     * disjoint component vocabulary — an email design uses `plugins-email`
     * blocks and nothing else (AGL-657), so EXTENDING the page list would
     * green-light a `videoEmbed` or `form` that no email client can render.
     */
    componentIds?: readonly string[]
  },
):
  | { ok: true; rootId: string; nodes: MarketplaceDefinitionNodes }
  | { ok: false; error: string } {
  const { rootId, nodes } = definition
  const base = options?.componentIds ?? MARKETPLACE_COMPONENT_ID_ALLOWLIST
  const allowed = options?.extraComponentIds?.length
    ? [...base, ...options.extraComponentIds]
    : base
  // An UNDECODED `nodes` is never the author's fault, so it must not share a
  // message with a genuinely rootless definition (AGL-1395). Both undecoded
  // forms — a Node `Buffer` from the Admin SDK, and the `{type:'Buffer'}`
  // envelope `JSON.stringify` makes of one — reach the root check below as
  // something with no `_@_` in it, and the answer was "Definition has no root
  // node": a sentence that sends the publisher to redesign a page that is
  // fine. Callers must run `decodeStoredNodes` first; this says so out loud
  // rather than letting the next raw read look like a content problem.
  if (isUndecodedNodes(nodes)) {
    return {
      ok: false,
      error:
        'This content could not be read — it is stored compressed and was ' +
        'not decoded before publishing. That is a bug on our side, not a ' +
        'problem with your design.',
    }
  }
  if (!rootId || !nodes?.[rootId]) {
    return { ok: false, error: 'Definition has no root node' }
  }
  const sanitized: MarketplaceDefinitionNodes = {}
  /** Set while walking; see the empty-definition check after the loop. */
  let rootIsWrapper = false
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift() as string
    if (sanitized[id]) continue
    const node = nodes[id]
    if (!node) return { ok: false, error: `Missing node "${id}"` }
    // The root node is the virtual root-collection wrapper (canvas
    // `NODE_ROOT_ID` = `_@_`): it declares "everything inside <body>" for
    // drag/drop mapping, not a rendered component, so a `div`/absent
    // componentId there is structural — not a real component to allowlist
    // (AGL-783). Exempt ONLY that wrapper shape; a root carrying a real
    // component id is still checked, so a disallowed component can't be
    // smuggled in as the root. Every descendant is real content and always
    // checked below.
    const isRootWrapper =
      id === rootId &&
      (node.componentId == null ||
        node.componentId === '' ||
        node.componentId === 'div')
    if (!isRootWrapper && !allowed.includes(node.componentId)) {
      return {
        ok: false,
        // Says why, not just no (AGL-1033). The bare id was doubly unhelpful:
        // it is not what the palette calls the element, and it left the author
        // guessing whether this was a bug or a rule.
        error:
          `Component "${node.componentId}" cannot be published — a listing may ` +
          'only contain self-contained presentational elements. Raw HTML, ' +
          'reusable-component references, plugin elements and anything bound ' +
          "to this site's data or layout stay behind.",
      }
    }
    const plain: any = {}
    for (const key of KEPT_NODE_KEYS) {
      if (node[key] !== undefined) plain[key] = node[key]
    }
    // Per-node prop hardening (AGL-784) — see sanitizePublishedNodeProps.
    if (plain.props && typeof plain.props === 'object') {
      plain.props = sanitizePublishedNodeProps(plain.props)
    }
    plain.$id = id
    plain.parentId = id === rootId ? null : (node.parentId ?? null)
    // Give the wrapper an explicit container id so the installed definition
    // renders its root collection the same way it did on the source site.
    if (isRootWrapper) {
      plain.componentId = 'div'
      rootIsWrapper = true
    }
    sanitized[id] = plain
    if (Array.isArray(node.nodes)) queue.push(...node.nodes)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(sanitized)
  } catch {
    return { ok: false, error: 'Definition is not serializable' }
  }
  if (serialized.length > MARKETPLACE_DEFINITION_MAX_BYTES) {
    return { ok: false, error: 'Definition is too large to publish' }
  }
  // An empty definition is not a listing (AGL-1033). Publishing one used to
  // SUCCEED — the root wrapper alone sanitizes cleanly — so a component whose
  // content had never been published to its document shipped a blank version
  // to everyone who installed it, and said nothing. Refusing here is the
  // "fail loudly at the point the author understands it" half.
  //
  // Only the WRAPPER case: a definition that is a single real component is a
  // perfectly good one-element listing, and refusing that would be a different
  // bug in the other direction.
  if (rootIsWrapper && Object.keys(sanitized).length <= 1) {
    return {
      ok: false,
      error:
        'There is nothing to publish — this is empty. If you have edited it ' +
        'in the designer, publish those changes first, then publish the listing.',
    }
  }
  return { ok: true, rootId, nodes: sanitized }
}

/**
 * Converts a sanitized marketplace/AI definition (normalized map) into the
 * nested node shape `canvas.addNodeFromPreset` grafts — ids regenerate on
 * insert, so collisions with existing canvas nodes are impossible
 * (AGL-169). A seen-set guards malformed self-referencing trees.
 */
export function marketplaceDefinitionToNested(
  rootId: string,
  nodes: MarketplaceDefinitionNodes,
): Record<string, unknown> | null {
  const seen = new Set<string>()
  const build = (id: string): Record<string, unknown> | null => {
    const node = nodes[id]
    if (!node || seen.has(id)) return null
    seen.add(id)
    return {
      componentId: node.componentId,
      ...(node.pluginId ? { pluginId: node.pluginId } : {}),
      ...(node.props ? { props: node.props } : {}),
      nodes: (node.nodes ?? [])
        .map(build)
        .filter((child): child is Record<string, unknown> => Boolean(child)),
    }
  }
  return build(rootId)
}

/**
 * Field types a published dataset schema may declare (AGL-657). Mirrors
 * `DATASET_FIELD_TYPES` in core; duplicated rather than imported to keep this
 * module dependency-free (it is imported by API routes and client components
 * alike), and asserted against the source of truth in the spec.
 */
export const MARKETPLACE_DATASET_FIELD_TYPES: readonly string[] = [
  'bool',
  'bytes',
  'coordinates',
  'float',
  'int32',
  'int64',
  'map',
  'nil',
  'reference',
  'sorted',
  'text',
  'timestamp',
]

/** Field cap on a published schema — mirrors the console's create limit. */
export const MARKETPLACE_DATASET_MAX_FIELDS = 100

/** A published dataset schema: the model, with no records. */
export interface MarketplaceDatasetSchema {
  fields: Record<string, MarketplaceDatasetField>
  order: string[]
}

export interface MarketplaceDatasetField {
  name: string
  type: string
  customType?: string
  description?: string
  required?: boolean
  default?: unknown
  validation?: Record<string, unknown>
  /**
   * Kept so an install into an org that HAS the referenced dataset can relink
   * it. `datasetId` is the publisher's id and is meaningless in another org,
   * so `datasetLabel` carries the human name the installer matches on.
   */
  reference?: {
    datasetId?: string
    datasetLabel?: string
    displayFieldId?: string
    multiple?: boolean
    onDelete?: string
  }
}

const KEPT_VALIDATION_KEYS = ['required', 'regex', 'min', 'max', 'options']

/**
 * Validates and strips a `DatasetModel` for publishing as a marketplace
 * dataset schema (AGL-657).
 *
 * Publishes STRUCTURE ONLY — records never travel. That is the whole safety
 * story for this artifact type: a dataset's rows are the org's customer data,
 * so the publish path reads the model and nothing else, and there is no code
 * path here that can reach the `records` subcollection.
 *
 * Two cross-org hazards the issue called out, handled by carrying enough
 * context for the INSTALLER to decide rather than by rejecting at publish:
 * - `reference` FKs point at a dataset id that only exists in the publisher's
 *   org. The id is kept alongside the referenced dataset's label so the
 *   installer can relink by name and degrade the field when it can't (see
 *   `resolveInstalledDatasetSchema`).
 * - `customType` names a plugin-declared field type (AGL-434) whose plugin the
 *   installing org may not have. Unknown custom types already degrade to their
 *   base type at render, so the name rides along untouched.
 */
export function sanitizeDatasetSchema(model: {
  fields?: Record<string, any>
  order?: unknown
}):
  | { ok: true; schema: MarketplaceDatasetSchema }
  | { ok: false; error: string } {
  const fields = model?.fields
  if (!fields || typeof fields !== 'object') {
    return { ok: false, error: 'Dataset has no field model to publish' }
  }
  // Order is the display contract; fall back to key order for models written
  // before `order` was required so older datasets stay publishable.
  const order = Array.isArray(model.order)
    ? model.order.map(String)
    : Object.keys(fields)
  const kept = order.filter((id) => fields[id])
  if (!kept.length) {
    return { ok: false, error: 'Dataset has no fields to publish' }
  }
  if (kept.length > MARKETPLACE_DATASET_MAX_FIELDS) {
    return {
      ok: false,
      error: `Dataset schemas are limited to ${MARKETPLACE_DATASET_MAX_FIELDS} fields`,
    }
  }
  const schema: MarketplaceDatasetSchema = { fields: {}, order: kept }
  for (const id of kept) {
    const field = fields[id] ?? {}
    const type = String(field.type ?? 'text')
    if (!MARKETPLACE_DATASET_FIELD_TYPES.includes(type)) {
      return { ok: false, error: `Field "${id}" has an unsupported type` }
    }
    const safe: MarketplaceDatasetField = {
      name: String(field.name ?? id).slice(0, 120),
      type,
    }
    if (field.customType) safe.customType = String(field.customType).slice(0, 60)
    if (field.description) {
      safe.description = String(field.description).slice(0, 500)
    }
    if (field.required === true) safe.required = true
    // Defaults are publisher-authored values, not data — keep only primitives
    // so a default can't smuggle a nested object into the installing org.
    if (
      field.default !== undefined &&
      (typeof field.default === 'string' ||
        typeof field.default === 'number' ||
        typeof field.default === 'boolean')
    ) {
      safe.default = field.default
    }
    if (field.validation && typeof field.validation === 'object') {
      const validation: Record<string, unknown> = {}
      for (const key of KEPT_VALIDATION_KEYS) {
        if (field.validation[key] !== undefined) {
          validation[key] = field.validation[key]
        }
      }
      if (Object.keys(validation).length) safe.validation = validation
    }
    if (field.reference && typeof field.reference === 'object') {
      safe.reference = {
        ...(field.reference.datasetId && {
          datasetId: String(field.reference.datasetId),
        }),
        ...(field.reference.datasetLabel && {
          datasetLabel: String(field.reference.datasetLabel).slice(0, 120),
        }),
        ...(field.reference.displayFieldId && {
          displayFieldId: String(field.reference.displayFieldId),
        }),
        ...(field.reference.multiple === true && { multiple: true }),
        ...(field.reference.onDelete && {
          onDelete: String(field.reference.onDelete),
        }),
      }
    }
    schema.fields[id] = safe
  }
  const serialized = JSON.stringify(schema)
  if (serialized.length > MARKETPLACE_DEFINITION_MAX_BYTES) {
    return { ok: false, error: 'Dataset schema is too large to publish' }
  }
  return { ok: true, schema }
}

/**
 * Rewrites a published schema for the installing org (AGL-657).
 *
 * `reference` fields are the only part of a schema that can't cross an org
 * boundary as-is: they name a dataset id in the PUBLISHER's org. Relink by the
 * referenced dataset's label when the installing org has one by that name;
 * otherwise degrade the field to plain `text` and report it, because a
 * reference field pointing at a dataset that doesn't exist renders as a broken
 * picker — silently keeping the dead id would install something visibly
 * broken and blame the installer for it.
 *
 * `existingDatasets` maps lowercased display name → dataset id in the target.
 */
export function resolveInstalledDatasetSchema(
  schema: MarketplaceDatasetSchema,
  existingDatasets: Readonly<Record<string, string>>,
): { schema: MarketplaceDatasetSchema; degradedFieldIds: string[] } {
  const degradedFieldIds: string[] = []
  const fields: Record<string, MarketplaceDatasetField> = {}
  for (const id of schema.order) {
    const field = schema.fields[id]
    if (!field) continue
    if (field.type !== 'reference' && !field.reference) {
      fields[id] = field
      continue
    }
    const label = String(field.reference?.datasetLabel ?? '').toLowerCase()
    const relinked = label ? existingDatasets[label] : undefined
    if (relinked) {
      fields[id] = {
        ...field,
        reference: { ...field.reference, datasetId: relinked },
      }
      continue
    }
    const { reference: _dropped, ...rest } = field
    fields[id] = { ...rest, type: 'text' }
    degradedFieldIds.push(id)
  }
  return { schema: { fields, order: schema.order }, degradedFieldIds }
}

/** One row of the listing detail's `What's included` checklist. */
export interface ListingInclusion {
  label: string
  /** Whether the row is a positive inclusion or a stated limit. */
  tone: 'included' | 'note'
}

/** What each artifact type drops into the org when it installs. */
const ARTIFACT_INSTALL_RESULT: Record<MarketplaceArtifactType, string> = {
  plugin: 'A plugin, sandboxed on its own origin with a per-plugin CSP',
  component: 'An editable component you can place on any screen',
  template: 'Editable screens you can rework in Besigner',
  layout: 'An editable layout you can apply to any screen',
  datasetSchema: 'A new empty dataset with its fields already defined',
  emailTemplate: 'An editable email design you can send campaigns from',
  theme: 'A theme applied to the site you choose',
}

/**
 * The `WHAT'S INCLUDED` checklist the marketplace listing mockup shows
 * (AGL-2173), derived entirely from facts the listing already carries.
 *
 * The mockup's own bullets — `12 responsive screens`, `Blog & work
 * layouts` — are publisher-authored prose, and nothing collects them:
 * there is no content manifest on a listing or a version, so counting
 * screens would mean inventing a number. What IS knowable is what the
 * install physically does, where it lands, whether it has been reviewed,
 * and under what licence — which is the question a shopper is asking when
 * they read that box.
 *
 * Ordered decision-first: what you get, then where it goes, then the two
 * facts that most often stop an install.
 */
export function listingInclusions(
  listing: {
    artifactType?: string
    type?: string
    kind?: string
    license?: string
    priceUsd?: number
    reviewStatus?: string
  },
  options: { reviewedVersion?: boolean } = {},
): ListingInclusion[] {
  const type = listingArtifactType(listing)
  const rows: ListingInclusion[] = [
    { label: ARTIFACT_INSTALL_RESULT[type] ?? 'An installable artifact', tone: 'included' },
  ]
  const targets = installTargetsFor(listing)
  rows.push({
    label: targets.includes('org')
      ? 'Installs org-wide, covering sites you add later'
      : 'Installs per site — new sites are not covered automatically',
    // The host-only case is a real limit and the picker already has to say
    // so; softening it here would put the caveat only where nobody reads.
    tone: targets.includes('org') ? 'included' : 'note',
  })
  if (options.reviewedVersion) {
    rows.push({
      label: 'This version passed marketplace review',
      tone: 'included',
    })
  }
  if (listing.license) {
    rows.push({ label: `Licensed ${listing.license}`, tone: 'included' })
  }
  rows.push({
    label: Number(listing.priceUsd ?? 0) > 0
      ? 'A one-time purchase — updates to this listing are included'
      : 'Free, including every future update',
    tone: 'included',
  })
  return rows
}

/**
 * WHO STILL OWNS WHAT THEY BOUGHT — the one predicate (AGL-2158).
 *
 * `hasLivePurchase` (server/purchase-entitlement.ts) is the gate on all eight
 * ways into paid content, and it reads exactly one field: a purchase with
 * `refundedAt` — stamped by the `charge.refunded` and lost-`charge.dispute`
 * doors of the marketplace billing webhook — no longer entitles.
 *
 * The listing page carried its OWN copy of that question,
 * `some(p => p.listingId === listingId)`, with no refund test at all. The two
 * then disagreed on the one buyer they must not disagree on: the refunded
 * one. The page showed "Purchased", hid the buy button, and the install
 * routes answered 402 — a buyer who could neither install nor re-purchase.
 *
 * It lives HERE, in the model, rather than in the server module, because the
 * server module is the wrong side of the client/server boundary for a React
 * component and copying four characters of predicate is precisely how the two
 * came apart. This module is context-free by construction (see the header) —
 * importable from a client component, an API route and another plugin alike.
 */
export interface PurchaseLiveness {
  /** Stamped when a full refund or a lost dispute un-buys the listing. */
  refundedAt?: unknown
  listingId?: unknown
}

/**
 * True when this purchase document still entitles.
 *
 * Deliberately a truthiness test and not `!= null`: `refundedAt` is a
 * Firestore Timestamp on the server, a client Timestamp in the browser and a
 * sentinel in the webhook's own tests, and every one of those is truthy while
 * a missing field (every purchase written before AGL-1546) is not.
 */
export function isLivePurchase(
  purchase: PurchaseLiveness | null | undefined,
): boolean {
  return Boolean(purchase) && !purchase?.refundedAt
}

/**
 * True when this buyer's purchase documents include a live one for `listingId`.
 *
 * Both callers pass everything they read — the server's query is already
 * narrowed to the listing, the client's is narrowed only to the buyer — so the
 * listing filter belongs inside the shared predicate too, not beside it.
 */
export function hasLivePurchaseOf(
  purchases: readonly (PurchaseLiveness | null | undefined)[] | null | undefined,
  listingId: string,
): boolean {
  if (!listingId) return false
  return (purchases ?? []).some(
    (purchase) =>
      purchase?.listingId === listingId && isLivePurchase(purchase),
  )
}
