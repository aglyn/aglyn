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

// Captures the docs-site console screenshots (1440×900 viewport PNGs
// under apps/docs/static/img/…) against the seeded local emulator stack
// — same prerequisites as tools/e2e/console.e2e.mjs (see
// docs/E2E_LOCAL.md):
//
//   1. npx -y firebase-tools@13 emulators:start --config firebase.e2e.json …
//   2. npm run seed:e2e
//   3. dev server with the emulator flags
//   4. E2E_BASE_URL=http://localhost:4210 node tools/e2e/capture-docs-screenshots.mjs
//
// Each shot waits for seeded content, strips the emulator warning
// banner and the Next dev indicator, and lets images/fonts settle.

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import {
  assertNoStaffOnlyChrome,
  installStaffOnlyChromeStyles,
  preflightStaffOnlyChrome,
} from './lib/staff-only-chrome.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const IMG_ROOT = join(repoRoot, 'apps/docs/static/img')

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
// Org-scoped routing (AGL-825): the console routes by /[orgSlug]/… and
// /[orgSlug]/hosts/[host]/… since the org cutover. HOST_BASE prefixes every
// host page; ORG_SLUG prefixes every org page. Defaults match seed-e2e.mjs
// (E2E_ORG_SLUG = 'e2e-bakery', host 'demo'). Host feature slugs that are
// plugin-provided (bookings, contacts, marketing, …) resolve through the
// host's [pluginSlug] route, so the same prefix covers them.
const ORG_SLUG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
const HOST = process.env.E2E_HOST ?? 'demo'
const HOST_BASE = `${ORG_SLUG}/hosts/${HOST}`
// Account fixtures the password shots target (AGL-921); both come from
// seed-e2e.mjs, which is also where their guard-relevant properties are set.
// Reusable component with declared props (AGL-1247), seeded by
// seed-e2e.mjs. The component besigner routes by /components/[id]/versions/
// [versionId]/besigner, so both ids are needed to open it.
const COMPONENT_ID = process.env.E2E_COMPONENT_ID ?? 'seed-marketing-cta'
const COMPONENT_VERSION_ID =
  process.env.E2E_COMPONENT_VERSION_ID ?? 'seed-marketing-cta-v1'
const TEAMMATE_UID = process.env.E2E_TEAMMATE_UID ?? 'e2e-teammate'
const NON_STAFF_UID = process.env.E2E_OWNER_UID ?? 'e2e-nonstaff-owner'
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 60_000)

/**
 * path → output file (under static/img) + the text to wait for.
 * `annotate` draws numbered badges + outlines around the located elements
 * before the shot (the legend lives in the docs page that embeds it).
 *
 * `actions` runs before the shutter: `click`, `hover`, `clickXY`,
 * `hoverXY`, `scroll`, `dblclickXY` (select-then-double-click, for the
 * canvas' in-place text editor), `fill: [selector, value]` and
 * `press: 'Key'`. A shot may also set its own `viewport`.
 * A step may carry only `settleMs`, which is how a shot waits for the
 * canvas to finish laying out before its first click.
 *
 * Run a subset with `--only=<out-substring>[,<out-substring>…]`.
 */
