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

import {
  EMAIL_NODE_ROOT_ID,
  SYSTEM_EMAIL_COLLECTION,
  buildDefaultEmailNodeMap,
  getSystemEmailTemplate,
  isSystemEmailEditable,
  renderEmailHtml,
  substituteMergeTokens,
  type SystemEmailTemplateDefinition,
} from '@aglyn/shared-util-email'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { platformMarketingHostId } from '@aglyn/tenant-data-admin/server/platform-marketing-consent'
import {
  PLATFORM_BRANDING_PROFILE,
  brandMergeTokens,
  collectReferencedComponentIds,
  composeReusableComponentNodes,
  decodeStoredNodes,
  sanitizeAuthorHtml,
  type ReusableComponentTree,
} from '@aglyn/aglyn/server'
import {
  hostComponentReader,
  loadReferencedComponents,
  type ComponentStoreLike,
} from '@aglyn/aglyn/app-utils/load-referenced-components'

/**
 * `brand.*` tokens every system email resolves, UNDER whatever the caller
 * supplies (AGL-2139).
 *
 * The order is the whole safety property. `blankUnresolvedTokens` deletes any
 * token the caller did not provide, so a designed template written against
 * `{{brand.productName}}` would ship with a hole in the sentence at any send
 * site that forgot to pass one. Defaulting to the Aglyn profile means the
 * worst case is the copy we send TODAY rather than a gap — and an
 * org-context sender that spreads `brandMergeTokens(branding)` into its merge
 * map wins, because a later key overwrites an earlier one.
 *
 * The platform-scoped senders — password reset, email verification, the
 * security alerts, the staff erasure-hold alert — genuinely have no org (each
 * says so at its own call site, and password reset deliberately refuses to
 * look one up because that would be an enumeration oracle). Aglyn IS their
 * brand, so they need no change and get the right answer.
 */
const DEFAULT_BRAND_TOKENS = brandMergeTokens(PLATFORM_BRANDING_PROFILE)

/**
 * Blanks any `{{token}}` the caller did not supply.
 *
 * `substituteMergeTokens` leaves unknown tokens untouched, which is right for
 * campaigns (an author wants to see the tag they mistyped) but wrong here —
 * a system email goes to a customer, and "You've been invited to
 * {{org.name}}" is worse than a gap. Applied only in this resolver so
 * campaign behaviour is unchanged.
 */
function blankUnresolvedTokens(value: string): string {
  return value.replace(/\{\{[^}]*\}\}/g, '')
}

/**
 * Origin a picked image in a system email is fetched from (AGL-1224).
 *
 * A system email is staff-designed and its media lives in the platform
 * library, which the CONSOLE's `/api/media/cdn` route serves — the tenant app
 * mounts the same route, but a recipient of an org invite has no site to
 * resolve against. Same expression `app/layout.tsx` uses for the console's
 * own canonical URL, so the two cannot drift per deploy.
 */
const CONSOLE_ORIGIN =
  process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'

/**
 * Brand inputs that are NOT merge tokens (AGL-2139).
 *
 * `brand.productName` and friends ride the merge map because a designer types
 * them into copy. The logo is structural — it is a row the renderer emits or
 * does not — so it is an option rather than a token a template could forget
 * to place.
 */
export interface SystemEmailBrandOptions {
  /** Resolved `emailLogoUrl`; absent or null emits no logo row. */
  brandLogoUrl?: string | null
}

export interface RenderedSystemEmail {
  subject: string
  html: string
  text: string
}

/**
 * A staff-designed template loaded from Firestore, ready to render for any
 * number of recipients without touching Firestore again (AGL-768).
 */
export interface LoadedSystemEmail {
  definition: SystemEmailTemplateDefinition
  /** The design as stored: each email block still a placement. */
  nodes: Record<string, unknown>
  subjectTemplate: string
  preheaderTemplate: string
  /**
   * The published definitions of the email blocks `nodes` places, keyed by
   * id, read from the platform marketing site ONCE with the template
   * (AGL-3318), so a batch composes every recipient's copy without another
   * read. Absent when the design places none, when the deployment names no
   * marketing site, and when the read failed; each placement then renders as
   * nothing.
   */
  components?: Record<string, ReusableComponentTree>
}

