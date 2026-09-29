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
  resolveSiteTheme,
  type ThemeHostDocument,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import { sanitizeAuthorHtml } from '@aglyn/aglyn/app-utils/author-html'
import {
  hostTokenMerge,
  type HostTokenSource,
} from '@aglyn/aglyn/app-utils/host-tokens'
import { composeHostComponentNodes } from '@aglyn/aglyn/app-utils/load-referenced-components'
import { buildSiteEmailChrome } from '@aglyn/aglyn/app-utils/site-email-chrome'
import {
  buildEmailPalette,
  emailPaletteBaseForHost,
  getTenantEmail,
  hostEmailOrigin,
  loadHostEmail,
  renderFramedTextEmail,
  renderHostEmail,
  renderLoadedHostEmail,
  type EmailChrome,
  type EmailTheme,
  type LoadedHostEmail,
  type RenderedHostEmail,
} from '@aglyn/shared-util-email'
import { firebaseAdmin } from './firebase-admin'

/**
 * `renderHostEmail` with `host.*` tokens resolved (AGL-1022).
 *
 * The whole point of host variables is that a publisher's email template can
 * say "write to {{host.supportEmail}}" and have the installing site fill it in.
 * That only happens if something resolves the tokens at SEND time, and the
 * email library cannot: `@aglyn/shared-util-email` is `scope:shared` and may
 * only depend on `scope:shared`, while the token registry is aglyn-scoped.
 *
 * So the join happens here, in the one lib that already sits above both. Three
 * alternatives were weighed and this is the one that cannot fail quietly:
 *
 * * A registration hook inside the email library would mean a provider that is
 *   never registered resolves every token to nothing, silently, on a path whose
 *   output has already been sent to a customer. This repo has shipped a
 *   flawless security control with zero callers before; that is the shape.
 * * Threading the map through all eighteen call sites puts the burden on
 *   whoever adds the nineteenth, and they will not know.
 * * Moving the registry into a `scope:shared` lib is the cleanest end state and
 *   the right thing if a second shared consumer ever appears — but the only
 *   candidate today is `shared/util/tools`, which is generic helpers, and
 *   domain logic does not belong there.
 *
 * Costs one host read per send. Emails are not a hot path, and the read buys
 * the guarantee that a template's branding is right by construction.
 */
export async function renderHostEmailWithTokens(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  templateKey: string,
  merge: Record<string, string> = {},
  options: { origin?: string } = {},
): Promise<RenderedHostEmail | null> {
  const host = await readHostTokenSource(firestore, hostId)
  return renderHostEmail(
    firestore as never,
    hostId,
    templateKey,
    // Host tokens first: an explicit caller value WINS. A sender passing
    // `host.businessName` is naming a specific thing on purpose (a white-label
    // send, a preview with sample data), and this is not the place to overrule
    // it.
    { ...hostTokenMerge(host), ...merge },
    // The HTML policy joins here for the same reason the token map does, and
    // it is the same reason: `renderEmailHtml` requires one, `scope:shared`
    // cannot import one, and this lib already sits above both. Supplying it
    // here rather than at each of the nine senders keeps their signatures
    // untouched and gives the tenth one the right policy without knowing it
    // needed to ask.
    //
    // The component graft joins on the same argument (AGL-3287): a header or
    // footer the site owner placed is a reference the shared renderer cannot
    // resolve, so every sender behind this function mails it expanded without
    // having to know it exists. Style overrides do not survive into mail —
    // they land in `sx`, which `renderEmailHtml` never reads — but property
    // values and attribute overrides do.
    //
    // And the site's header and footer (AGL-3370), which the built-in copy is
    // drawn inside; a design the owner published goes out as they built it.
    {
      ...options,
      sanitize: sanitizeAuthorHtml,
      compose: composeHostComponentNodes,
      chrome: siteChromeFor(host, templateKey),
      theme: siteThemeFor(host),
    },
  )
}

/**
 * The site's host document as the token and chrome readers see it, or null.
 *
 * A failed read must not stop the send. Every token then resolves to its
 * empty behaviour, which is the same outcome as a site that set nothing —
 * an email with a gap where the address would be, rather than no email.
 */
