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

// Builds the root README's two designed images from a real capture
// (AGL-3319): the banner `docs/assets/readme/cover.png` (1800×375) and the
// GitHub social preview `docs/assets/readme/social-preview.png` (1280×640).
//
// Both used to picture a drawn mockup of the Besigner. They now frame the
// capture `capture-docs-screenshots.mjs` writes to
// `docs/assets/readme/besigner-editor.png`, so re-running the harness and then
// this script is all a refresh takes:
//
//   node tools/e2e/render-readme-composites.mjs
//
// Rendered by headless Chrome from a small HTML page, never by ImageMagick:
// ImageMagick draws the logo SVGs with a stroke their root style carries, and
// the wordmark comes out heavier than the artwork. The wordmark is the colored
// lockup for light backgrounds, `aglyn-logo-full-dark.svg`
// (docs/BRAND_ASSETS.md).
//
// The social preview is not served from the repository: GitHub reads it from
// the repo settings, where somebody uploads this file by hand.
//
// It also draws the example plugin's README image,
// `examples/plugins/promo-countdown/promo-countdown.png`: the bundle's own
// `render()` run in both schemes, with the props its README configures. That
// is the contract the plugin origin's loader calls
// (tools/plugin-loader/README.md). The console slot itself cannot be staged
// locally — marketplace bundles load from a separate plugin origin, and a
// console without NEXT_PUBLIC_PLUGIN_ORIGIN runs none of them.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { optimizePng } from './lib/optimize-png.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const README_ASSETS = join(repoRoot, 'docs/assets/readme')

const logo = readFileSync(
  join(repoRoot, 'apps/console/public/_static/images/brand/aglyn-logo-full-dark.svg'),
  'utf8',
)
const capture = `data:image/png;base64,${readFileSync(
  join(README_ASSETS, 'besigner-editor.png'),
).toString('base64')}`

/** The page both images share: the brand's light field and its two glows. */
const page = ({ width, height, body, css }) => `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;700&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    position: relative;
    font-family: Raleway, sans-serif;
    color: #1d2230;
    background:
      radial-gradient(circle at 8% 100%, rgba(224, 64, 251, 0.10), transparent 34%),
      radial-gradient(circle at 92% 0%, rgba(0, 176, 255, 0.16), transparent 42%),
      #f5f7fa;
  }
  .logo svg { display: block; width: 100%; height: auto; }
  .window {
    position: absolute;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid rgba(29, 34, 48, 0.10);
    background: #fff;
    box-shadow: 0 30px 60px -20px rgba(29, 34, 48, 0.28), 0 8px 18px rgba(29, 34, 48, 0.08);
  }
  .window img { display: block; width: 100%; height: auto; }
  ${css}
</style></head>
<body>${body}</body></html>`

const composites = [
  {
    out: 'cover.png',
    width: 1800,
    height: 375,
    css: `
      .logo { position: absolute; left: 100px; top: 92px; width: 206px; }
      h1 { position: absolute; left: 96px; top: 196px; font-size: 34px; font-weight: 700; letter-spacing: -0.5px; }
      p { position: absolute; left: 96px; top: 248px; font-size: 19px; color: #4a5160; }
      .window { left: 1160px; top: 60px; width: 760px; }`,
    body: `
      <div class="logo">${logo}</div>
      <h1>One platform. Zero black boxes.</h1>
      <p>Design, ship, and run your entire web presence from one place — open source, self-hostable.</p>
      <div class="window"><img src="${capture}" alt=""></div>`,
  },
  {
    out: 'social-preview.png',
    width: 1280,
    height: 640,
    css: `
      .logo { position: absolute; left: 76px; top: 76px; width: 170px; }
      h1 { position: absolute; left: 72px; top: 206px; font-size: 58px; line-height: 1.08; font-weight: 700; letter-spacing: -1px; }
      p { position: absolute; left: 72px; top: 360px; width: 500px; font-size: 21px; line-height: 1.35; color: #4a5160; }
      .chips { position: absolute; left: 72px; top: 460px; display: flex; gap: 10px; }
      .chips span { padding: 6px 14px; border-radius: 999px; background: #fff; border: 1px solid rgba(29, 34, 48, 0.12); font-size: 16px; font-weight: 500; }
      .url { position: absolute; left: 72px; top: 570px; font-size: 19px; color: #6b7280; }
      .window { left: 650px; top: 140px; width: 760px; }`,
    body: `
      <div class="logo">${logo}</div>
      <h1>One platform.<br>Zero black boxes.</h1>
      <p>Open-source website platform — visual builder, commerce, forms, media, and workflows built in.</p>
      <div class="chips"><span>Apache-2.0</span><span>Self-hostable</span><span>Multi-tenant</span><span>No-code</span></div>
      <div class="url">github.com/aglyn/aglyn</div>
      <div class="window"><img src="${capture}" alt=""></div>`,
  },
]