/**
 * Whether a send goes out under the PLATFORM's brand, which is the only kind
 * that may carry the platform marketing site's email blocks (AGL-3318).
 *
 * Those blocks are Aglyn's header and footer: its logo, its address, its line
 * telling the reader why they get the mail. An agency on white-label sells
 * its clients a product with no vendor in it, and an invite or a usage
 * summary sent to one of their people reads as the agency's own mail. One
 * Aglyn footer in it names the vendor the whole tier is bought to hide. So a
 * white-label send renders the design with every block left unexpanded,
 * which draws as nothing, and the org's own email logo (the renderer's
 * `brandLogoUrl` row) stays the only header it carries.
 *
 * Read off what the send is actually branded as, rather than asked of the
 * caller, so no sender can forget to say. An org-context sender spreads
 * `brandMergeTokens(resolveBrandingProfile(org))` over the defaults and passes
 * the profile's email logo. A white-label profile never inherits the
 * platform's support URL (AGL-2428), so its tokens differ from
 * {@link DEFAULT_BRAND_TOKENS} on `brand.supportUrl` at least, and the
 * platform profile has no email logo of its own (its header is the block),
 * so any logo is an org's. The org-less senders, and every org without
 * white-label, which resolves to the platform profile itself, match the
 * defaults exactly: those sends are the platform's.
 */
export function isPlatformBrandedSend(
  merged: Readonly<Record<string, string>>,
  options: SystemEmailBrandOptions = {},
): boolean {
  if (String(options.brandLogoUrl ?? '').trim()) return false
  return Object.entries(DEFAULT_BRAND_TOKENS).every(
    ([token, value]) => merged[token] === value,
  )
}

/**
 * The email blocks a platform email places, read from the site that owns
 * them (AGL-3318), or `undefined` when there is nothing to read or the read
 * failed.
 *
 * WHICH SITE. A block is a reusable component, and a component belongs to a
 * site; a platform email belongs to none. The header and footer Aglyn's own
 * mail wears are the ones on its marketing site, which the deployment names
 * in `PLATFORM_MARKETING_HOST_ID`, the setting product-email consent already
 * reads. An install that names none reads nothing, and a block placed in its
 * system emails renders as nothing.
 *
 * NEVER A REASON NOT TO SEND. A site's own email fails its whole load when a
 * component read fails, and falls back to its built-in copy. Here the copy is
 * staff's design and the blocks are another site's chrome, so a failed read
 * costs the chrome and nothing else: it is logged, and the email renders
 * without them rather than trading the design for the fallback. A password
 * reset whose header could not be read still carries its link.
 */
async function loadPlatformEmailBlocks(
  firestore: ComponentStoreLike,
  templateKey: string,
  nodes: Record<string, unknown>,
): Promise<Record<string, ReusableComponentTree> | undefined> {
  // A design that places nothing costs nothing: no setting read, no read.
  if (!collectReferencedComponentIds(nodes as never).size) return undefined
  const hostId = platformMarketingHostId()
  if (!hostId) return undefined
  try {
    return await loadReferencedComponents(
      nodes,
      hostComponentReader(firestore, hostId),
      {
        onSkipped: (skipped) =>
          console.warn(
            JSON.stringify({
              tag: 'AGL-3318:platform-email-blocks-skipped',
              templateKey,
              hostId,
              skipped,
            }),
          ),
      },
    )
  } catch (error) {
    console.error(
      `system email template ${templateKey}: its email blocks failed to load from ${hostId}`,
      error,
    )
    return undefined
  }
}

/**
 * The node map one send renders: the design with its email blocks expanded
 * when the send is the platform's own, and as stored, every block drawing
 * nothing, when it is not (see {@link isPlatformBrandedSend}).
 */
function sendNodes(
  loaded: LoadedSystemEmail,
  merged: Readonly<Record<string, string>>,
  options: SystemEmailBrandOptions,
): Record<string, unknown> {
  if (!loaded.components || !isPlatformBrandedSend(merged, options)) {
    return loaded.nodes
  }
  return composeReusableComponentNodes(
    loaded.nodes as never,
    loaded.components,
  ) as Record<string, unknown>
}