const shots = [
  {
    out: 'getting-started/console-dashboard.png',
    path: `/${HOST_BASE}`,
    waitFor: 'Demo Bakery',
  },
  {
    out: 'getting-started/console-chrome-annotated.png',
    path: `/${HOST_BASE}`,
    waitFor: 'Demo Bakery',
    annotate: [
      { rect: { x: 0, y: 0, width: 1440, height: 42 }, n: 1 },
      { locator: 'text=E2E Bakery Co', n: 2 },
      { rect: { x: 158, y: 46, width: 1274, height: 40 }, n: 3 },
      { locator: 'text=Demo Bakery', n: 4 },
      { rect: { x: 16, y: 300, width: 1408, height: 540 }, n: 5 },
    ],
  },
  {
    out: 'datasets/data-page.png',
    path: `/${HOST_BASE}/data`,
    waitFor: 'Avery Quinn',
  },
  {
    out: 'media/media-page.png',
    path: `/${HOST_BASE}/media`,
    waitFor: 'hero.jpg',
    // Let the thumbnail images finish loading.
    settleMs: 4000,
  },
  {
    out: 'content/content-page.png',
    path: `/${HOST_BASE}/content`,
    waitFor: 'Blog',
  },
  {
    out: 'bookings/bookings-page.png',
    path: `/${HOST_BASE}/bookings`,
    waitFor: 'Grace Hopper',
  },
  {
    out: 'contacts/contacts-page.png',
    path: `/${HOST_BASE}/contacts`,
    waitFor: 'wholesale@example.com',
  },
  {
    out: 'marketing-overlays/marketing-page.png',
    path: `/${HOST_BASE}/marketing`,
    waitFor: 'At a glance',
  },
  {
    out: 'workflows-and-actions/workflows-page.png',
    path: `/${HOST_BASE}/workflows`,
    waitFor: 'DozenQuote',
  },
  {
    out: 'workflows-and-actions/logic-page.png',
    path: `/${HOST_BASE}/logic`,
    waitFor: 'Reference health',
  },
  {
    out: 'billing-and-plans/billing-page.png',
    path: `/${ORG_SLUG}/billing`,
    waitFor: 'Manage payment methods',
  },
  {
    out: 'forms/inbox-page.png',
    path: `/${HOST_BASE}/inbox`,
    waitFor: 'Inbox',
  },
  {
    out: 'redirects/redirects-page.png',
    path: `/${HOST_BASE}/redirects`,
    waitFor: 'Redirects',
  },
  {
    out: 'plugins/marketplace-page.png',
    path: `/${HOST_BASE}/marketplace`,
    waitFor: 'Realm demo',
  },
  {
    out: 'plugins/org-plugins-page.png',
    path: `/${ORG_SLUG}/plugins`,
    waitFor: 'Plugins',
  },
  {
    out: 'teams-and-roles/org-team-page.png',
    path: `/${ORG_SLUG}/team`,
    waitFor: 'Invite',
  },
  {
    // Password card on a teammate's detail page (AGL-921). Targets the plain
    // teammate fixture rather than the owner: every other seeded account trips
    // one of the AGL-913 guards and renders the refusal instead of the form.
    out: 'teams-and-roles/team-member-password.png',
    path: `/${ORG_SLUG}/team/${TEAMMATE_UID}`,
    waitFor: 'Send password reset email',
    // The card sits below the member form, off a 900px viewport.
    actions: [{ scroll: 'text=Signs the account out everywhere' }],
  },
  {
    out: 'getting-started/org-settings-page.png',
    path: `/${ORG_SLUG}/settings`,
    waitFor: 'Workspace',
  },
  {
    out: 'getting-started/notifications-page.png',
    path: '/manage/notifications',
    waitFor: 'Notifications',
  },
  {
    out: 'analytics/analytics-page.png',
    path: `/${HOST_BASE}/analytics`,
    waitFor: 'Analytics',
  },
  {
    out: 'besigner/besigner-editor.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 8000,
  },
  {
    out: 'getting-started/sites-page.png',
    path: `/${ORG_SLUG}/hosts`,
    waitFor: 'Demo Bakery',
  },
  {
    out: 'getting-started/screens-list.png',
    // The bare `…/screens` is canonical; `…/screens/list` is a legacy alias
    // kept only so browsers holding a cached 308 land on a real page, and its
    // own header says it is safe to delete once those age out. Shooting the
    // alias would have turned that deletion into a silently failing shot.
    path: `/${HOST_BASE}/screens`,
    waitFor: 'Home',
    settleMs: 2500,
  },
  {
    out: 'teams-and-roles/host-users-page.png',
    path: `/${HOST_BASE}/users`,
    waitFor: 'Site users',
  },
  {
    // Password section inside the site member drawer (AGL-921). Opening the
    // drawer takes a click on the member row — there is no direct URL for it.
    out: 'guides/member-drawer-password.png',
    path: `/${HOST_BASE}/users`,
    waitFor: 'Site users',
    actions: [
      { click: 'text=visitor@aglyn.test', waitFor: 'Lifetime purchases' },
      { scroll: 'text=Or set a password directly' },
    ],
  },
  {
    out: 'custom-domains/setup-domains.png',
    path: `/${HOST_BASE}/setup`,
    waitFor: 'Custom domain',
    settleMs: 2500,
  },
  {
    // Error pages card (AGL-1599). The site-protection docs used to caption
    // the custom-domains shot of this same page as "where maintenance mode is
    // toggled" — right page, wrong card, and the toggle is nowhere in that
    // frame. Same scroll trick as setup-languages below, since Setup is one
    // long tab and only the top of it fits a 900px viewport.
    out: 'site-protection/setup-error-pages.png',
    path: `/${HOST_BASE}/setup`,
    waitFor: 'Custom domain',
    settleMs: 2500,
    actions: [{ scroll: 'text=Error pages', settleMs: 1000 }],
    // This used to clip the host tab strip away, because the staff capture
    // account rendered "⚑ CONTACTS" in it. The strip is back: the harness now
    // hides staff-only chrome everywhere and refuses to shoot when it can't
    // (AGL-1600), so the frame no longer has to be cropped around the leak —
    // and every other shot that was quietly carrying it is fixed too.
  },
  {
    // The ORG marketplace (AGL-975 retired the per-site tab, so `/hosts/…/
    // marketplace` is not the surface any more). The previous shot predated
    // both AGL-975 and AGL-1011: it still carried the pre-rename marketplace
    // heading, and its org strip had no Plugins tab. Quoting that old heading
    // here is what left the AGL-975 naming spec red — it reads every tracked
    // file, comments included.
    out: 'guides/marketplace-browse.png',
    path: `/${ORG_SLUG}/marketplace`,
    waitFor: 'Realm demo',
    settleMs: 2500,
  },
  {
    // The Page Access card — the image the SEO overview and the three
    // site-protection pages needed and never had. Its absence is why they
    // borrowed a screens-list shot and captioned it as the place visibility
    // is set (AGL-1599/AGL-1600).
    //
    // Menu OPEN: naming the four visibilities is the whole point of the
    // image, and a closed select shows exactly one of them.
    out: 'seo/page-access-visibility.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/view`,
    waitFor: 'Page Access',
    settleMs: 1200,
    actions: [
      {
        // The MUI label here is a <div>, not a <label>, so a `label:text-is`
        // scope silently matches nothing and the click lands on whatever
        // select happens to come first on the page.
        click:
          '.MuiFormControl-root:has(> .MuiInputLabel-root:text-is("Visibility")) [role="combobox"]',
        waitFor: 'Members only',
        settleMs: 800,
      },
    ],
    // The option list is a portal at the end of <body>, not a child of the
    // card, so it has to be named or the crop cuts it off.
    clipTo: {
      // `:text-is` on the title matches nothing — the header carries a help
      // link inside it, so its text is not exactly "Page Access".
      locator: '.MuiCard-root:has(> .MuiCardHeader-root:has-text("Page Access"))',
      include: ['[role="listbox"]'],
    },
  },
  {
    out: 'multilingual/setup-languages.png',
    path: `/${HOST_BASE}/setup`,
    waitFor: 'Custom domain',
    settleMs: 2500,
    actions: [{ scroll: 'text=Languages', settleMs: 1000 }],
  },
  {
    out: 'commerce/products-page.png',
    path: `/${HOST_BASE}/products`,
    waitFor: 'Products',
    settleMs: 2500,
  },
  {
    out: 'commerce/pos-page.png',
    path: `/${HOST_BASE}/pos`,
    waitFor: 'POS',
    settleMs: 2500,
  },
  {
    out: 'theme-builder/theme-editor.png',
    path: `/${HOST_BASE}/theme`,
    waitFor: 'Theme',
    settleMs: 6000,
  },
  {
    out: 'besigner/components-page.png',
    path: `/${HOST_BASE}/components`,
    waitFor: 'Components',
    settleMs: 2500,
  },
  {
    // Declared component properties (AGL-1247), in the component's own
    // besigner. The dialog is reachable only from File — there is no URL
    // for it — and the two rows come from the seeded `Marketing CTA`
    // fixture, whose `{{prop.*}}` tokens are visible on the canvas behind.
    out: 'besigner/component-properties-dialog.png',
    path: `/${HOST_BASE}/components/${COMPONENT_ID}/versions/${COMPONENT_VERSION_ID}/besigner`,
    waitFor: 'Properties',
    settleMs: 8000,
    actions: [
      // `text=File` would also match "Profile"/"File name" elsewhere in the
      // chrome; the menu button carries a stable id.
      { click: '#center-nav-file', settleMs: 800 },
      { click: 'text=Properties…', waitFor: 'Component properties' },
    ],
  },
  {
    // The instance side of the same feature: one Attributes field per
    // declared prop, the definition's defaults as placeholders, and the
    // "Defaults to …" helper under each. Selected from the Hierarchy panel
    // rather than the canvas, so the shot is about the right-hand panel.
    out: 'besigner/component-instance-attributes.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 6000,
    actions: [
      { click: 'text=Document', settleMs: 1200 },
      { click: 'text=Reusable Component', settleMs: 2000 },
    ],
  },
  {
    // AGL-1251: an instance renders its real content on the canvas, where
    // the page used to claim a dashed placeholder. HOVERED rather than
    // selected — the outline and the "Reusable Comp…" badge say which band
    // is the instance, while the empty Attributes panel keeps this shot
    // about the canvas and not about the panel the shot above owns.
    // Viewport coordinates, since the canvas is a closed shadow root.
    out: 'besigner/component-instance-on-canvas.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 6000,
    actions: [{ hoverXY: [610, 512], settleMs: 2500 }],
  },
  {
    out: 'staff-console/admin-orgs.png',
    path: '/admin/orgs',
    waitFor: 'Organizations',
  },
  {
    out: 'staff-console/admin-flags.png',
    path: '/admin/flags',
    waitFor: 'Release',
  },
  {
    out: 'staff-console/admin-audit.png',
    path: '/admin/audit',
    waitFor: 'Audit',
  },
  {
    // Password card on the staff user detail page (AGL-921). Points at the
    // non-staff owner: staff accounts are a case the page treats differently,
    // and the ordinary customer account is what support actually opens.
    out: 'staff-console/admin-user-password.png',
    path: `/admin/users/${NON_STAFF_UID}`,
    waitFor: 'Send password reset email',
    actions: [{ scroll: 'text=Signs the account out everywhere' }],
  },
  {
    out: 'plugins/plugin-reviews.png',
    path: '/admin/plugin-reviews',
    waitFor: 'Review',
  },
  {
    out: 'email-campaigns/campaigns-tab.png',
    path: `/${HOST_BASE}/emails`,
    waitFor: 'Welcome to the bakery',
    settleMs: 2500,
  },
  {
    out: 'marketing-overlays/experiments-tab.png',
    path: `/${HOST_BASE}/marketing`,
    waitFor: 'At a glance',
    actions: [
      { click: 'text=A/B testing', waitFor: 'Hero copy test' },
    ],
  },
  {
    out: 'besigner/hierarchy-panel.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 6000,
    actions: [{ click: 'text=Document', settleMs: 1200 }],
    clip: { x: 0, y: 88, width: 290, height: 520 },
  },
  {
    out: 'besigner/elements-drawer.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 6000,
    actions: [{ click: 'role=tab[name="Elements"]', settleMs: 1500 }],
    clip: { x: 0, y: 88, width: 290, height: 700 },
  },
  {
    out: 'besigner/canvas-selected.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 6000,
    actions: [
      // The canvas renders in a closed shadow root, so locators can't
      // reach the node — click the title's viewport coordinates instead.
      { clickXY: [560, 210], settleMs: 1500 },
    ],
  },
  {
    out: 'email-campaigns/email-editor.png',
    path: `/${HOST_BASE}/screens/seed-email-welcome/versions/seed-email-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 8000,
  },
  {
    out: 'besigner/besigner-annotated.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    settleMs: 8000,
    annotate: [
      { rect: { x: 0, y: 0, width: 1440, height: 46 }, n: 1 },
      { rect: { x: 0, y: 48, width: 1440, height: 38 }, n: 2 },
      { rect: { x: 0, y: 90, width: 288, height: 806 }, n: 3 },
      { rect: { x: 292, y: 90, width: 772, height: 806 }, n: 4 },
      { rect: { x: 1068, y: 90, width: 370, height: 806 }, n: 5 },
    ],
  },
  // ── The canvas work of the August 23 release (AGL-2486) ──────────────
  //
  // Four of these five STAGE the state they photograph instead of relying
  // on a seeded document: an interaction-state slice, a margin, and a bold
  // word are all things the seed does not carry, and adding them to
  // seed-e2e.mjs would put fixture state behind six other specs to serve
  // one picture. Staging them here also means the shot fails if the
  // feature stops working, which a seeded shape cannot tell you.
  //
  // The leading `{ settleMs: … }` action is deliberate: `waitFor:
  // 'Properties'` resolves when the PANEL mounts, and the canvas iframe is
  // still laying out for several seconds after that — a clickXY fired at
  // that moment lands on whatever is under the pointer mid-reflow.
  {
    out: 'besigner/state-chips-row.png',
    stagesDocument: true,
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    actions: [
      { settleMs: 9000 },
      // The seeded `Order now` button.
      { clickXY: [677, 305], settleMs: 1500 },
      { click: '[role="tab"]:has-text("STYLES")', settleMs: 2000 },
      // Give Focus a slice so a chip OTHER than the selected one carries
      // the • — otherwise the dot and the ✕ appear on the same chip and
      // the image cannot say which mark means what.
      { click: '.MuiChip-root:has-text("Focus")', settleMs: 1200 },
      { click: '[aria-label="Space inside — top"]', settleMs: 1200 },
      { click: '[role="combobox"]', settleMs: 1000 },
      { click: 'li.MuiMenuItem-root:has-text("Medium")', settleMs: 1500 },
      // …then Hover, on a different side so the click cannot toggle the
      // already-open editor shut instead of opening one.
      { click: '.MuiChip-root:has-text("Hover")', settleMs: 1200 },
      { click: '[aria-label="Space inside — bottom"]', settleMs: 1200 },
      { click: '[role="combobox"]', settleMs: 1000 },
      { click: 'li.MuiMenuItem-root:has-text("Hairline")', settleMs: 1500 },
    ],
    clipTo: {
      locator: '.MuiChip-root:has-text("Styling: all screen sizes")',
      // The hold banner is what gives the crop the panel's full width, and
      // it is also the bottom of the frame: the section is about the two
      // chip rows and the preview they turn on.
      include: ['.MuiAlert-root'],
    },
  },
  {
    out: 'besigner/box-styler-diagram.png',
    stagesDocument: true,
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    actions: [
      { settleMs: 9000 },
      // The hero Stack, which the seed gives `py: 8` — so padding top and
      // bottom already read back as `64px` rather than as a step number.
      { clickXY: [677, 350], settleMs: 1500 },
      { click: '[role="tab"]:has-text("STYLES")', settleMs: 2000 },
      // Margin the seed does not have, so the diagram shows a value in the
      // outer ring as well as the inner one.
      { click: '[aria-label="Space outside — top"]', settleMs: 1200 },
      { click: '[role="combobox"]', settleMs: 1000 },
      { click: 'li.MuiMenuItem-root:has-text("Large")', settleMs: 1500 },
      // Land on a padding side, so the open editor below the diagram is
      // the one whose side already has a value.
      { click: '[aria-label="Space inside — top"]', settleMs: 1800 },
    ],
    clipTo: {
      locator: 'text=Apply to',
      include: [
        '.MuiToggleButtonGroup-root:has-text("SIDE")',
        '.BoxStyler-legendItem.BoxStyler-contents',
      ],
    },
  },
  {
    out: 'besigner/inline-text-editing.png',
    stagesDocument: true,
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    actions: [
      { settleMs: 9000 },
      { dblclickXY: [620, 205], settleMs: 2500 },
    ],
    // A static box, not a clipTo: everything this shot is about lives in
    // the canvas' closed shadow root, where no locator reaches. The frame
    // keeps the paragraph and the button under the heading, because the
    // point is the text sitting on the page with no chrome around it —
    // crop to the heading alone and there is nothing for the absence of
    // chrome to show against.
    clip: { x: 316, y: 128, width: 740, height: 240 },
  },
  {
    out: 'besigner/text-field-read-only.png',
    stagesDocument: true,
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    actions: [
      { settleMs: 9000 },
      { dblclickXY: [620, 205], settleMs: 2500 },
      // Bold the last word — `morning` — so the element carries real
      // formatting rather than being formatted-flagged by fixture data.
      { press: 'Shift+Alt+ArrowLeft', settleMs: 800 },
      { click: 'button[title="Bold"]', settleMs: 1200 },
      { click: 'button:has-text("DONE")', settleMs: 3000 },
    ],
    // No callout: the crop holds the button, the field and the helper line
    // and nothing else, and an outline drawn round the button overprints
    // the field's `Text` legend a few pixels below it.
    clipTo: {
      locator: 'text=Remove formatting',
      include: ['text=This text is formatted'],
    },
  },
  // ── Release documentation (AGL-1950, specs A1–A16) ──────────────────
  //
  // Only the shots that can actually be staged are here. The rest are
  // recorded as unfilled in SCREENSHOT_PLAN.md with the reason — the
  // billing ones need a Stripe customer the seeded org does not have,
  // three need fixtures the seed does not carry, and A15 is on a release
  // flag that is still off. A spec whose surface cannot be reached is not
  // a shot waiting to be run; it is a shot that would have to be faked.
  //
  // Several selectors below differ from the pasted specs because the
  // surfaces moved between 2026-08-18 and now. Each difference is noted
  // in the plan next to the spec it corrects.
  {
    // A3. The funnel is four separate shots rather than one chain: a chain
    // that fails halfway leaves you guessing which step broke. Every step
    // up to the last is client-side, which is why these are capturable at
    // all while A1/A2 are not.
    out: 'billing-and-plans/retention-survey.png',
    path: `/${ORG_SLUG}/billing`,
    waitFor: 'Current plan',
    actions: [
      { click: 'button:has-text("Cancel subscription")', settleMs: 2000 },
    ],
    clipTo: { locator: '[role="dialog"]' },
  },
  {
    // A4. The reason is picked by VALUE, not by its label: the labels use
    // a typographic apostrophe ("It’s too expensive") that no plain-quote
    // selector matches.
    out: 'billing-and-plans/retention-downsell.png',
    path: `/${ORG_SLUG}/billing`,
    waitFor: 'Current plan',
    actions: [
      { click: 'button:has-text("Cancel subscription")', settleMs: 2000 },
      { click: '[role="dialog"] input[type="radio"][value="too_expensive"]', settleMs: 400 },
      { click: '[role="dialog"] button:has-text("Continue")', settleMs: 3000 },
    ],
    clipTo: { locator: '[role="dialog"]' },
  },
  {
    // A5. One winback per organization, ever — but only ACCEPTING it
    // spends the offer; reaching the step does not, which is what makes
    // this repeatable. Never click "Apply the discount" here.
    out: 'billing-and-plans/retention-winback.png',
    path: `/${ORG_SLUG}/billing`,
    waitFor: 'Current plan',
    actions: [
      { click: 'button:has-text("Cancel subscription")', settleMs: 2000 },
      { click: '[role="dialog"] input[type="radio"][value="too_expensive"]', settleMs: 400 },
      { click: '[role="dialog"] button:has-text("Continue")', settleMs: 3000 },
      { click: '[role="dialog"] button:has-text("No thanks")', settleMs: 3000 },
    ],
    clipTo: { locator: '[role="dialog"]' },
  },
  {
    // A6. The last step this run is allowed to reach. `Yes, cancel` ends a
    // subscription; nothing here clicks it.
    out: 'billing-and-plans/retention-confirm.png',
    path: `/${ORG_SLUG}/billing`,
    waitFor: 'Current plan',
    actions: [
      { click: 'button:has-text("Cancel subscription")', settleMs: 2000 },
      { click: '[role="dialog"] input[type="radio"][value="too_expensive"]', settleMs: 400 },
      { click: '[role="dialog"] button:has-text("Continue")', settleMs: 3000 },
      { click: '[role="dialog"] button:has-text("No thanks")', settleMs: 3000 },
      { click: '[role="dialog"] button:has-text("No thanks")', settleMs: 3000 },
    ],
    clipTo: { locator: '[role="dialog"]' },
  },
  {
    // A9. Opening the dialog writes nothing — the key is only created on
    // submit, which this never presses. The scope list is THIRTEEN rows
    // now, not the eight the spec was written against, and at 1440×900 the
    // dialog runs off the bottom of the window; the taller viewport is
    // what keeps `Media — upload` and the Create button in frame.
    out: 'api/create-key-scopes.png',
    path: `/${ORG_SLUG}/settings`,
    waitFor: 'API keys',
    viewport: { width: 1440, height: 1500 },
    actions: [
      { click: 'text=API keys', settleMs: 3000 },
      { click: 'button:has-text("Create API key")', settleMs: 2500 },
      { fill: ['[role="dialog"] input[type="text"]', 'zapier-orders-sync'], settleMs: 300 },
      // No click on `Datasets — read`: the dialog opens with it already
      // ticked, which is the state the spec asks for. Clicking it, as the
      // spec's prose implies, turns it OFF — the first run of this shot
      // published an unticked box for exactly that reason.
    ],
    clipTo: { locator: '[role="dialog"]' },
  },
  {
    // A8 (AGL-1950). Needs `tools/e2e/seed-docs-fixtures.mjs` — the base seed
    // carries no API keys and the card's whole subject is a populated list.
    //
    // The settings page is a TAB STRIP whose panels all stay MOUNTED, hidden.
    // So `waitFor: 'API keys'` matches immediately, on text nobody can see,
    // and the earlier spec's `scroll` could never reveal it. The click is what
    // makes the panel visible; the `clipTo` is what proves it, because a
    // display:none element has no bounding box and the harness fails the shot
    // rather than cropping to whatever else was in the union.
    out: 'api/api-keys-card.png',
    path: `/${ORG_SLUG}/settings`,
    waitFor: 'API keys',
    actions: [{ click: 'text=API keys', settleMs: 3000 }],
    settleMs: 2000,
    // NO `annotate`, and the reason generalises to every card-with-left-
    // aligned-rows in this file. The badge is drawn at (x−14, y−14) of its
    // target, which on a dialog lands in the backdrop but on a table row lands
    // ON the content immediately left of it. Annotated, this shot published a
    // ② sitting across the very key prefix it was pointing at and a ③ over
    // `Created`. Annotate what a reader would otherwise hunt for; a card
    // cropped to eight lines is not that.
    clipTo: {
      locator: '.MuiCard-root:has(> .MuiCardHeader-root:has-text("API keys"))',
    },
  },
  {
    // A11 (AGL-1950). Needs the seeded site collaborator.
    //
    // The card header is `Organization members — E2E Bakery Co`, not the
    // `Members` the spec names; the locator still matches because Playwright's
    // `has-text` is a case-insensitive substring, but do not "fix" it to
    // `:text-is()`. The access cells are the content: `ALL SITES` against the
    // two managers and `1 SITE(S)` against the collaborator, each over its
    // `Team manager` / `Site collaborator` caption.
    out: 'guides/team-managers-vs-collaborators.png',
    path: `/${ORG_SLUG}/team`,
    waitFor: 'Organization members',
    // The card runs past 900px once a third member is in it, and a clip is
    // clamped to the viewport — the seat line callout is the first thing lost.
    viewport: { width: 1440, height: 1300 },
    settleMs: 2500,
    // No `annotate` — see the note on A8. Here it was worse than untidy: the
    // seat-line badge covered the `2` in `2 of 15 manager seats used`, which
    // is the number callout ③ existed to point at, and the `All sites` badge
    // resolved to nothing at all and left the numbering starting at ②.
    clipTo: {
      locator: '.MuiCard-root:has(> .MuiCardHeader-root:has-text("Members"))',
    },
  },
  {
    // A12 (AGL-1950). The spec's surface is GONE: `/{host}/setup` has no
    // Members card (Basic details · SEO · Theme · Custom domain · Emails ·
    // Activity). Per-site access is granted from the ORG Team page instead,
    // by the inline invite row whose `All sites` checkbox is unticked to scope
    // the invite to named sites — so this is re-pointed rather than dropped.
    //
    // The control is the ACCESS DIALOG, not the invite row's checkbox. The
    // first attempt shot the row with `All sites` unticked and produced a
    // near-duplicate of A11 with an empty box in it: unticking there reveals
    // no site list, so the image showed the absence of org-wide access and
    // nothing about per-site scoping. The dialog behind the `1 site(s)` /
    // `All sites` button is where `orgHosts` is actually enumerated, one row
    // per site with its own role — which is the thing the guide describes.
    out: 'guides/site-members-invite.png',
    path: `/${ORG_SLUG}/team`,
    waitFor: 'Organization members',
    viewport: { width: 1440, height: 1300 },
    // The seeded collaborator's own access, so the dialog opens already
    // scoped — `All sites` off and one of the two seeded sites ticked.
    actions: [{ click: 'button:has-text("1 site(s)")', settleMs: 1800 }],
    settleMs: 1500,
    clipTo: { locator: '[role="dialog"]' },
  },
  {
    // A13 (AGL-1950). Needs the seeded charged-back order.
    //
    // Route correction: `/{host}/commerce/orders` 404s. Orders are a TAB of
    // the commerce plugin page, selected by `?tab=orders` — `HubTabs` seeds
    // its state from that param.
    //
    // The row carries the entire distinction the docs page draws, so no
    // detail dialog is needed: `$0.00` over `$62.00 less refunds` in the
    // Total column, and the `Charged back` chip BESIDE the untouched
    // `Refunded` status chip. A lost dispute is a refund the merchant did not
    // choose, and one row says so.
    out: 'commerce/order-charged-back.png',
    path: `/${HOST_BASE}/products?tab=orders`,
    waitFor: 'Charged back',
    settleMs: 2500,
    // No `annotate`, and this one was actively misleading rather than merely
    // untidy: the badge for the `Charged back` chip is drawn up and to its
    // left, which is exactly where the `Refunded` chip sits — so callout ①
    // for the chargeback landed on the refund, marking the one thing the
    // image exists to distinguish it FROM. The ② over `$62.00 less refunds`
    // ate the `$6`.
    clipTo: {
      locator: '.MuiCard-root:has([aria-label="Orders"])',
    },
  },
  {
    // A16. The help tip is `Help: Moving to a lower plan takes effect
    // later`, not the `Help: Downgrading` the spec guessed. The disclosure
    // sits well below the fold once expanded, so it is scrolled into view
    // before the hover — a clip box is clamped to the viewport, and an
    // element below it resolves to a sliver.
    out: 'billing-and-plans/lower-tiers-expanded-tip.png',
    path: `/${ORG_SLUG}/billing`,
    waitFor: 'Current plan',
    actions: [
      { click: 'text=/Looking for something smaller/i', settleMs: 1500 },
      { scroll: 'button[aria-expanded="true"]', settleMs: 800 },
      { hover: '[aria-label^="Help: Moving to a lower plan"]', settleMs: 1200 },
    ],
    // The stack the spec named spans the full page width, so cropping to
    // it caught the Enterprise card sitting to the right of the tip and
    // nothing the section is about. The lower-tier cards are ABOVE this
    // control, not beneath it as the spec assumed, so there is no crop
    // that holds both them and the tooltip at a readable size.
    clipTo: {
      locator: '[role="tooltip"]',
      include: ['button[aria-expanded="true"]'],
      padding: 16,
    },
  },
  {
    out: 'besigner/element-search-best-matches.png',
    path: `/${HOST_BASE}/screens/seed-home/versions/seed-home-v1/besigner`,
    waitFor: 'Properties',
    actions: [
      { settleMs: 9000 },
      { click: '[role="tab"]:has-text("ELEMENTS")', settleMs: 2000 },
      { fill: ['input[placeholder="Search elements"]', 'grid'], settleMs: 2500 },
    ],
    // The Elements panel is a fixed-width column, so a static box is
    // stable here in a way it would not be beside a growing card.
    clip: { x: 0, y: 137, width: 288, height: 452 },
  },
]

// Chrome-flavor fallback, mirroring tools/e2e/console.e2e.mjs: the first
// installed flavor wins so a Chrome update/uninstall can't break captures.
function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) {
    return { executablePath: process.env.E2E_CHROME_PATH }
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const executablePath of candidates) {
      try {
        readFileSync(executablePath)
        return { executablePath }
      } catch {
        // Not installed — try the next flavor.
      }
    }
  }
  return { channel: 'chrome' }
}

