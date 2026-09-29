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
  commitWithSiteWideEntry,
  releaseSiteWideOutboxEntry,
} from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import {
  doc,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type UpdateData,
} from 'firebase/firestore'
import revalidateLivePages, {
  type RevalidateLivePagesOptions,
  type RevalidateLivePagesResult,
} from './revalidate-live-pages'

/**
 * THE ONE DOOR A CONSOLE WRITE TO `hosts/{hostId}` GOES THROUGH (AGL-3386).
 *
 * A site's settings live on its host document, and the tenant renders them
 * straight off it — the theme, the favicon, the logo, the SEO title and the
 * structured data, the business details behind the contact tokens, the
 * consent banner, the announcement bar. There is no publish step between a
 * settings save and the live site, so nothing ever told the tenant that its
 * cached pages were now wrong: every one of those saves waited out the page's
 * hour-long ISR window (`revalidate = 3600`) while the console said "Saved!".
 *
 * So the drop hangs off the WRITE, here, rather than off each card that
 * writes. The console's `useHost` hook routes its setter through
 * {@link announceHostDocumentWrite}, and every direct write goes through
 * {@link updateHostDocument}; `host-document-writes-sweep.spec.ts` fails the
 * build for a console file that writes the host document any other way. That
 * is the AGL-1150 lesson `revalidate-live-pages.ts` opens with — one omission
 * repeated across call sites until a helper made it impossible to forget —
 * applied to a surface with a writer in nearly every settings card.
 *
 * The drop is `entireHost`, because a site setting has no address: the theme
 * is on every page, and so is the favicon. The hour-long window is still
 * underneath as the backstop; this only stops it being the mechanism.
 *
 * DURABLE, like a publish. A rendered write commits with a site-wide publish
 * outbox entry in the same batch (`commitWithSiteWideEntry`), the tab's own
 * drop releases it on a plain `ok`, and the console's drain fires any entry a
 * closed tab left behind.
 */

/**
 * Host-document fields the published site RENDERS, each with where.
 *
 * A write carrying any of these drops every cached page of the site. The
 * reasons are the point, as they are on `HOST_CLIENT_WRITABLE_FIELDS`: they
 * record that somebody traced the field to a renderer, which is the only way
 * a later reader can tell a deliberate entry from a guess.
 */
export const SITE_RENDERED_HOST_FIELDS: Readonly<Record<string, string>> = {
  theme:
    'The persisted MUI theme every published page is styled with, resolved ' +
    'by `resolveSiteTheme` in the tenant layout.',
  themeOverride:
    'The site\'s patch on top of an installed marketplace theme; the tenant ' +
    'renders `theme ⊕ themeOverride`, so a reset here restyles every page.',
  seo:
    'Title, description, separator and title pattern, favicon, app icon, ' +
    'social image, the organization/Local business JSON-LD entity, the AI ' +
    'agent guidance, the search engine verification tokens and ' +
    '`discourageSearchEngines` — all written into the ' +
    'head of every page, or into robots and llms.txt.',
  displayName:
    'The site name — the title and JSON-LD fallback when no SEO title is set.',
  logoUrl: 'The brand mark the tenant navigation and error pages render.',
  logoDarkUrl:
    'The brand mark the tenant navigation and error pages render in the ' +
    'dark scheme (AGL-3400).',
  business:
    'Support email, address and social links behind the host tokens that ' +
    'published pages and footers render.',
  analytics:
    'The GA/GTM/ad-tag ids the tenant writes into an inline script on every ' +
    'page.',
  consent:
    'Whether the visitor consent banner shows, and in which mode — decided ' +
    'on every page before the analytics above may load.',
  locales: 'Which languages the site serves; decides the locale-prefixed routes.',
  defaultLocale: 'Which of `locales` serves an unprefixed path.',
  timeZone:
    'The zone published dates are rendered in (`resolveSiteTimeZone`), on ' +
    'every collection listing and entry.',
  notFoundScreenId: 'The legacy 404 binding, still read by the error render.',
  errorScreens: 'Which designed screen renders each error status.',
  maintenance: 'Replaces every path with the 503 screen while it is on.',
  announcementBar: 'The site-wide announcement bar, rendered above every page.',
  popup: 'The promotional popup, mounted on every page.',
  authScreens: 'Which screens render `/signin`, `/signup` and `/recover`.',
  authorScreenId: 'The screen every `/author/{slug}` page renders through.',
  builtInPageLayoutId:
    'The layout the built-in themed pages (search, error fallbacks) wear.',
  enabledPlugins:
    'Which plugins the site opted into — decides what their widgets render.',
  disabledPlugins: 'Which plugins the site switched off, the other half.',
  approvedImageHosts:
    'One of the six lists the tenant builds its enforced CSP from on every ' +
    'request, read from the same cached host data a drop refreshes.',
  approvedMediaHosts: 'CSP list — see `approvedImageHosts`.',
  approvedFontHosts: 'CSP list — see `approvedImageHosts`.',
  approvedFormActions: 'CSP list — see `approvedImageHosts`.',
  approvedConnectHosts: 'CSP list — see `approvedImageHosts`.',
  approvedFrameHosts: 'CSP list — see `approvedImageHosts`.',
}

