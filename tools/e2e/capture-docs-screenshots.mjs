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
