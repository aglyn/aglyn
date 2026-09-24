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
 * The header and footer a system email is drawn inside, for the brand it is
 * sent under (AGL-3322).
 *
 * A system email's built-in copy is a few lines of text, and only a staff
 * design can place the platform marketing site's email blocks. Without this,
 * the mail the platform sends most — every password reset, invite and alert
 * nobody has designed — would name its sender nowhere but the From line, and
 * tell the reader neither why it came nor where to get help. The renderer
 * draws whatever `EmailChrome` it is handed; this module decides what that
 * is, which comes down to one question: whose mail is this?
 *
 * ## The platform's own
 *
 * Its logo linked to its home page, and a footer of the email's reason, the
 * support link and a `© {year} {legal name} · {postal address}` line. Every
 * value is read from `platform-brand.ts`, so a renamed or self-hosted
 * deployment prints its own configuration: its logo or its name in bold, its
 * home page or no link, its address or none — and never ours. The Aglyn
 * defaults there apply only while the deployment is still called Aglyn.
 *
 * ## A white-label organization's
 *
 * Its own email logo, or its product name in bold; the reason, whose brand
 * tokens are the agency's; and a support link only when the agency set one.
 * No legal line: the only legal name and address this module knows are the
 * platform's, and the recipient is the agency's customer, who must not learn
 * the platform exists from the foot of an invite.
 *
 * Pure: no reads, no clock of its own that a test cannot replace.
 */

import type {
  EmailChrome,
  EmailChromeFooter,
} from '@aglyn/shared-util-email/email-render'
import type { SystemEmailTemplateDefinition } from '@aglyn/shared-util-email/system-email-catalog'

import { brandMergeTokens } from './plan-entitlements'
import {
  PLATFORM_BRANDING_PROFILE,
  PLATFORM_BRAND_LEGAL_NAME,
  PLATFORM_BRAND_NAME,
  PLATFORM_EMAIL_LOGO_URL,
  PLATFORM_HOME_URL,
  PLATFORM_POSTAL_ADDRESS,
} from './platform-brand'

/**
 * `brand.*` tokens every system email resolves, UNDER whatever the caller
 * supplies (AGL-2139).
 *
 * The order is the whole safety property. A system email blanks any token
 * the caller did not provide, so a designed template written against
 * `{{brand.productName}}` would ship with a hole in the sentence at any send
 * site that forgot to pass one. Defaulting to the platform profile means the
 * worst case is the platform's own copy rather than a gap — and an
 * org-context sender that spreads `brandMergeTokens(branding)` into its merge
 * map wins, because a later key overwrites an earlier one.
 *
 * The platform-scoped senders — password reset, email verification, the
 * security alerts, the staff erasure-hold alert — genuinely have no org (each
 * says so at its own call site, and password reset deliberately refuses to
 * look one up because that would be an enumeration oracle). The platform IS
 * their brand, so these are the right answer for them.
 */
export const PLATFORM_BRAND_MERGE_TOKENS: Readonly<Record<string, string>> =
  brandMergeTokens(PLATFORM_BRANDING_PROFILE)

/**
 * Brand inputs that are NOT merge tokens (AGL-2139).
 *
 * `brand.productName` and friends ride the merge map because a designer types
 * them into copy. The logo and the home page are structural — the header the
 * renderer draws, or does not — so they are options rather than tokens a
 * template could forget to place.
 */
export interface SystemEmailBrandOptions {
  /** The org's resolved `emailLogoUrl`; absent or blank is no org logo. */
  brandLogoUrl?: string | null
  /**
   * The org's resolved `homeUrl`: where a white-label header links. Only an
   * `http(s)` URL is linked; a `mailto:` home is no destination for a logo.
   */
  brandHomeUrl?: string | null
}