// `--only=` takes a comma-separated list of `out` substrings, so re-shooting
// a scattered handful of images is one signed-in run rather than one per
// image.
const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean)
const selected = only?.length
  ? shots.filter((shot) => only.some((part) => shot.out.includes(part)))
  : shots
if (!selected.length) {
  console.error(`No shots match --only=${only?.join(',')}`)
  process.exit(1)
}

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})
// E2E_TIMEOUT_MS governed only the explicit waits below, leaving every
// action on Playwright's 30s default. Against a cold dev server that is the
// sign-in form losing the race with its own first client compile, which
// surfaced as a bare `page.fill: Timeout 30000ms exceeded` on the email
// field rather than anything pointing at compilation.
context.setDefaultTimeout(TIMEOUT_MS)
context.setDefaultNavigationTimeout(TIMEOUT_MS)

// The AGL-663 pre-permission prompt arms itself 2.5s after mount, on every
// page — and re-arms on every remount. Deleting it from the DOM after the
// fact (stripChrome, below) was a race it kept winning: any shot with a
// click, a scroll or a long settle caught it on the way back in, which is
// how a dozen docs screenshots ended up with "Enable notifications" sitting
// in the middle of them. Write the dismissal the component persists for
// itself instead, before any app code runs, so the dialog never mounts at
// all. Key and value mirror apps/console/components/notification-prompt.
await context.addInitScript(() => {
  try {
    window.localStorage.setItem('aglyn:notification-prompt-dismissed', 'never')
  } catch {
    // Storage blocked — stripChrome() stays as the backstop.
  }
})

