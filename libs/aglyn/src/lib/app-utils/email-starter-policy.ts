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
 * What a marketplace email starter may contain, and whether one may still be
 * mailed.
 *
 * In core rather than beside the rest of the marketplace model for the reason
 * `marketplace-provenance` and `marketplace-verification` give: three
 * different projects have to ask these questions and a `scope:app` project may
 * not depend on an `aglyn:addons` lib. The marketplace plugin enforces the
 * policy when content is published and installed; the marketing plugin asks
 * the kill question on the send path; the console renders the assurance.
 * Three readings of "is this template safe to mail" is the failure mode this
 * module exists to prevent.
 *
 * ## Why an email design needs a policy the page allowlist does not supply
 *
 * A published page component is rendered by us, inside a document we serve,
 * behind our CSP. A published EMAIL design is rendered by the recipient's mail
 * client, out of our reach entirely, and it leaves on a sending domain whose
 * reputation every tenant shares. The two facts that follow are the whole
 * reason this file is stricter than `sanitizeMarketplaceDefinition`:
 *
 * - **A remote asset in an email is a read receipt.** The recipient's client
 *   fetches every `src` on open, so whatever host the string names learns that
 *   this person opened this message, at this time, from this IP. Naming a
 *   host the PUBLISHER controls hands a third party a recipient-level
 *   engagement feed on the tenant's audience — processing with no recorded
 *   basis and no `assertedBy` provenance, which is exactly what the consent
 *   architecture exists to make impossible. A 1×1 pixel is the deliberate form;
 *   an ordinary hero image is the same disclosure with a picture attached.
 * - **A link is sent under the tenant's name.** A recipient reads the From
 *   header, not the publisher's listing page.
 *
 * So `src` is held to first-party or inline, and `href` to a transport a
 * recipient's client will not silently downgrade. Violations are REFUSED
 * rather than stripped: `sanitizePublishedNodeProps` drops an unsafe URL and
 * publishes the rest, which is right for a page — a missing image is a
 * cosmetic defect — and wrong here, because the publisher whose tracker was
 * quietly removed learns nothing and tries again.
 */

import { isMediaCdnPath, isMediaRef, parseMediaRef } from './media-ref'
import { isListingWideRevocation, isPluginRevoked } from './plugin-manifest'
import type { PluginRevocation } from './plugin-manifest'
import { decodeStoredNodes } from './stored-nodes'

/** Props that carry a URL into a recipient's mail client. */
const URL_PROPS = ['src', 'href'] as const

/**
 * Props whose value is markup rather than text.
 *
 * `emailHtml` is already off `MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST`, so a
 * publish cannot mint one. This catches the same content arriving as a PROP on
 * a block that is on the list — a hand-written document, or a block that grows
 * an `html` prop later — which the component-id allowlist alone would pass.
 */
const MARKUP_PROPS = ['html', 'dangerouslySetInnerHTML'] as const

/** Merge-tag opener. Recipient data must never reach a URL (see below). */
const MERGE_TAG_OPEN = '{{'

/** Inline image data, which is inert and discloses nothing on open. */
const INLINE_IMAGE = /^data:image\//i

