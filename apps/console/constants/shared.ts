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

import { LEGAL_ORIGIN as OPERATOR_LEGAL_ORIGIN } from '@aglyn/aglyn/app-utils/published-legal-pages'
import { buildDocsUrl } from './docs-links'

export const CONTENT_MAX_WIDTH = 'xl'
export const DRAWER_WIDTH = 290
export const TAB_HEIGHT = 40
export const TOP_BAR_HEIGHT = 48
export const TABLE_ROW_HEIGHT = 48
/**
 * Table header height, shared by the DataTable (layouts, components,
 * templates) and the bespoke screens hierarchy table. MUI's size="small"
 * TableHead and MUI X's DataGrid column header default to different heights,
 * so the console showed two table designs until both were pinned here.
 */
export const TABLE_HEAD_HEIGHT = 48

/**
 * ONE table footer for the whole console (AGL-693).
 *
 * Zach: *"The table footer is not consistent."* It was not: layouts paged 5 at
 * a time, components and templates 10, the team list and the screens tree 25,
 * and the labels ranged from `Rows per page` to `Top-level screens per page`.
 * Three of those footers are MUI X `DataGrid`, two are a hand-rolled
 * `TablePagination`, and each had picked its own numbers — so the same control
 * offered a different menu depending on which list you were standing in.
 *
 * The options are the same everywhere BECAUSE they are arbitrary: nothing about
 * layouts makes 5 the right first page and 10 wrong. What is not arbitrary is
 * that a reader learns the control once.
 */
export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50]

/**
 * The default page size: THE SMALLEST OPTION, always.
 *
 * Zach: *"Make all paginated lists default to the minimum count … that goes
 * for all lists across the entire platform."* Derived from the options rather
 * than written as a number, so the rule survives the options changing — a
 * hardcoded default is how the console ended up with five different ones.
 *
 * It is also the cheaper default, and not only in pixels. A list whose
 * listener is bounded by its page size — layouts is one, `limit(pageSize)` —
 * reads exactly this many DOCUMENTS on load, so the smallest page is the
 * smallest bill (AGL-703). A reader who wants more says so once.
 *
 * ⚠️ The screens tree pages TOP-LEVEL screens and drag-to-reorder cannot cross
 * a page boundary — dnd-kit only knows about mounted rows. A smaller default
 * makes that limit reachable on a smaller site; see the pagination block in
 * `screens-hierarchy-table.component.tsx`.
 */
export const TABLE_PAGE_SIZE_DEFAULT = TABLE_PAGE_SIZE_OPTIONS[0]

/**
 * The label beside the size menu, on every list.
 *
 * Deliberately the generic noun even on the screens tree, which pages
 * TOP-LEVEL screens and carries each one's subtree along with it: that
 * distinction belongs in the count — see `labelDisplayedRows` there — and a
 * different label in the same slot reads as a different control.
 */
export const TABLE_ROWS_PER_PAGE_LABEL = 'Rows per page:'

/**
 * Canonical, published legal documents. These are hosted on the production
 * marketing site, not the console, so they are absolute cross-origin URLs
 * opened in a new tab — a full navigation, not in-SPA routing (hence a plain
 * anchor / MUI Link, not AppLink). Always point at production so users see the
 * canonical published terms from every env.
 *
 * ## The operator's own documents, when they have published some (AGL-2017)
 *
 * These were bare `https://aglyn.com/legal/*` literals, and this is the
 * clickwrap: a self-hosted console showed its users a checkbox agreeing to
 * **Aglyn LLC's** Terms and Privacy Policy, for a service Aglyn does not
 * provide. Reading `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` — the variable AGL-2016
 * already defined as "where YOUR published terms/privacy/DMCA pages live" —
 * points the links at whoever actually operates the deployment.
 *
 * ⚠️ THIS IS HALF THE FIX, and the other half is a decision rather than code.
 * `LEGAL_DOCUMENT_VERSION` and the `sha256`/`bytes` triples in
 * `./legal-documents` still identify AGLYN's document snapshots, so the
 * acceptance an operator records still names our bytes even while the link
 * shows theirs. Closing that means deciding what a self-host install should
 * record — the operator's own document identity, or an explicit "no platform
 * agreement" mode that skips the clickwrap — and that is a legal question, not
 * a refactor. AGL-2017 carries it, along with the trap: making the version
 * dynamic turns today's silent degrade into a 500, because
 * `recordLegalAcceptance` throws on a falsy version and the route returns 500.
 * Any dynamic source must keep a non-empty fallback.
 */