/**
 * Loads the published staff-designed template for a key — ONE Firestore read
 * — or `null` when there is nothing usable (no document, no published
 * version, an empty node map, an unknown or non-Resend key, or a read
 * failure). Split out from {@link renderSystemEmail} so a batch send resolves
 * the template once and renders it per recipient, rather than one read each
 * (AGL-768): a Firestore read per invite is fine, one per recipient in a
 * usage-email batch is not.
 *
 * Reads through the Admin SDK, which bypasses the staff-only rules on the
 * collection — the send path runs as the server, not as a signed-in user.
 *
 * A design that places email blocks costs one more read per block, from the
 * platform marketing site, made here with the template so a batch pays it
 * once too (AGL-3318). Whether a recipient's copy expands them is decided per
 * send, by {@link renderLoadedSystemEmail}.
 */
export async function loadSystemEmail(
  templateKey: string,
): Promise<LoadedSystemEmail | null> {
  const definition = getSystemEmailTemplate(templateKey)
  if (!definition) return null
  // A Firebase- or Stripe-delivered email is sent by that service from its
  // own templates, so rendering one here would produce output nothing ever
  // sends (AGL-767).
  if (definition.deliveredBy !== 'resend') return null

  try {
    const firestore = firebaseAdmin.app().firestore()
    const templateRef = firestore
      .collection(SYSTEM_EMAIL_COLLECTION)
      .doc(templateKey)
    const templateSnapshot = await templateRef.get()
    if (!templateSnapshot.exists) return null

    const versionId = templateSnapshot.get('versionId')
    // Cleared by "reset to default", which nulls the pointer rather than
    // deleting the document so the audit trail survives.
    if (!versionId) return null

    const versionSnapshot = await templateRef
      .collection('versions')
      .doc(String(versionId))
      .get()
    // BOTH stored forms (AGL-1223). The email besigner compresses like every
    // other besigner document, and versions written before it did are still
    // plain maps — `decodeStoredNodes` returns those unchanged.
    //
    // Reading raw is the failure the guard below cannot catch: over a
    // `Buffer`, `Object.keys` counts BYTE INDICES, so the emptiness test
    // passes and a staff-authored email renders empty rather than falling
    // back to its built-in copy.
    const nodes = decodeStoredNodes<Record<string, unknown>>(
      versionSnapshot.get('nodes'),
    )
    if (!nodes || !Object.keys(nodes).length) return null

    const components = await loadPlatformEmailBlocks(
      firestore,
      templateKey,
      nodes,
    )
    return {
      definition,
      nodes,
      subjectTemplate:
        String(templateSnapshot.get('subject') ?? '') ||
        definition.defaultSubject,
      preheaderTemplate: String(templateSnapshot.get('preheader') ?? ''),
      ...(components && { components }),
    }
  } catch (error) {
    // Never let a template problem block the send — the caller falls back to
    // its built-in copy and the recipient still gets their email.
    console.error(`system email template ${templateKey} failed to load`, error)
    return null
  }
}

/**
 * Renders a pre-loaded template for one recipient's merge values (AGL-768).
 * No Firestore access — call {@link loadSystemEmail} once, then this per
 * recipient. Returns `null` if the node map renders empty, so the caller
 * still falls back to its built-in copy.
 *
 * The email blocks the design places are expanded only when this send is the
 * platform's own; a white-label send gets none of them (AGL-3318, see
 * {@link isPlatformBrandedSend}).
 */
