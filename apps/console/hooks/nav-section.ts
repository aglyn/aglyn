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
 * What a console path says about itself, as PURE functions (AGL-2486).
 *
 * These were part of `use-url-names-org`, which also holds the hooks and so
 * imports `use-org-scope`. `use-org-scope` now has to parse the path itself —
 * its top-priority candidate can no longer rely on `useParams()` alone, see
 * the note there — and importing the parser from `use-url-names-org` would
 * close a cycle (org scope → url names org → org scope).
 *
 * So the parsing lives here, where it depends on nothing at all: no React, no
 * Next, no Firestore. `use-url-names-org` re-exports every symbol, so all the
 * existing import sites (including the `use-secondary-nav` re-export chain)
 * are unchanged.
 */

export type NavSectionKind = 'host' | 'org' | 'admin' | 'manage' | 'none'

export interface NavSection {
  kind: NavSectionKind
  /** The path the section's tab hrefs are relative to ('' when none). */
  base: string
  orgSlug?: string
  host?: string
}

export const segmentsOf = (path: string) => path.split('/').filter(Boolean)

/**
 * Which tab strip a path belongs to (AGL-754). Every `navTabItems=` variant
 * the pages used to pass corresponds to exactly one route subtree, so the
 * secondary app bar can derive its own strip from the URL instead of being
 * fed by whichever page happens to be mounted.
 *
 * `/[orgSlug]/hosts` is the org "Sites" tab, but `/[orgSlug]/hosts/[host]` is
 * a site — the host branch needs the third segment, not just `hosts`.
 */
export function resolveNavSection(pathname: string | null): NavSection {
  const segments = segmentsOf(pathname ?? '')
  const [first, second, third] = segments
  if (!first) return { kind: 'none', base: '' }
  if (first === 'admin') return { kind: 'admin', base: '/admin' }
  if (first === 'manage') return { kind: 'manage', base: '/manage' }
  if (second === 'hosts' && third) {
    return {
      kind: 'host',
      base: `/${first}/hosts/${third}`,
      orgSlug: first,
      host: third,
    }
  }
  return { kind: 'org', base: `/${first}`, orgSlug: first }
}

/**
 * Whether the URL itself names a workspace — the only honest basis for the
 * chrome to CLAIM one (AGL-1130).
 *
 * `useOrgScope().currentOrg` deliberately falls back to a remembered
 * selection and then to the user's first org, because org-less pages still
 * need an org to ACT on (Manage Account browses that org's media library, the
 * menu's Billing row has to land somewhere). That fallback is fine for an
 * action and wrong for a label: on `/manage/user` and `/admin/*` it chromed
 * the page "Zach Gover Personal · Starter" — a workspace the page has nothing
 * to do with, complete with its plan badge and an Upgrade CTA for it.
 *
 * AGL-1937 added a third reading to "claim" and "act": **committing** the
 * session to a workspace. Loading an org's plugin bundles and bucketing its
 * release flags are not claims and not user actions, but they are just as
 * wrong on an org-less route — a loaded chunk cannot unload, so the picker
 * would permanently seed the session with whichever org the scope fell back
 * to, moments before the user chooses a different one.
 *
 * Deliberately derived from the URL alone, not from the resolved org: a check
 * that waited on the membership read would blink the switchers out on every
 * cold load, which is the exact regression AGL-745/755 exist to prevent. That
 * also means it has no loading window of its own to gate on — it answers
 * false for "the URL does not name one", never for "not read yet", which is
 * what makes it safe to hang a load decision off (AGL-1113).
 *
 * ## It answers "the URL names A workspace", not "we resolved THAT one"
 *
 * Those came apart on the not-found boundary (AGL-2486): this predicate reads
 * `usePathname()`, which survives an unmatched route, while the org scope's
 * top candidate read `useParams()`, which does not. So the chrome was cleared
 * to name a workspace while the scope had fallen through to a remembered one,
 * and the switcher confidently displayed an org the URL contradicted. The
 * scope's own parsing is fixed at the source, but anything that puts a NAME
 * on screen wants `useUrlNamedOrg()` — "the URL names one AND this is it" —
 * rather than this predicate alone.
 *
 * The staff console is org-less on ANY hostname — it is the platform's own
 * view, not a workspace's — so it answers false even on a workspace
 * subdomain. Everywhere else a subdomain IS the workspace, so
 * `business1.aglyn.com/manage/user` legitimately names one.
 */
export function urlNamesOrg(
  section: NavSection,
  subdomainSlug: string | null,
): boolean {
  if (section.kind === 'admin') return false
  return Boolean(section.orgSlug) || Boolean(subdomainSlug)
}