/**
 * Host-document fields whose write must NOT cost a whole-site drop, each with
 * why.
 *
 * Two kinds. Fields the site never renders — bookkeeping, membership, billing
 * and sending identity — where a drop would regenerate every page to show the
 * same HTML. And fields that ARE rendered but already have a narrower
 * announce of their own, where a whole-site drop on top would make every
 * publish pay for every page.
 *
 * Anything in NEITHER map is treated as rendered. A field nobody classified
 * is far more likely to be a new setting than a new counter, and the cost of
 * guessing wrong that way is one regeneration rather than an hour of a live
 * site contradicting its own console.
 */
export const HOST_FIELDS_WITHOUT_SITE_DROP: Readonly<Record<string, string>> = {
  updatedAt: 'Stamped on every console write; drives "last edited" copy only.',
  createdAt: 'Set once at creation; nothing renders it.',
  screens:
    'The routing map. Rendered, but every write to it is a publish, and ' +
    '`screen-publishing.ts` announces the exact addresses it changed — plus ' +
    'the publish outbox for a closed tab.',
  layouts:
    'The shared-layout directory: display names for the console. The tenant ' +
    'resolves layouts through their own documents and never reads this map.',
  redirects:
    'The redirect index. Rule changes announce their own source path from ' +
    'the redirects plugin; the tenant reads the rule documents, not this map.',
  memberRoles: 'Membership projection; decides console access, not pages.',
  memberPermissions: 'Membership projection, as `memberRoles`.',
  admins: 'Legacy membership list; server-owned.',
  hosts: 'Legacy field, server-owned; no renderer reads it.',
  orgId: 'Ownership; server-owned and not rendered.',
  subdomain:
    'Server-owned. `/api/hosts/rename` drops the old label\'s aliases itself.',
  cname: 'Server-owned; the domain routes drop their own aliases.',
  cnameAttachmentPending: 'Server-owned domain state.',
  cnameDetachmentPending: 'Server-owned domain state.',
  themeInstalledFrom:
    'Server-owned provenance of an installed theme; the install route that ' +
    'writes it drops the site\'s pages itself.',
  themeReplaced: 'The undo snapshot of the previous theme; never rendered.',
  suspendedAt: 'Server-owned; the lockdown paths drop the site themselves.',
  suspendedReasonCode: 'Server-owned suspension detail, as `suspendedAt`.',
  suspendedMessage: 'Server-owned suspension detail, as `suspendedAt`.',
  suspendedUntilMs: 'Server-owned suspension detail, as `suspendedAt`.',
  suspendedMode: 'Server-owned suspension detail, as `suspendedAt`.',
  suspendedEnforcement: 'Server-owned suspension detail, as `suspendedAt`.',
  bandwidthCeiling: 'Server-owned free-tier containment state.',
  sendingDomain: 'The marketing mail `From:` domain; mail, not pages.',
  sendingLocalPart: 'The marketing mail `From:` mailbox; mail, not pages.',
  sendingLabel: 'The sending-domain pin; mail, not pages.',
  sendingDomainRequestedAtMs: 'Sending-domain audit record; mail, not pages.',
  sendingDomainRequestedBy: 'Sending-domain audit record; mail, not pages.',
  projectId: 'Enterprise project binding; server-owned, not rendered.',
  projectNumber: 'Enterprise project binding; server-owned, not rendered.',
}