/**
 * Whether a send goes out under the PLATFORM's brand, which is the only kind
 * that may carry the platform's header and footer — the marketing site's
 * email blocks (AGL-3318), or the chrome {@link buildSystemEmailChrome} draws
 * in their place (AGL-3322).
 *
 * Those are the platform's logo, its address, its line telling the reader why
 * they get the mail. An agency on white-label sells its clients a product
 * with no vendor in it, and an invite or a usage summary sent to one of their
 * people reads as the agency's own mail. One platform footer in it names the
 * vendor the whole tier is bought to hide.
 *
 * Read off what the send is actually branded as, rather than asked of the
 * caller, so no sender can forget to say. An org-context sender spreads
 * `brandMergeTokens(resolveBrandingProfile(org))` over the defaults and passes
 * the profile's email logo. A white-label profile never inherits the
 * platform's support URL (AGL-2428), so its tokens differ from
 * {@link PLATFORM_BRAND_MERGE_TOKENS} on `brand.supportUrl` at least, and the
 * platform profile has no email logo of its own, so any logo is an org's. The
 * org-less senders, and every org without white-label, which resolves to the
 * platform profile itself, match the defaults exactly: those sends are the
 * platform's.
 */
export function isPlatformBrandedSend(
  merged: Readonly<Record<string, string>>,
  options: SystemEmailBrandOptions = {},
): boolean {
  if (String(options.brandLogoUrl ?? '').trim()) return false
  return Object.entries(PLATFORM_BRAND_MERGE_TOKENS).every(
    ([token, value]) => merged[token] === value,
  )
}

export interface SystemEmailChromeInput extends SystemEmailBrandOptions {
  /** The email being sent; its `footerReason` is the footer's first line. */
  definition: Pick<SystemEmailTemplateDefinition, 'footerReason'>
  /**
   * The send's merge map, platform brand tokens under the caller's — the map
   * the body renders with, which is what makes the reason's tokens resolve to
   * the same names the body uses.
   */
  merged: Readonly<Record<string, string>>
  /** The clock the copyright year is read from. */
  now?: () => Date
}

/** A non-empty trimmed string, else undefined. */
const clean = (value: string | null | undefined): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length ? text : undefined
}

/**
 * The footer's support link, from the send's `brand.supportUrl`, or
 * undefined when it has none.
 *
 * Empty is a decision, not a gap: a white-label org that set no support URL
 * gets NO line rather than the platform's desk (AGL-2428), which cannot help
 * its customers and would name the vendor to them. A `mailto:` reads as the
 * mailbox, which is what the reader has to type into a client that does not
 * follow the link; a web page reads as an instruction.
 */
function supportLink(
  url: string | undefined,
): EmailChromeFooter['support'] | undefined {
  const href = clean(url)
  if (!href) return undefined
  if (/^mailto:/i.test(href)) {
    const address = clean(href.slice('mailto:'.length).split('?')[0])
    return address ? { label: address, href } : undefined
  }
  return { label: 'Get help', href }
}

/**
 * The chrome one system email is drawn inside, for the brand it is sent
 * under. See the module comment for the two shapes and why they differ.
 *
 * The reason and the other lines go out as templates: the renderer runs them
 * through the same merge substitution as the body, so `{{org.name}}` and
 * `{{brand.productName}}` read exactly as they do in the copy above them.
 */
export function buildSystemEmailChrome(
  input: SystemEmailChromeInput,
): EmailChrome {
  const { definition, merged, brandLogoUrl, brandHomeUrl } = input
  const now = input.now ?? (() => new Date())
  const reason = clean(definition.footerReason)
  const support = supportLink(merged['brand.supportUrl'])
  const footer: EmailChromeFooter = {
    ...(reason ? { reason } : {}),
    ...(support ? { support } : {}),
  }

  if (isPlatformBrandedSend(merged, { brandLogoUrl })) {
    const legal =
      `© ${now().getUTCFullYear()} ${PLATFORM_BRAND_LEGAL_NAME}` +
      (PLATFORM_POSTAL_ADDRESS ? ` · ${PLATFORM_POSTAL_ADDRESS}` : '')
    return {
      header: {
        ...(PLATFORM_EMAIL_LOGO_URL ? { logoUrl: PLATFORM_EMAIL_LOGO_URL } : {}),
        logoAlt: PLATFORM_BRAND_NAME,
        ...(PLATFORM_HOME_URL ? { href: PLATFORM_HOME_URL } : {}),
      },
      footer: { ...footer, legal },
    }
  }

  const logoUrl = clean(brandLogoUrl)
  const home = clean(brandHomeUrl)
  return {
    header: {
      ...(logoUrl ? { logoUrl } : {}),
      logoAlt: merged['brand.productName'] ?? '',
      ...(home && /^https?:\/\//i.test(home) ? { href: home } : {}),
    },
    footer,
  }
}
