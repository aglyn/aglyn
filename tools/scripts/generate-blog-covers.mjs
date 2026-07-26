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

// Blog cover generator (AGL-826). Renders the aglyn-marketing blog post
// covers as PNGs, using the REAL Aglyn logo (inlined from the brand SVG)
// instead of a text lockup. Design: dark card, green radial glow, teal
// category eyebrow, big title, aglyn.com/blog footer + a category pill.
//
// Rendered with Playwright + system Chrome (same tooling as
// tools/e2e/capture-docs-screenshots.mjs) so fonts, gradients and the
// embedded logo SVG rasterize exactly as a browser would.
//
//   node tools/scripts/generate-blog-covers.mjs [--out=<dir>] [--only=<slug>]
//
// Output PNGs are written to <out> (default: a tmp dir printed on start);
// they are uploaded to the media library separately — this script only
// produces the images.

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// The white-text logo lockup (mark + "Aglyn" wordmark as vector paths) —
// reads crisp on the dark card regardless of installed fonts.
const LOGO_SVG = readFileSync(
  join(
    repoRoot,
    'apps/console/public/_static/images/brand/aglyn-logo-full-light.svg',
  ),
  'utf8',
)
  // Drop the XML prolog/doctype so it can be inlined into HTML.
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .trim()

const WIDTH = 1200
const HEIGHT = 630

/**
 * The blog posts on aglyn-marketing (host DXnRbPH4CQ, collection `blog`).
 * `eyebrow` is the category label; `pill` is the section badge.
 */
const POSTS = [
  {
    slug: 'survey',
    out: 'blogCoverSurvey.png',
    eyebrow: 'Datasets + Forms',
    title: 'Collect survey responses in 10 minutes',
    pill: 'Guides',
    accent: '#2dd4bf', // teal
  },
  {
    slug: 'megamenu',
    out: 'blogCoverMegamenu.png',
    eyebrow: 'Besigner Interactions',
    title: 'A hover mega menu, zero code',
    pill: 'Product',
    accent: '#8b7ff5', // violet
  },
  {
    slug: 'commerce',
    out: 'blogCoverCommerce.png',
    eyebrow: 'Storefront',
    title: 'One product page, two ways to buy',
    pill: 'Commerce',
    accent: '#e0a43a', // amber
  },
  {
    slug: 'members',
    out: 'blogCoverMembers.png',
    eyebrow: 'Member Accounts',
    title: 'Real accounts, not a mailing list',
    pill: 'Guides',
    accent: '#34d399', // emerald
  },
]

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** The cover markup for one post. */
function coverHtml(post) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  .cover {
    --accent: ${post.accent};
    position: relative;
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: #0b0d0f;
    font-family: 'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: #f3f5f6;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 60px 72px;
  }
  /* Solid accent disc, upper-right (dark tint of the post accent). */
  .disc {
    position: absolute;
    top: -140px;
    right: -120px;
    width: 560px;
    height: 560px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 34%,
      color-mix(in srgb, var(--accent) 26%, #0b0d0f) 0%,
      color-mix(in srgb, var(--accent) 15%, #0b0d0f) 62%,
      color-mix(in srgb, var(--accent) 9%, #0b0d0f) 100%);
  }
  /* Thin accent edge bar, full-height on the left. */
  .edge {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    width: 6px;
    background: var(--accent);
  }
  .row { position: relative; display: flex; align-items: center; }
  .brand { gap: 13px; }
  .brand .logo { height: 27px; display: flex; align-items: center; }
  .brand .logo svg { height: 27px; width: auto; display: block; }
  .brand .sep { color: #7d858c; font-size: 21px; font-weight: 500; letter-spacing: 0.2px; }
  .body { position: relative; }
  .eyebrow {
    color: var(--accent);
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 3.5px;
    text-transform: uppercase;
    margin-bottom: 24px;
  }
  .title {
    font-size: 62px;
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -1.2px;
    max-width: 860px;
    color: #f6f7f8;
  }
  .foot { position: relative; align-items: center; justify-content: space-between; }
  .domain { color: #6b7278; font-size: 21px; font-weight: 500; }
  .pill {
    border: 1.5px solid color-mix(in srgb, var(--accent) 70%, transparent);
    color: var(--accent);
    font-size: 17px;
    font-weight: 600;
    padding: 9px 22px;
    border-radius: 999px;
    letter-spacing: 0.2px;
  }
</style>
</head>
<body>
  <div class="cover">
    <div class="disc"></div>
    <div class="edge"></div>
    <div class="row brand">
      <span class="logo">${LOGO_SVG}</span>
      <span class="sep">· Blog</span>
    </div>
    <div class="body">
      <div class="eyebrow">${escapeHtml(post.eyebrow)}</div>
      <div class="title">${escapeHtml(post.title)}</div>
    </div>
    <div class="row foot">
      <span class="domain">aglyn.com/blog</span>
      <span class="pill">${escapeHtml(post.pill)}</span>
    </div>
  </div>
</body>
</html>`
}

// Chrome-flavor fallback, mirroring tools/e2e/capture-docs-screenshots.mjs.
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

const outDir =
  process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length) ??
  join(tmpdir(), 'aglyn-blog-covers')
const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)

mkdirSync(outDir, { recursive: true })
console.log(`Output dir: ${outDir}`)

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2, // crisp @2x
})

let count = 0
for (const post of POSTS) {
  if (only && post.slug !== only) continue
  const page = await context.newPage()
  try {
    await page.setContent(coverHtml(post), { waitUntil: 'networkidle' })
    // Let the web font settle so the title isn't captured mid-swap.
    await page
      .evaluate(() => document.fonts.ready)
      .catch(() => undefined)
    await page.waitForTimeout(400)
    const outPath = join(outDir, post.out)
    await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
    console.log(`COVER ${post.out}`)
    count += 1
  } catch (error) {
    console.error(`FAIL  ${post.out}: ${String(error?.message ?? error).split('\n')[0]}`)
  } finally {
    await page.close()
  }
}

await browser.close()
console.log(`\nGenerated ${count} cover${count === 1 ? '' : 's'} in ${outDir}`)
