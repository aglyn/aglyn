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
  renderEmailHtml,
  substituteMergeTokens,
  type SystemEmailTemplateDefinition,
} from '@aglyn/shared-util-email'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { platformMarketingHostId } from '@aglyn/tenant-data-admin/server/platform-marketing-consent'
import {
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
import {
  PLATFORM_BRAND_MERGE_TOKENS,
  buildSystemEmailChrome,
  isPlatformBrandedSend,
  type SystemEmailBrandOptions,
} from '@aglyn/aglyn/app-utils/system-email-chrome'

// Defined beside the chrome they decide, and re-exported for the callers and
// specs that reach them through this module.
export { isPlatformBrandedSend }
export type { SystemEmailBrandOptions }

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
 * Which copy a system email carries: a design staff published, or the
 * catalog's built-in copy, which is what every key without a usable design
 * sends (AGL-3322).
 */
export type SystemEmailSource = 'designed' | 'default'

export interface RenderedSystemEmail {
  subject: string
  html: string
  text: string
  source: SystemEmailSource
}

/**
 * A system email loaded once, ready to render for any number of recipients
 * without touching Firestore again (AGL-768): the published staff design, or
 * the catalog's built-in copy when there is none.
 */
export interface LoadedSystemEmail {
  definition: SystemEmailTemplateDefinition
  /** The design as stored, each email block still a placement; or the built-in copy's node map. */
  nodes: Record<string, unknown>
  subjectTemplate: string
  preheaderTemplate: string
  source: SystemEmailSource
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
 * costs the blocks and nothing else: it is logged, and the design renders
 * inside the coded header and footer instead (see
 * {@link renderLoadedSystemEmail}) rather than being traded for the built-in
 * copy. A password reset whose header could not be read still carries its
 * link.
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
 * Whether one send draws the design's email blocks: a send under the
 * platform's own brand (see {@link isPlatformBrandedSend}) of a design whose
 * blocks the load could read. Every other send renders the stored nodes, each
 * block a placement that draws nothing, inside the coded chrome.
 */
function drawsPlatformBlocks(
  loaded: LoadedSystemEmail,
  merged: Readonly<Record<string, string>>,
  options: SystemEmailBrandOptions,
): loaded is LoadedSystemEmail & {
  components: Record<string, ReusableComponentTree>
} {
  return (
    Boolean(loaded.components && Object.keys(loaded.components).length) &&
    isPlatformBrandedSend(merged, options)
  )
}

/**
 * A key's built-in copy as a loaded email (AGL-3322): the node map the editor
 * seeds a first design with, and the catalog subject. What a key sends until
 * staff publish a design, and whenever the published one cannot be read.
 */
function catalogDefault(
  definition: SystemEmailTemplateDefinition,
): LoadedSystemEmail {
  return {
    definition,
    nodes: buildDefaultEmailNodeMap(definition),
    subjectTemplate: definition.defaultSubject,
    preheaderTemplate: '',
    source: 'default',
  }
}

/**
 * Loads what a key sends — ONE Firestore read — ready to render per
 * recipient: the published staff design, or the catalog's built-in copy
 * (AGL-3322) when there is none to use (no document, no published version,
 * an empty node map, or a read failure).
 *
 * `null` only for a key that is unknown or not Resend-delivered, which has
 * nothing here to render. Split out from {@link renderSystemEmail} so a batch
 * send resolves the template once and renders it per recipient, rather than
 * one read each (AGL-768): a Firestore read per invite is fine, one per
 * recipient in a usage-email batch is not.
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
    if (!templateSnapshot.exists) return catalogDefault(definition)

    const versionId = templateSnapshot.get('versionId')
    // Cleared by "reset to default", which nulls the pointer rather than
    // deleting the document so the audit trail survives.
    if (!versionId) return catalogDefault(definition)

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
    if (!nodes || !Object.keys(nodes).length) return catalogDefault(definition)

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
      source: 'designed',
      ...(components && { components }),
    }
  } catch (error) {
    // Never let a template problem block the send, or strip it bare: the
    // recipient gets the built-in copy, in the same header and footer.
    console.error(
      `system email template ${templateKey} failed to load; sending its built-in copy`,
      error,
    )
    return catalogDefault(definition)
  }
}

/**
 * Renders a loaded email for one recipient's merge values (AGL-768). No
 * Firestore access — call {@link loadSystemEmail} once, then this per
 * recipient. `null` only if the renderer produced no document at all.
 *
 * Which header and footer it wears is decided here, per send, because one
 * batch-loaded design goes to recipients of different brands:
 *
 * - A send under the platform's own brand of a design whose email blocks the
 *   load read draws those blocks (AGL-3318), and nothing else: they ARE its
 *   header and footer, and a second one around them would draw both.
 * - Every other send is drawn inside {@link buildSystemEmailChrome}'s chrome
 *   (AGL-3322): the built-in copy, which places no blocks; a design sent to a
 *   white-label org's people, whose blocks stay unexpanded and draw nothing,
 *   since they are the platform's; and a design on a deployment that names no
 *   marketing site, or whose blocks could not be read. The chrome is in the
 *   brand of the send — the org's email logo rides in its header, so a
 *   white-label mail carries exactly one logo.
 */
export function renderLoadedSystemEmail(
  loaded: LoadedSystemEmail,
  merge: Record<string, string> = {},
  options: SystemEmailBrandOptions = {},
): RenderedSystemEmail | null {
  const merged = { ...PLATFORM_BRAND_MERGE_TOKENS, ...merge }
  const blocks = drawsPlatformBlocks(loaded, merged, options)
  const rendered = renderEmailHtml({
    nodes: (blocks
      ? composeReusableComponentNodes(loaded.nodes as never, loaded.components)
      : loaded.nodes) as never,
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
    // which is a broken-image box in the recipient's inbox (AGL-1224). The
    // chrome's logo resolves against it too.
    mediaOrigin: CONSOLE_ORIGIN,
    // No `brandLogoUrl`: the org's email logo (AGL-2139) is the chrome
    // header's logo whenever there is one to draw, and a send that draws the
    // platform's blocks is by definition one that carries none.
    ...(blocks
      ? {}
      : {
          chrome: buildSystemEmailChrome({
            definition: loaded.definition,
            merged,
            brandLogoUrl: options.brandLogoUrl,
            brandHomeUrl: options.brandHomeUrl,
          }),
        }),
  })
  if (!rendered?.html) return null
  return {
    subject: blankUnresolvedTokens(
      substituteMergeTokens(loaded.subjectTemplate, merged),
    ),
    html: blankUnresolvedTokens(rendered.html),
    text: blankUnresolvedTokens(rendered.text ?? ''),
    source: loaded.source,
  }
}

/**
 * Renders the system email a key sends to one recipient (AGL-750): the
 * published staff design, or the catalog's built-in copy (AGL-3322), in the
 * header and footer of the brand it is sent under.
 *
 * **`null` only for a key that is unknown or not Resend-delivered**, which
 * has nothing here to render. No template document, no published version, an
 * empty node map and a Firestore failure all render the built-in copy — the
 * same copy the editor seeds a first design with — so a missing, half-saved
 * or broken template can never mean a customer receives no email, or a bare
 * one. Every caller still keeps its own hard-coded copy behind this, as the
 * last resort for a render that produced nothing.
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
 * The email a template sends right now, for the staff test-send endpoint
 * (AGL-766): exactly what a real send of it renders — the published design,
 * or the built-in copy, with the same header and footer — so a test shows
 * what recipients receive. `null` for an unknown or non-Resend key.
 */
export async function renderEffectiveSystemEmail(
  templateKey: string,
  merge: Record<string, string> = {},
  options: SystemEmailBrandOptions = {},
): Promise<RenderedSystemEmail | null> {
  return renderSystemEmail(templateKey, merge, options)
}

export default renderSystemEmail