/**
 * The top-level field a write key addresses. `updateDoc` reads a dotted key
 * as a path (`'seo.discourageSearchEngines'`, `'consent.mode'`), and the
 * field the site renders is the head of it.
 */
function topLevelField(key: string): string {
  const dot = key.indexOf('.')
  return dot === -1 ? key : key.slice(0, dot)
}

/**
 * The fields of a host-document write payload that change what the published
 * site renders — empty when the write is bookkeeping only.
 *
 * Unclassified fields count as rendered; see `HOST_FIELDS_WITHOUT_SITE_DROP`.
 */
export function renderedHostFieldsIn(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const fields = new Set<string>()
  for (const key of Object.keys(payload)) {
    const field = topLevelField(key)
    if (!field || field === '$id') continue
    if (
      field in SITE_RENDERED_HOST_FIELDS ||
      !(field in HOST_FIELDS_WITHOUT_SITE_DROP)
    ) {
      fields.add(field)
    }
  }
  return [...fields]
}

export interface HostDocumentWriter {
  /** The signed-in user; its ID token authenticates the drop. */
  user: RevalidateLivePagesOptions['user']
  hostId: string
}

/**
 * After a SUCCESSFUL write to `hosts/{hostId}`: drop every cached page of the
 * site when the payload touched anything it renders, and release the write's
 * outbox entry once that drop is known to have landed.
 *
 * Resolves `null` when nothing rendered changed, and never rejects. The write
 * has already landed by the time this runs, so a drop that fails must never
 * make the save look failed — `revalidateLivePages` answers a refusal as a
 * result rather than a throw, and anything else is swallowed here. A drop
 * that did not answer `ok` leaves the entry for the drain.
 */
export async function announceHostDocumentWrite(
  options: HostDocumentWriter & {
    payload: unknown
    entry?: DocumentReference | null
  },
): Promise<RevalidateLivePagesResult | null> {
  const { user, hostId, payload, entry = null } = options
  if (!hostId || !renderedHostFieldsIn(payload).length) return null
  try {
    const result = await revalidateLivePages({ user, hostId, entireHost: true })
    await releaseSiteWideOutboxEntry(entry, result?.reason)
    return result
  } catch {
    return null
  }
}

/**
 * `updateDoc` on `hosts/{hostId}`, followed by the drop the payload calls for.
 *
 * Use this — never a bare `updateDoc(doc(firestore, 'hosts', hostId), …)` —
 * for every console write to the host document outside `useHost`. A failed
 * write rejects exactly as `updateDoc` would, and nothing is announced. A
 * rendered write commits with its site-wide outbox entry in one batch.
 *
 * The drop is fired without waiting by default, like the publish call sites:
 * the save is done, and a settings card has nothing to say about the cache.
 * `awaitAnnounce` is for the caller whose message IS a claim about what
 * visitors see — the maintenance toggle — and it gets the drop's result back
 * to word that claim honestly.
 */
export async function updateHostDocument(
  firestore: Firestore,
  writer: HostDocumentWriter,
  data: UpdateData<Record<string, unknown>>,
  options?: { awaitAnnounce?: boolean },
): Promise<RevalidateLivePagesResult | null> {
  const hostRef = doc(firestore, 'hosts', writer.hostId)
  let entry: DocumentReference | null = null
  if (renderedHostFieldsIn(data).length) {
    entry = await commitWithSiteWideEntry(writer.hostId, async (stage) => {
      const batch = writeBatch(firestore)
      batch.update(hostRef, data)
      stage?.(batch, firestore)
      await batch.commit()
    })
  } else {
    await updateDoc(hostRef, data)
  }
  const announced = announceHostDocumentWrite({ ...writer, payload: data, entry })
  if (options?.awaitAnnounce) return announced
  void announced
  return null
}