function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) return { executablePath: process.env.E2E_CHROME_PATH }
  return { channel: 'chrome' }
}

// The example plugin's element, rendered by its bundle. The target date is a
// fixed distance ahead of the render so every run shows a running timer.
const bundle = `data:text/javascript;base64,${readFileSync(
  join(repoRoot, 'examples/plugins/promo-countdown/dist/plugin.bundle.mjs'),
).toString('base64')}`
const PROMO_PROPS = {
  title: 'Spring sale',
  expiredText: "Sale's over — see you next time!",
  accent: '#e11d48',
  ctaLabel: 'Shop now',
  ctaEvent: 'cta',
}
composites.push({
  out: 'promo-countdown.png',
  dir: join(repoRoot, 'examples/plugins/promo-countdown'),
  width: 1200,
  height: 252,
  css: `
    body { background: #f5f7fa; display: flex; align-items: flex-start; gap: 24px; padding: 32px; }
    .scheme { flex: 1; border-radius: 14px; padding: 20px; }
    .scheme.light { background: #ffffff; border: 1px solid rgba(29, 34, 48, 0.10); }
    .scheme.dark { background: #0f1115; }`,
  body: `
    <div class="scheme light"><div id="light"></div></div>
    <div class="scheme dark"><div id="dark"></div></div>`,
  async stage(tab) {
    await tab.evaluate(
      async ({ bundleUrl, props }) => {
        const { default: render } = await import(bundleUrl)
        const targetIso = new Date(Date.now() + (3 * 86400 + 5 * 3600 + 42 * 60) * 1000).toISOString()
        for (const scheme of ['light', 'dark']) {
          render({
            mount: document.getElementById(scheme),
            props: { ...props, targetIso },
            scheme,
            emit: () => undefined,
            hostFetch: async () => ({ ok: false, status: 501, body: null }),
          })
        }
      },
      { bundleUrl: bundle, props: PROMO_PROPS },
    )
    await tab.waitForTimeout(1200)
  },
})

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
let failures = 0
for (const composite of composites) {
  const context = await browser.newContext({
    viewport: { width: composite.width, height: composite.height },
    deviceScaleFactor: 1,
  })
  const tab = await context.newPage()
  try {
    await tab.setContent(page(composite), { waitUntil: 'networkidle' })
    if (composite.stage) await composite.stage(tab)
    // A fallback face would ship a different headline than the brand's.
    const raleway = await tab.evaluate(() => document.fonts.check('700 20px Raleway'))
    if (!raleway) throw new Error('Raleway did not load, so the headline would render in a fallback')
    const outPath = join(composite.dir ?? README_ASSETS, composite.out)
    await tab.screenshot({ path: outPath })
    const bytes = await optimizePng(outPath)
    console.log(`RENDER  ${composite.out} (${Math.round(bytes / 1024)} KB)`)
  } catch (error) {
    failures += 1
    console.error(`FAIL  ${composite.out}: ${String(error?.message ?? error).split('\n')[0]}`)
  } finally {
    await context.close()
  }
}
await browser.close()
process.exit(failures ? 1 : 0)