// The capture account is STAFF (see the account shape in
// apps/docs/CONTRIBUTING.md), so the console it renders is not the console a
// customer has: release-flagged-OFF tabs stay, badged. Hide them from the
// first paint of every page, and refuse any shot that still shows one
// (AGL-1600).
await installStaffOnlyChromeStyles(context)

// Sign in through the real UI once (see console.e2e.mjs for why).
{
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"], button:has-text("Next")')
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), {
    timeout: TIMEOUT_MS,
  })
  await page.close()
}

// Pre-warm the routes so dev-server compiles don't distort waits — the
// selected ones only, so a re-capture of a handful of shots doesn't pay for
// compiling all fifty. The host dashboard is warmed unconditionally: the
// staff-only guard below opens it, and a cold compile there is a minute of
// navigation timeout blamed on the guard.
for (const path of [`/${HOST_BASE}`, ...selected.map((shot) => shot.path)]) {
  await fetch(`${BASE_URL}${path}`).catch(() => undefined)
}

// Prove the guard can still see what it is meant to hide before shooting
// anything — "nothing staff-only is showing" is also what a guard that
// matches nothing at all reports.
{
  const page = await context.newPage()
  const hidden = await preflightStaffOnlyChrome(page, {
    url: `${BASE_URL}/${HOST_BASE}`,
    waitFor: 'Demo Bakery',
    timeout: TIMEOUT_MS,
  }).catch((error) => error)
  await page.close()
  if (hidden instanceof Error) {
    console.error(String(hidden.message))
    await browser.close()
    process.exit(1)
  }
  console.log(`GUARD staff-only chrome hidden: ${hidden.join(', ')}`)
}