/**
 * ⚠️ IMPORTED, NOT READ AGAIN HERE (AGL-2014). This module carried its own
 * `process.env.NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN || 'https://aglyn.com'` —
 * byte-for-byte the same expression as `published-legal-pages.ts`, on the same
 * variable, with the same default. Two readers of one value is the shape
 * AGL-2195 removed for the tenant apex, and the risk is not that they disagree
 * today: it is that a later fix to one of them (a trailing-slash rule, a second
 * accepted name, an empty-string guard) reaches the clickwrap LINKS while
 * `isPublishedLegalUrl` — the gate that decides whether a publisher agreement
 * URL counts as published — goes on answering from the other. An operator's
 * legal origin cannot be honoured by the links and ignored by the gate.
 */
const LEGAL_ORIGIN = OPERATOR_LEGAL_ORIGIN

export const LEGAL_URLS = {
  TERMS: `${LEGAL_ORIGIN}/legal/terms`,
  PRIVACY: `${LEGAL_ORIGIN}/legal/privacy`,
}

/**
 * Published legal documents the console LINKS to but never asks anyone to
 * accept (AGL-2189).
 *
 * Deliberately separate from {@link LEGAL_URLS}, and the separation is
 * load-bearing rather than tidy. `LEGAL_URLS` is the CLICKWRAP manifest:
 * `legal-document-version.spec.ts` asserts its keys map one-to-one onto the
 * repo-committed snapshots under the `constants/legal` version folders,
 * because — in that
 * spec's words — "a link with no snapshot behind it is the original problem
 * wearing a manifest: the record would name a document it cannot reproduce."
 * The first draft of this change added these two to `LEGAL_URLS` and that
 * spec refused it, correctly.
 *
 * These two are published pages that are deliberately NOT acceptance-pinned
 * (see `./legal-documents`), so they carry no hash and cost no version bump.
 * That is exactly why they can be linked freely, and it is also why they were
 * missing: nothing forced anyone to notice them. The cost of the absence fell
 * on the one audience that needed them — an enterprise reviewer could reach
 * neither the DPA nor the subprocessor list from anywhere in the product,
 * while the trust page told them to email for documents already on a public
 * URL.
 */
export const LEGAL_REFERENCE_URLS = {
  DPA: `${LEGAL_ORIGIN}/legal/dpa`,
  SUBPROCESSORS: `${LEGAL_ORIGIN}/legal/subprocessors`,
}

// The version and content hashes of those documents live in
// `./legal-documents`, which imports LEGAL_URLS from here (AGL-1497).

/**
 * Where an Enterprise enquiry goes (AGL-1118). Enterprise is the one tier with
 * no list price and no self-serve checkout — its card links here instead of an
 * Upgrade button. Same posture as `LEGAL_URLS`: an absolute marketing-site URL
 * opened in a new tab, a full navigation rather than in-SPA routing.
 */
export const ENTERPRISE_CONTACT_URL = `${LEGAL_ORIGIN}/contact?plan=enterprise`