async function readHostTokenSource(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<SiteEmailHost | null> {
  try {
    const snapshot = await firestore.collection('hosts').doc(hostId).get()
    return snapshot.exists ? (snapshot.data() as SiteEmailHost) : null
  } catch {
    return null
  }
}

/** What a site email reads off the host document: its tokens and its theme. */
type SiteEmailHost = HostTokenSource & {
  theme?: {
    colorSchemes?: { light?: Record<string, unknown> | null }
    shape?: { borderRadius?: unknown }
  } | null
  themeOverride?: unknown
}

/**
 * The site's theme as its email draws it (AGL-3370): the palette the
 * published site renders with, light scheme, since an inbox has one, and its
 * corner radius for buttons. A site with no theme of its own resolves the
 * same base the site itself does.
 */
function siteThemeFor(host: SiteEmailHost | null): EmailTheme {
  // Resolved, not read off `theme`: a site's edits are an override on the
  // theme it picked (AGL-3404), so the stored theme alone is the design
  // before anything the site changed.
  const theme = resolveSiteTheme(host as ThemeHostDocument | null)
  const radius = theme?.shape?.borderRadius
  return {
    palette: buildEmailPalette({
      base: emailPaletteBaseForHost(host),
      colors: (theme?.colorSchemes?.light ?? null) as Record<string, unknown> | null,
    }),
    ...(typeof radius === 'number' ? { buttonRadius: radius } : {}),
  }
}

/** The site's chrome for one kind of email, with that kind's footer reason. */
function siteChromeFor(
  host: HostTokenSource | null,
  templateKey: string,
): EmailChrome {
  return buildSiteEmailChrome({
    host,
    reason: getTenantEmail(templateKey)?.footerReason,
  })
}

/** A site email loaded once for a batch, with the site's tokens beside it. */
export interface LoadedHostEmailWithTokens {
  loaded: LoadedHostEmail
  hostMerge: Record<string, string>
}

/**
 * {@link loadHostEmail} for a batch (AGL-3370): the template, or the built-in
 * copy in the site's header and footer, read ONCE, with the site's `host.*`
 * tokens beside it for {@link renderLoadedHostEmailWithTokens}. `null` only
 * for a key with neither, so the batch keeps its own copy.
 */
export async function loadHostEmailWithTokens(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  templateKey: string,
  options: { origin?: string } = {},
): Promise<LoadedHostEmailWithTokens | null> {
  const host = await readHostTokenSource(firestore, hostId)
  const loaded = await loadHostEmail(firestore as never, hostId, templateKey, {
    ...options,
    compose: composeHostComponentNodes,
    chrome: siteChromeFor(host, templateKey),
    theme: siteThemeFor(host),
  })
  return loaded ? { loaded, hostMerge: hostTokenMerge(host) } : null
}

/** One recipient's copy of a batch-loaded site email; no reads. */
export function renderLoadedHostEmailWithTokens(
  bundle: LoadedHostEmailWithTokens,
  merge: Record<string, string> = {},
): RenderedHostEmail | null {
  return renderLoadedHostEmail(
    bundle.loaded,
    { ...bundle.hostMerge, ...merge },
    sanitizeAuthorHtml,
  )
}

/**
 * The site's header and footer for one kind of email, its theme, and the
 * origin and host a stored logo reference resolves against (AGL-3370): for a sender
 * that renders per recipient itself, such as a typed campaign.
 */
export async function siteEmailFrame(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  templateKey: string,
): Promise<{
  chrome: EmailChrome
  theme: EmailTheme
  mediaOrigin?: string
  mediaHostId: string
}> {
  const host = await readHostTokenSource(firestore, hostId)
  const origin = host
    ? hostEmailOrigin({ cname: host.cname, subdomain: host.subdomain })
    : undefined
  return {
    chrome: siteChromeFor(host, templateKey),
    theme: siteThemeFor(host),
    ...(origin ? { mediaOrigin: origin } : {}),
    mediaHostId: hostId,
  }
}

/**
 * A text-only site email in the site's header and footer (AGL-3370): a
 * workflow's email step, or a message a site sends in words nobody designed.
 * The text arrives resolved; the footer's reason is the kind's, by key.
 */
export async function renderSiteTextEmail(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  templateKey: string,
  message: { subject: string; text: string; preheader?: string },
): Promise<{ subject: string; html: string; text: string }> {
  const frame = await siteEmailFrame(firestore, hostId, templateKey)
  const rendered = renderFramedTextEmail({ ...message, ...frame })
  return { subject: message.subject, html: rendered.html, text: rendered.text }
}

export default renderHostEmailWithTokens