/** Draw a numbered badge + outline over each located element. */
async function annotate(page, marks) {
  for (const mark of marks) {
    const box =
      mark.rect ??
      (await page
        .locator(mark.locator)
        .first()
        .boundingBox()
        .catch(() => null))
    if (!box) {
      console.warn(`  no box for annotation ${mark.n} (${mark.locator})`)
      continue
    }
    await page.evaluate(
      ([b, n]) => {
        const outline = document.createElement('div')
        outline.style.cssText =
          `position:fixed;left:${b.x - 3}px;top:${b.y - 3}px;` +
          `width:${b.width + 6}px;height:${b.height + 6}px;` +
          'border:3px solid #e040fb;border-radius:6px;z-index:99998;' +
          'pointer-events:none;box-shadow:0 0 0 2px rgba(255,255,255,0.7);'
        const badge = document.createElement('div')
        badge.textContent = String(n)
        badge.style.cssText =
          `position:fixed;left:${Math.max(2, b.x - 14)}px;` +
          `top:${Math.max(2, b.y - 14)}px;width:28px;height:28px;` +
          'border-radius:50%;background:#e040fb;color:#fff;z-index:99999;' +
          'display:flex;align-items:center;justify-content:center;' +
          'font:700 15px Roboto,sans-serif;pointer-events:none;' +
          'box-shadow:0 1px 4px rgba(0,0,0,0.4);'
        document.body.append(outline, badge)
      },
      [box, mark.n],
    )
  }
}