/** Link transports a recipient's client will not silently downgrade. */
const MAIL_SAFE_HREF = /^(https:\/\/|mailto:|\/|#)/i

export type EmailStarterViolationCode =
  /** A `src` naming a host that is not ours — the read-receipt vector. */
  | 'remote-asset'
  /** An `href` on a transport we will not send under a tenant's name. */
  | 'unsafe-link'
  /** Recipient data heading for a URL. */
  | 'merge-tag-in-url'
  /** Markup we would have to trust rather than render. */
  | 'raw-markup'
  /** The node map could not be read, so nothing about it is known. */
  | 'unreadable'

export interface EmailStarterViolation {
  code: EmailStarterViolationCode
  /** The offending node's id, or `'nodes'` when the map itself is the fault. */
  nodeId: string
  componentId: string
  /** The prop that carried it, for a message that can be acted on. */
  prop: string
  /** Truncated: a violation is reported to a publisher, and often logged. */
  value: string
}

export interface EmailStarterInspection {
  ok: boolean
  violations: EmailStarterViolation[]
  /**
   * Every host this design would send a recipient to, sorted and deduplicated.
   *
   * The inspectable half of the link policy. A tenant about to mail their
   * customers under their own From header is entitled to see the list of
   * domains a stranger's template points them at, and no allowlist can decide
   * that for them — a link to a legitimate retailer and a link to the
   * publisher's affiliate funnel are the same shape.
   */
  linkHosts: string[]
  /**
   * Media scopes belonging to somebody other than the installing site.
   *
   * Not a violation: the asset is served by our own CDN, so the publisher
   * learns nothing about the recipient, and refusing would make almost every
   * real template uninstallable. It is REPORTED because the reference stays
   * live after a copy-on-install — the publisher can still replace the bytes
   * behind it — which is the one way an installed design can change without
   * an update being taken.
   */
  foreignMediaScopes: string[]
  /** The decoded map, so a caller need not decode twice. Null when unreadable. */
  nodes: Record<string, unknown> | null
}

function truncate(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

/**
 * The host a link points at, or null for a same-origin or non-URL target.
 *
 * `URL` rather than a regex because the question is "which host will the mail
 * client resolve this to", and that is the parser's answer, not ours. A value
 * that will not parse is not reported as a host — it is already refused by the
 * transport check, and inventing a host for it would put a fiction on a screen
 * a tenant is using to make a decision.
 */
function linkHost(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null
  try {
    return new URL(value).host.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Whether a decoded value is a node MAP rather than something that merely
 * survived decoding.
 *
 * The case this exists for is the AGL-1394 shape: `nodes` read raw off a
 * screen version is a msgpack `Buffer`, and `Object.entries` of a Buffer
 * yields byte INDICES paired with NUMBERS. Every check below asks a node for a
 * `props` object, finds none, and the walk completes reporting a clean design.
 * A scanner that cannot read its input must say so, not pass it.
 *
 * `decodeStoredNodes` handles the three storage forms, so anything still
 * failing here was never a node map to begin with.
 */
function isNodeMap(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.values(value as Record<string, unknown>)
  if (!entries.length) return false
  return entries.every(
    (entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  )
}

/**
 * Reads a marketplace email design against the mail-client policy above.
 *
 * Takes `nodes` in whatever form the document stored it — a plain Firestore
 * map, compressed msgpack bytes, or the `{type:'Buffer'}` envelope an export
 * bundle carries — and decodes before walking, because a naive walk over the
 * compressed form finds nothing and reports the design clean.
 *
 * @param raw - the version document's `nodes` field, undecoded.
 * @param options - carries `hostId`, the site the design is being installed
 *   onto, used only to classify media scopes as local or foreign. Omitted at
 *   publish time, where there is no installing site yet.
 */
export function inspectEmailStarter(
  raw: unknown,
  options?: { hostId?: string | null },
): EmailStarterInspection {
  const decoded = decodeStoredNodes<Record<string, unknown>>(raw)
  if (!isNodeMap(decoded)) {
    return {
      ok: false,
      violations: [
        {
          code: 'unreadable',
          nodeId: 'nodes',
          componentId: '',
          prop: 'nodes',
          value: decoded === null ? 'undecodable' : 'not a node map',
        },
      ],
      linkHosts: [],
      foreignMediaScopes: [],
      nodes: null,
    }
  }

  const violations: EmailStarterViolation[] = []
  const hosts = new Set<string>()
  const foreignScopes = new Set<string>()

  for (const [nodeId, value] of Object.entries(decoded)) {
    const node = value as { componentId?: unknown; props?: unknown }
    const componentId = String(node.componentId ?? '')
    const props =
      node.props && typeof node.props === 'object' && !Array.isArray(node.props)
        ? (node.props as Record<string, unknown>)
        : {}

    for (const prop of MARKUP_PROPS) {
      if (props[prop] === undefined) continue
      violations.push({
        code: 'raw-markup',
        nodeId,
        componentId,
        prop,
        value: truncate(props[prop]),
      })
    }

    for (const prop of URL_PROPS) {
      const value = props[prop]
      if (typeof value !== 'string' || !value) continue

      // Checked before the transport rules, and reported as its own code,
      // because the two failures need different sentences: an `http:` link is
      // a mistake to correct, and a merge tag in a URL is recipient data on
      // its way into a query string — a standing prohibition, and the reason
      // it is prohibited is that a URL is logged by every hop that serves it.
      if (value.includes(MERGE_TAG_OPEN)) {
        violations.push({
          code: 'merge-tag-in-url',
          nodeId,
          componentId,
          prop,
          value: truncate(value),
        })
        continue
      }

      if (prop === 'src') {
        if (isMediaRef(value)) {
          const ref = parseMediaRef(value)
          if (!ref) {
            violations.push({
              code: 'remote-asset',
              nodeId,
              componentId,
              prop,
              value: truncate(value),
            })
            continue
          }
          if (options?.hostId && !ref.scope.split(':').includes(options.hostId)) {
            foreignScopes.add(ref.scope)
          }
          continue
        }
        if (isMediaCdnPath(value) || INLINE_IMAGE.test(value)) continue
        violations.push({
          code: 'remote-asset',
          nodeId,
          componentId,
          prop,
          value: truncate(value),
        })
        continue
      }

      const host = linkHost(value)
      if (host) hosts.add(host)
      if (!MAIL_SAFE_HREF.test(value)) {
        violations.push({
          code: 'unsafe-link',
          nodeId,
          componentId,
          prop,
          value: truncate(value),
        })
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    linkHosts: [...hosts].sort(),
    foreignMediaScopes: [...foreignScopes].sort(),
    nodes: decoded,
  }
}

/** One sentence per violation code, in the second person. */
const VIOLATION_COPY: Record<EmailStarterViolationCode, string> = {
  'remote-asset':
    'images must come from your own media library or be inline — an image ' +
    'loaded from another site tells that site who opened the email',
  'unsafe-link':
    'links must be https, mailto, or a path on the sending site',
  'merge-tag-in-url':
    'a merge tag may not appear in a link or image address — that puts ' +
    'recipient data into a URL',
  'raw-markup':
    'raw HTML cannot be published as an email design; build it from email ' +
    'blocks',
  unreadable: 'the design could not be read',
}

/**
 * A refusal message for a failed inspection, or `undefined` when it passed.
 *
 * One message naming ONE violation and its count, rather than a list: the
 * caller is an API route whose body is rendered in a dialog, and a publisher
 * fixing eleven images fixes them the same way they fix the first.
 */
export function emailStarterRefusal(
  inspection: EmailStarterInspection,
): string | undefined {
  const [first] = inspection.violations
  if (!first) return undefined
  const more = inspection.violations.length - 1
  const at = first.componentId ? ` (on a ${first.componentId} block)` : ''
  return (
    `This email design cannot be published or installed: ` +
    `${VIOLATION_COPY[first.code]}${at}. Found "${first.value}"` +
    (more > 0 ? ` and ${more} more like it.` : '.')
  )
}

/**
 * How much is actually known about the version of an email starter that was
 * installed.
 *
 * `unreviewed` is a real state, not a missing one, and it is the DEFAULT.
 */
export type EmailStarterAssurance = 'approved' | 'unreviewed' | 'rejected'

/**
 * The assurance of ONE version, read from that version's own document.
 *
 * Deliberately takes the version and nothing else. A listing carries
 * `reviewStatus: 'verified'` and a `latestVersionReviewState` mirror, and both
 * describe the listing or its newest build — neither is a statement about the
 * version somebody is installing right now. Passing the listing in here would
 * let version 7 inherit version 3's approval, which is the precise failure the
 * per-version model exists to prevent, and it would do it silently.
 *
 * An absent `reviewState` is `unreviewed`, never `approved`: an email starter
 * is auto-listed like every other copied artifact, so most versions have no
 * verdict at all and the honest answer is that nobody has looked.
 */
export function resolveEmailStarterAssurance(
  version: { reviewState?: unknown } | null | undefined,
): EmailStarterAssurance {
  const state = String(version?.reviewState ?? '')
  if (state === 'approved') return 'approved'
  if (state === 'rejected') return 'rejected'
  return 'unreviewed'
}

/** What the console says about an assurance, so no surface invents its own. */
export function emailStarterAssuranceLabel(
  assurance: EmailStarterAssurance,
): string {
  switch (assurance) {
    case 'approved':
      return 'Reviewed by Aglyn'
    case 'rejected':
      return 'Turned down in review'
    default:
      return 'Not reviewed'
  }
}

/** Why an installed email design may not be mailed. */
export interface EmailStarterSendBlock {
  code: 'killed'
  /** Rendered to the tenant; staff's reason when they recorded one. */
  reason: string
}

/**
 * Whether the kill switch stops this installed design from being SENT.
 *
 * ## What a kill has to reach, and why the other levers do not reach it
 *
 * An email starter is copied on install: the tree becomes a screen document in
 * the tenant's own site and nothing reads the listing again. That is the right
 * versioning model — a publisher's push must not rewrite an email a tenant is
 * mailing from — but it means every lever the marketplace already had stops at
 * the storefront. `deletedAt` unpublishes, `hiddenAt` blocks browse and blocks
 * the next install, and a rejected version was never installable. None of them
 * is felt by a tenant who installed last week and is sending today.
 *
 * So the kill switch is the one that has to reach through, and it is checked
 * HERE — at the send — rather than by deleting or rewriting the tenant's
 * document. Refusing the send and leaving the content alone is the same rule
 * capacity enforcement follows: a control that reaches a customer's own data
 * to enforce a decision about somebody else's artifact takes the wrong thing
 * away. The tenant keeps the design, keeps editing it, keeps previewing it;
 * what they cannot do is put it on the shared sending domain.
 *
 * Rejection is deliberately NOT a kill and must not become one here: a version
 * turned down in review was never installable, so nothing is running it, and
 * conflating the two would let a review verdict silently stop live mail.
 *
 * A listing-wide kill catches an install whose provenance never recorded a
 * version (everything installed before the provenance stamp). A per-version
 * kill cannot, and does not pretend to — `isPluginRevoked` answers false for
 * an empty version against a version list, which is the honest reading.
 */
export function emailStarterSendBlock(input: {
  /** The install stamp on the document being sent. */
  installedFrom: { listingId?: string | null; version?: string | null } | null | undefined
  /** `revocations/{listingId}`, or null when there is none. */
  revocation: PluginRevocation | null | undefined
}): EmailStarterSendBlock | null {
  const listingId = input.installedFrom?.listingId
  if (!listingId || !input.revocation) return null
  const version = String(input.installedFrom?.version ?? '')
  const killed = version
    ? isPluginRevoked(input.revocation, version)
    : isListingWideRevocation(input.revocation)
  if (!killed) return null
  const reason = String(input.revocation.reason ?? '').trim()
  return {
    code: 'killed',
    reason:
      'This email was installed from a marketplace template that Aglyn has ' +
      'since stopped' +
      (reason ? `: ${reason}. ` : '. ') +
      'Sending from it is blocked. The design is still here and still ' +
      'editable, and a campaign built from your own design sends normally.',
  }
}