export const mainNavigation = [
  // {
  //   children: 'Features',
  // },
  // {
  //   children: 'Partners',
  //   items: [],
  // },
  // {
  //   children: 'Company',
  //   items: [],
  // },
  {
    children: 'Get Access',
    variant: 'contained',
    color: 'primary',
    href: '/contact',
  },
]
export const footerNavigation = [
  {
    children: 'Resources',
    items: [
      {
        children: 'Get access',
        href: '/contact',
      },
      {
        children: 'Features (coming soon)',
        href: '/features',
        disabled: true,
        'aria-disabled': true,
      },
    ],
  },
  {
    children: 'Company',
    items: [
      {
        children: 'Contact',
        href: '/contact',
      },
    ],
  },
  {
    children: 'Legal',
    items: [
      {
        children: 'Privacy',
        // Absolute, for the reason spelled out on `tailNavigation` below: a
        // console-relative `/legal/privacy` is a 404 here.
        href: LEGAL_URLS.PRIVACY,
        target: '_blank',
        rel: 'noopener',
      },
    ],
  },
]
/**
 * The console footer's links (AGL-2486).
 *
 * ## Both of the two it had were broken, and one of them silently
 *
 * They were written as CONSOLE-RELATIVE paths — `/contact` and
 * `/legal/privacy` — but the console serves neither. `/legal/privacy` was a
 * plain 404. `/contact` was worse: the console's top-level dynamic segment is
 * `[orgSlug]`, so the link resolved to a WORKSPACE named "contact" and
 * rendered a workspace page for an org that does not exist, titled
 * "contact · Aglyn". A 404 tells you the link is wrong; that does not.
 *
 * Every entry is therefore an ABSOLUTE url built from the operator's own
 * origins — `OPERATOR_LEGAL_ORIGIN` and `buildDocsUrl` — never a bare path.
 * A self-hosting operator serves their own legal pages and their own docs
 * (AGL-2091), and a footer that hardcoded ours would send their customers to
 * a company they have no relationship with. That is also why the two
 * commented-out entries below could never simply be uncommented: they had no
 * destination, and `href: '/'` is how they came to be commented out.
 *
 * ## Why these five
 *
 * Docs and Contact are the two a person actually looks in a footer for.
 * Terms and Privacy are the clickwrap pair every acceptance in the product
 * points at. The DPA is here because an enterprise reviewer could otherwise
 * reach it from nowhere in the console — the same absence
 * {@link LEGAL_REFERENCE_URLS} was created to close, which had fixed the
 * links inside the trust page and left the footer as it was.
 *
 * Deliberately NOT here: a status page. `status.aglyn.com` exists and is
 * documented, but it is ours, not an operator's, and there is no configured
 * origin for it — linking it unconditionally would be the self-host bug above
 * in a new place, and adding an env var nothing sets would be a link that
 * never appears. It wants an operator-status origin first.
 */
export const tailNavigation = [
  {
    children: 'Docs',
    /*
     * A GETTER, not a call at module scope (AGL-2486).
     *
     * `buildDocsUrl` lives in `docs-links`, which a dozen specs partially
     * `jest.mock` for `docsHelp` alone. Calling it while this module
     * evaluates therefore threw `buildDocsUrl is not a function` in every one
     * of them — four suites failed to run at all, and none of them is about
     * the footer. Deferring to first read means only a caller that actually
     * renders the footer needs the real module.
     *
     * Resolved through `buildDocsUrl` rather than re-reading
     * `NEXT_PUBLIC_DOCS_ORIGIN` here: `docs-links` documents at length what
     * happened when one docs origin acquired two env names, and a second
     * reader in this file is how the next one starts.
     */
    get href() {
      return buildDocsUrl('/')
    },
    target: '_blank',
    rel: 'noopener',
  },
  {
    children: 'Contact',
    href: `${LEGAL_ORIGIN}/contact`,
    target: '_blank',
    rel: 'noopener',
  },
  {
    children: 'Terms',
    href: LEGAL_URLS.TERMS,
    target: '_blank',
    rel: 'noopener',
  },
  {
    children: 'Privacy',
    href: LEGAL_URLS.PRIVACY,
    target: '_blank',
    rel: 'noopener',
  },
  {
    children: 'DPA',
    href: LEGAL_REFERENCE_URLS.DPA,
    target: '_blank',
    rel: 'noopener',
  },
]