// Where the besigner keeps SHARED unsaved state. A shot that stages a
// document change (an interaction-state slice, a margin, a bold word)
// never saves it — but the co-editing mirror publishes it anyway, and the
// NEXT editor load restores it, because that state is deliberately not
// per-tab (AGL-2486). Two staged shots in one run therefore photograph
// each other: the first version of `inline-text-editing.png` came out
// 32px low because the box-styler shot had left a margin behind.
const RTDB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? 'localhost:9000'
const RTDB_NS = process.env.E2E_RTDB_NS ?? 'aglyn-main-default-rtdb'

/**
 * Drops the co-editing mirror, so a staged shot opens the SEEDED document.
 *
 * Throws rather than warning: a silently un-cleared mirror produces a
 * plausible image of the wrong thing, which is the one outcome a docs
 * capture must not have. `owner` is the emulator's admin bearer token —
 * the mirror's rules deny an unauthenticated delete.
 */
async function clearCoEditMirror() {
  const response = await fetch(
    `http://${RTDB_HOST}/coedit.json?ns=${RTDB_NS}`,
    { method: 'DELETE', headers: { Authorization: 'Bearer owner' } },
  )
  if (!response.ok) {
    throw new Error(
      `co-edit mirror not cleared (${response.status}) at ${RTDB_HOST}`,
    )
  }
}

