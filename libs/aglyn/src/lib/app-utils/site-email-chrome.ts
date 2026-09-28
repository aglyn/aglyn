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
 * The header and footer a SITE's email is drawn inside (AGL-3370).
 *
 * The site-side twin of `system-email-chrome.ts`. A site's mail to its own
 * customers (an order receipt, a member's password reset, a newsletter
 * confirmation) is the site's, so everything in the chrome is read off the
 * site: its logo or its name in bold, linked to its address; a footer of why
 * the reader is getting the mail, the site's support address, and a
 * `© {year} {business name} · {postal address}` line.
 *
 * Nothing here names the platform. A site's customer bought from the site,
 * not from Aglyn, and a vendor's name at the foot of a receipt is the same
 * leak white-label exists to close, on every plan.
 *
 * Which emails wear it is the caller's decision: the built-in copy and the
 * text-only messages do; a design the site owner published is theirs, placed
 * header and footer included, and is sent as they built it.
 *
 * Pure: no reads, and a clock a test can replace.
 */

import type {
  EmailChrome,
  EmailChromeFooter,
} from '@aglyn/shared-util-email/email-render'

import { resolveHostToken, type HostTokenSource } from './host-tokens'

export interface SiteEmailChromeInput {
  /** The site's host document, or the fields of it the tokens read. */
  host: HostTokenSource | null | undefined
  /**
   * Why the recipient is getting this email, as a template: the renderer
   * substitutes `{{host.businessName}}` and the email's own tokens in it, as
   * it does in the body.
   */
  reason?: string
  /** The clock the copyright year is read from. */
  now?: () => Date
}

/**
 * A logo an inbox can draw, or undefined.
 *
 * An SVG is refused: Gmail and Outlook draw no SVG in mail, so a site whose
 * logo is one would open every email with an empty box where its name
 * belongs. The business name in bold is the header instead.
 */
function inboxLogo(url: string | undefined): string | undefined {
  if (!url) return undefined
  return /\.svg(?:[?#]|$)/i.test(url) || /^data:image\/svg/i.test(url)
    ? undefined
    : url
}

/** See the module note. */
export function buildSiteEmailChrome(input: SiteEmailChromeInput): EmailChrome {
  const { host } = input
  const now = input.now ?? (() => new Date())
  const name = resolveHostToken('businessName', host) ?? ''
  const logo = inboxLogo(resolveHostToken('logo', host))
  const url = resolveHostToken('url', host)
  const supportEmail = resolveHostToken('supportEmail', host)
  const address = resolveHostToken('address', host)

  // The site's name is resolved here rather than left to the merge, so a
  // site that has not set one reads "this site" where a merge would leave a
  // hole in the sentence ("you placed an order with .").
  const reason = String(input.reason ?? '')
    .replace(/\{\{\s*host\.businessName\s*\}\}/g, name || 'this site')
    .trim()
  const footer: EmailChromeFooter = {
    ...(reason ? { reason } : {}),
    ...(supportEmail
      ? { support: { label: supportEmail, href: `mailto:${supportEmail}` } }
      : {}),
    ...(name
      ? {
          legal:
            `© ${now().getUTCFullYear()} ${name}` +
            (address ? ` · ${address.replace(/\s*\n\s*/g, ', ')}` : ''),
        }
      : {}),
  }

  return {
    header: {
      ...(logo ? { logoUrl: logo } : {}),
      logoAlt: name,
      ...(url ? { href: url } : {}),
    },
    footer,
  }
}