export function renderLoadedSystemEmail(
  loaded: LoadedSystemEmail,
  merge: Record<string, string> = {},
  options: SystemEmailBrandOptions = {},
): RenderedSystemEmail | null {
  const merged = { ...DEFAULT_BRAND_TOKENS, ...merge }
  const rendered = renderEmailHtml({
    nodes: sendNodes(loaded, merged, options) as never,
    // Besigner maps are rooted at '_@_', not renderEmailHtml's default
    // 'root' — without this a designed template rendered empty and the send
    // fell back to built-in copy, so designing did nothing (AGL-765).
    rootId: EMAIL_NODE_ROOT_ID,
    subject: substituteMergeTokens(loaded.subjectTemplate, merged),
    preheader: substituteMergeTokens(loaded.preheaderTemplate, merged),
    merge: merged,
    // The same policy the console's own preview of these nodes applies —
    // `sanitizeCustomHtml` in the email plugin delegates to this exact
    // function, so what staff review and what the recipient receives are one
    // function of one string rather than two that have to be kept in step.
    sanitize: sanitizeAuthorHtml,
    // Without this a staff-picked image resolves to a site-relative CDN path,
    // which is a broken-image box in the recipient's inbox (AGL-1224).
    mediaOrigin: CONSOLE_ORIGIN,
    // The white-label email logo (AGL-2139). Absent for an org without one,
    // and for every org without the `whiteLabel` entitlement, because
    // `resolveBrandingProfile` hands those the Aglyn profile whose
    // `emailLogoUrl` is null.
    brandLogoUrl: options.brandLogoUrl ?? undefined,
  })
  if (!rendered?.html) return null
  return {
    subject: blankUnresolvedTokens(
      substituteMergeTokens(loaded.subjectTemplate, merged),
    ),
    html: blankUnresolvedTokens(rendered.html),
    text: blankUnresolvedTokens(rendered.text ?? ''),
  }
}

/**
 * Renders a staff-designed system email template (AGL-750).
 *
 * **Returns `null` whenever there is nothing usable to render** — no
 * template document, no published version, an empty node map, an unknown
 * key, or a Firestore failure. That is the entire safety story of this
 * feature: every caller keeps its existing hard-coded copy as the fallback,
 * so a missing, half-saved or broken template can never mean a customer
 * receives no email at all. It degrades to the status quo, never to silence.
 *
 * A single-recipient convenience over {@link loadSystemEmail} +
 * {@link renderLoadedSystemEmail}; a batch should call those two directly so
 * it reads the template once.
 */
export async function renderSystemEmail(
  templateKey: string,
  merge: Record<string, string> = {},
  options: SystemEmailBrandOptions = {},
): Promise<RenderedSystemEmail | null> {
  const loaded = await loadSystemEmail(templateKey)
  return loaded ? renderLoadedSystemEmail(loaded, merge, options) : null
}

/**
 * Renders the email a template would send RIGHT NOW: the staff-designed
 * version if one is published, otherwise the catalog default (AGL-766).
 *
 * Unlike {@link renderSystemEmail}, which returns null when nothing is
 * published so a send site can fall back to its own hard-coded copy, this
 * always returns something for an editable template — the default is rendered
 * from the same `defaultBody` the editor seeds, so "test" and "design" agree.
 * Returns null only for an unknown or Firebase-delivered key, which have no
 * body to render. Used by the test-send endpoint; not on any real send path.
 *
 * A designed version renders through {@link renderSystemEmail}, so its email
 * blocks follow the rule a real send does (AGL-3318). The catalog default
 * places none.
 */
export async function renderEffectiveSystemEmail(
  templateKey: string,
  merge: Record<string, string> = {},
  options: SystemEmailBrandOptions = {},
): Promise<RenderedSystemEmail | null> {
  const definition = getSystemEmailTemplate(templateKey)
  if (!definition || !isSystemEmailEditable(definition)) return null

  const designed = await renderSystemEmail(templateKey, merge, options)
  if (designed) return designed

  // Nothing published — render the catalog default the editor would seed.
  // The default carries `{{brand.*}}` tokens now (AGL-2139), so it needs the
  // same token set the designed path gets or the copy renders with holes
  // where the brand should be — `blankUnresolvedTokens` does not leave a
  // token visible, it deletes it.
  const nodes = buildDefaultEmailNodeMap(definition)
  const merged = { ...DEFAULT_BRAND_TOKENS, ...merge }
  const rendered = renderEmailHtml({
    nodes: nodes as never,
    rootId: EMAIL_NODE_ROOT_ID,
    subject: substituteMergeTokens(definition.defaultSubject, merged),
    merge: merged,
    sanitize: sanitizeAuthorHtml,
    mediaOrigin: CONSOLE_ORIGIN,
    brandLogoUrl: options.brandLogoUrl ?? undefined,
  })
  return {
    subject: blankUnresolvedTokens(
      substituteMergeTokens(definition.defaultSubject, merged),
    ),
    html: blankUnresolvedTokens(rendered.html),
    text: blankUnresolvedTokens(rendered.text ?? ''),
  }
}

export default renderSystemEmail