let failures = 0
/**
 * Removes what the docs must never show: the auth-emulator warning banner,
 * Next's dev indicator, and — as a backstop to the seeded dismissal above —
 * the AGL-663 notification pre-permission modal.
 *
 * Called both after the page settles AND again just before the shutter, so
 * the backstop still covers a modal that appears on a delay.
 */
async function stripChrome(page) {
  // Not for docs: the auth-emulator warning banner and Next's dev
  // indicator/error badge.
  await page.evaluate(() => {
    for (const selector of [
      '.firebase-emulator-warning',
      'nextjs-portal',
      '#__next-build-watcher',
      '[data-nextjs-toast]',
    ]) {
      document.querySelectorAll(selector).forEach((el) => el.remove())
    }
    // AGL-663 notification pre-permission modal overlays the page — drop
    // it (and its backdrop) so shots capture the content beneath.
    let removedModal = false
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (/notification/i.test(dialog.textContent ?? '')) {
        ;(dialog.closest('.MuiModal-root') ?? dialog).remove()
        removedModal = true
      }
    }
    if (removedModal) {
      document
        .querySelectorAll('.MuiBackdrop-root')
        .forEach((el) => el.remove())
    }
  })
}

/**
 * The clip box for a `clipTo` shot: the union of the located elements, padded.
 *
 * A component-level crop written as static pixels is a crop that silently
 * starts cutting the card in half the next time the surface above it grows a
 * row. `include` is for the parts that live outside the element in the DOM —
 * a MUI select's option list is a portal at the end of <body>, not a child of
 * the card it belongs to.
 */
async function resolveClipTo(page, clipTo) {
  const { locator, include = [], padding = 12 } = clipTo
  const boxes = []
  for (const selector of [locator, ...include]) {
    const box = await page
      .locator(selector)
      .first()
      .boundingBox()
      .catch(() => null)
    // A missed `include` is a quietly cropped-off popover, and a missed
    // `locator` is a shot of whatever else happened to be in the union — both
    // fail the shot rather than producing a plausible wrong image.
    if (!box) throw new Error(`clipTo matched nothing: ${selector}`)
    boxes.push(box)
  }
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - padding)
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - padding)
  const right = Math.min(
    viewport.width,
    Math.max(...boxes.map((b) => b.x + b.width)) + padding,
  )
  const bottom = Math.min(
    viewport.height,
    Math.max(...boxes.map((b) => b.y + b.height)) + padding,
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}

for (const shot of selected) {
  const page = await context.newPage()
  try {
    // A taller window for a surface that is genuinely taller than 900px.
    // `clip` is clamped to the viewport, so a dialog that overflows gets
    // silently cropped rather than scrolled — and a crop that drops the
    // last rows of a scope list is the exact failure the plan calls out.
    if (shot.viewport) await page.setViewportSize(shot.viewport)
    if (shot.stagesDocument) {
      await clearCoEditMirror()
      // …and the PRIVATE half of the same unsaved state. Every shot in a
      // run shares one browser context, so the crash-recovery draft the
      // previous staged shot wrote is same-origin localStorage waiting to
      // be restored — the mirror alone is only half the leak.
      await page.addInitScript(() => {
        try {
          for (const key of Object.keys(window.localStorage)) {
            if (key.startsWith('aglyn:draft:')) {
              window.localStorage.removeItem(key)
            }
          }
        } catch {
          // Storage blocked — nothing to restore from either.
        }
      })
    }
    await page.goto(`${BASE_URL}${shot.path}`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    })
    await page.waitForSelector(`text=${shot.waitFor}`, { timeout: TIMEOUT_MS })
    await stripChrome(page)
    for (const action of shot.actions ?? []) {
      // frame: true targets the canvas iframe (the besigner viewport).
      const scope = action.frame ? page.frameLocator('iframe') : page
      if (action.scroll) {
        await scope.locator(action.scroll).first().scrollIntoViewIfNeeded()
      }
      if (action.clickXY) {
        await page.mouse.click(action.clickXY[0], action.clickXY[1])
      }
      // The canvas is a closed shadow root, so the in-place text editor can
      // only be opened by pointer coordinates. It also wants the element
      // SELECTED first: a double-click on an unselected element selects it
      // and stops there, which reads as "double-click does nothing" and is
      // why this is a distinct action rather than two clickXY entries.
      if (action.dblclickXY) {
        await page.mouse.click(action.dblclickXY[0], action.dblclickXY[1])
        await page.waitForTimeout(action.selectMs ?? 1200)
        await page.mouse.dblclick(action.dblclickXY[0], action.dblclickXY[1])
      }
      if (action.fill) {
        await scope.locator(action.fill[0]).first().fill(action.fill[1])
      }
      if (action.press) await page.keyboard.press(action.press)
      // Hover the canvas without selecting: the besigner outlines and names
      // the element under the pointer, which is how a shot can say "this
      // band is the instance" while the Attributes panel stays empty. Two
      // moves, because a single move to a fresh page fires no `mousemove`
      // transition and the outline never appears.
      if (action.hoverXY) {
        const [x, y] = action.hoverXY
        await page.mouse.move(x, y - 32)
        await page.mouse.move(x, y)
      }
      // Hover by selector, for the tooltips whose whole subject is the
      // tip. `hoverXY` above is the canvas' version, where no locator can
      // reach the element.
      if (action.hover) await scope.locator(action.hover).first().hover()
      if (action.click) await scope.locator(action.click).first().click()
      if (action.waitFor) {
        await page.waitForSelector(`text=${action.waitFor}`, {
          timeout: TIMEOUT_MS,
        })
      }
      await page.waitForTimeout(action.settleMs ?? 800)
    }
    await page.waitForTimeout(shot.settleMs ?? 1500)
    // The notification modal can drift back in during the settle above.
    await stripChrome(page)
    // Last gate before the shutter: nothing only staff can see (AGL-1600).
    await assertNoStaffOnlyChrome(page, shot.out)
    if (shot.annotate) await annotate(page, shot.annotate)
    const clip = shot.clipTo
      ? await resolveClipTo(page, shot.clipTo)
      : shot.clip
    const outPath = join(IMG_ROOT, shot.out)
    mkdirSync(dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath, ...(clip ? { clip } : {}) })
    console.log(`SHOT  ${shot.out}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL  ${shot.out}: ${String(error?.message ?? error).split('\n')[0]}`)
  } finally {
    await page.close()
  }
}

await browser.close()
console.log(failures ? `\n${failures} shots failed` : `\nAll ${selected.length} shots captured`)
process.exit(failures ? 1 : 0)
