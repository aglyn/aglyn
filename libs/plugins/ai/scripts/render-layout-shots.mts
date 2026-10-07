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
 * Screenshots of a site layout — its header and footer — the way a visitor
 * sees them (AGL-3596), for judging a generated layout by its looks before it
 * ships.
 *
 *   node libs/plugins/ai/scripts/render-layout-shots.mts --out <dir> <layout.json> [<layout.json>…]
 *
 * Each input is JSON: `{ "name": "Hillside Dog Grooming", "nodes": { …layout
 * node map… }, "theme"?: HostTheme }` — the node map as a layout version
 * stores it (the root `_@_`, a `layoutSlot` somewhere under it), the site's
 * name (what `{{host.businessName}}` resolves to), and the site's theme
 * (the starter site's `DEFAULT_SITE_THEME` when absent). A layout job's
 * draft, read back with `readAiDraftNodes`, is exactly that node map.
 *
 * HOW IT RENDERS. No emulator and no tenant server: the layout is composed
 * around a page with the platform's own `composeLayoutAndScreenNodes`, its
 * host tokens resolved with `resolveNodesHostTokens`, and rendered to markup
 * with the REAL component bundles and node renderer, in the site theme
 * `createAglynSiteTheme` builds — the recipe `record-ai-page-axe.mts` uses,
 * loaded through jiti in a jsdom window. The markup is static HTML (no
 * hydration), loaded into headless Chrome at real viewport widths, so the
 * theme's media queries — the phone menu, the stacked footer — apply as they
 * do on a published page. Starter photos are served from
 * `apps/tenant/public`, Google Fonts from the network, and every other
 * request is refused. Page links render inert (no routing map), which looks
 * the same.
 *
 * WHAT IT WRITES, per input `<key>` (the file's base name), into `--out`:
 *
 *   <key>-desktop-light-header.png   1440 wide: the header
 *   <key>-desktop-light-footer.png   1440 wide: the footer, around the starter home page
 *   <key>-desktop-dark-header.png    the same in the theme's dark scheme
 *   <key>-desktop-dark-footer.png
 *   <key>-phone-light-header.png     375 wide
 *   <key>-phone-light-footer.png
 *   <key>-phone-menu-open.png        375 wide, the Drawer open over the page
 *   <key>-short-desktop-light.png    a one-heading page, whole: the footer must sit at the window's bottom
 *   <key>-short-phone-light.png
 *
 * and logs any width at which the document is wider than its window.
 *
 * THE OPEN MENU is the one emulated part. A static render has no click to
 * open the Drawer, so for that shot the Drawer element is swapped for MUI's
 * own temporary Drawer rendered open, with the panel `drawer.tsx` opens
 * (280 wide, padded, a close row) — the same component and styling, opened
 * in place rather than by a tap.
 *
 * Chrome is found the way the e2e tools find it: `E2E_CHROME_PATH`, else the
 * first of Chrome, Chrome Beta or Chromium installed.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(join(ROOT, 'package.json'))
type Dict = Record<string, any>

function parseArgs(argv: string[]): { out: string; inputs: string[] } {
  const out = argv.indexOf('--out')
  if (out === -1 || !argv[out + 1]) throw new Error('Usage: render-layout-shots.mts --out <dir> <layout.json>…')
  const inputs = argv.filter((_, index) => index !== out && index !== out + 1)
  if (!inputs.length) throw new Error('Name at least one layout JSON file.')
  return { out: resolve(argv[out + 1]), inputs: inputs.map((input) => resolve(input)) }
}

/**
 * Emotion takes the server path when it loads before a `document` exists, so
 * each rule is written into the markup beside its element (see
 * record-ai-page-axe.mts).
 */
function loadEmotionForServerRendering(): void {
  for (const id of ['@emotion/cache', '@emotion/react', '@emotion/styled', '@emotion/use-insertion-effect-with-fallbacks', '@emotion/utils']) {
    require(id)
  }
}

/** A jsdom window as the globals the bundles read at import time. */
function installWindow(): void {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html lang="en"><head></head><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.test/',
  })
  const globals = globalThis as Dict
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'localStorage', 'sessionStorage']) {
    const value = (dom.window as Dict)[key]
    if (value === undefined || globals[key] !== undefined) continue
    try {
      globals[key] = typeof value === 'function' && !/^[A-Z]/.test(key) ? value.bind(dom.window) : value
    } catch {
      // A global this Node keeps read-only; the window's own copy still serves.
    }
  }
  if (!globals['matchMedia']) {
    globals['matchMedia'] = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  }
  globals['React'] = require('react')
}

/** The `@aglyn/*` aliases, in the prefix form jiti resolves. */
function readAliases(): Record<string, string> {
  const base = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'))
  const alias: Record<string, string> = {}
  for (const [key, targets] of Object.entries(base.compilerOptions.paths as Record<string, string[]>)) {
    const target = targets[0].replace(/^\.\//, '')
    if (key.endsWith('/*')) alias[key.slice(0, -1)] = join(ROOT, target.replace(/\/?\*$/, '')) + '/'
    else alias[key] = join(ROOT, target)
  }
  return alias
}

function chromeExecutable(): Dict {
  if (process.env['E2E_CHROME_PATH']) return { executablePath: process.env['E2E_CHROME_PATH'] }
  if (process.platform === 'darwin') {
    for (const executablePath of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      if (existsSync(executablePath)) return { executablePath }
    }
  }
  return { channel: 'chrome' }
}

const CLOSE_ICON =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z'

async function main(): Promise<void> {
  const { out, inputs } = parseArgs(process.argv.slice(2))
  loadEmotionForServerRendering()
  installWindow()
  const { pluginBundleEntries } = await import(join(ROOT, 'tools/scripts/lib/plugin-bundle-entries.mjs'))
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    alias: readAliases(),
    jsx: true,
    interopDefault: true,
    moduleCache: true,
    // Outside the repo: a shared checkout must not gain a build artifact.
    fsCache: join(tmpdir(), 'aglyn-ai-page-axe-jiti'),
    sourceMaps: false,
  })
  const load = (file: string): Promise<Dict> => jiti.import(join(ROOT, file)) as Promise<Dict>

  const core = await load('libs/aglyn/src/lib/aglyn.ts')
  for (const file of ['libs/plugins/mui/src/lib/plugin.ts', 'libs/plugins/forms/src/lib/plugin.ts']) {
    const mod = await load(file)
    for (const entry of (await pluginBundleEntries(mod, file)) as Dict[]) {
      core.components.registerComponent(entry.component, entry.schema)
    }
  }
  const renderer = await load('libs/aglyn-node-renderer/src/index.ts')
  const siteTheme = await load('libs/aglyn-node-renderer/src/lib/hooks/use-aglyn-site-theme.ts')
  const themes = await load('libs/shared/ui/theme/src/index.ts')
  const compose = await load('libs/aglyn/src/lib/app-utils/compose-layout-nodes.ts')
  const tokens = await load('libs/aglyn/src/lib/app-utils/host-tokens.ts')
  const starter = await load('libs/aglyn/src/lib/app-utils/starter-template-nodes.ts')
  const defaults = await load('libs/aglyn/src/lib/app-utils/default-site.ts')
  const drawer = await load('libs/plugins/mui/src/lib/components/drawer.tsx')

  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const CssBaseline = require('@mui/material/CssBaseline').default
  const MuiDrawer = require('@mui/material/Drawer').default
  const Box = require('@mui/material/Box').default
  const h = React.createElement

  const OpenDrawer = React.forwardRef((props: Dict, ref: unknown) => {
    const { anchor, width, children, sx, ...rest } = props
    const side = drawer.isSideAnchor(anchor)
    return h(
      MuiDrawer,
      { ref, ...rest, anchor: anchor || 'left', open: true, variant: 'temporary', ModalProps: { disablePortal: true }, transitionDuration: 0 },
      h(
        Box,
        { sx: [side ? { width: width || 280, maxWidth: '90vw', p: 2 } : { width: 'auto', p: 2 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] },
        h(
          Box,
          { sx: { display: 'flex', justifyContent: 'flex-end', mb: 1 } },
          h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-label': 'Close menu' }, h('path', { fill: 'currentColor', d: CLOSE_ICON })),
        ),
        children,
      ),
    )
  })
  const drawerSchema = core.components.getSchema('muiDrawer')

  const shortPage = starter.buildStarterNodes([
    starter.starterSection('shot_section', 'md', 10, [
      starter.starterText('shot_title', 'h1', 'A short page', { component: 'h1' }),
      { ...starter.starterText('shot_body', 'lede', 'One heading and a line: the footer still sits at the bottom of the window.'), sx: { color: 'text.secondary', marginTop: 2 } },
    ]),
  ])

  const { chromium } = require('playwright-core')
  const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
  mkdirSync(out, { recursive: true })
  const staticDir = join(ROOT, 'apps/tenant/public')
  let html = ''
  try {
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    const tab = await context.newPage()
    await tab.route('**/*', async (route: Dict) => {
      const url = new URL(route.request().url())
      if (url.hostname === 'site.test' && url.pathname.startsWith('/_static/')) {
        const file = join(staticDir, url.pathname)
        if (existsSync(file)) return route.fulfill({ body: readFileSync(file), contentType: 'image/jpeg' })
      }
      if (url.hostname === 'site.test') return route.fulfill({ body: html, contentType: 'text/html' })
      if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return route.continue()
      return route.abort()
    })

    for (const input of inputs) {
      const key = basename(input).replace(/\.json$/, '')
      const data = JSON.parse(readFileSync(input, 'utf8')) as { name: string; nodes: Dict; theme?: Dict }
      const theme = data.theme ?? defaults.DEFAULT_SITE_THEME
      const fonts = ((theme.fonts ?? []) as Dict[])
        .filter((font) => font.source === 'google')
        .map((font) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}:wght@${(font.weights ?? [400, 700]).join(';')}&display=swap">`)
        .join('')
      const render = (screen: Dict, scheme: 'light' | 'dark', menuOpen: boolean): string => {
        core.components.registerComponent(menuOpen ? OpenDrawer : drawer.default, drawerSchema)
        const composed = tokens.resolveNodesHostTokens(compose.composeLayoutAndScreenNodes(data.nodes, screen), { displayName: data.name })
        core.canvas.setNodes(composed)
        const root = core.canvas.getNode('_@_')
        const markup = renderToStaticMarkup(
          h(themes.ThemeProvider, { theme: siteTheme.createAglynSiteTheme({ theme, scheme }) }, h(CssBaseline, null), h(renderer.AglynNodeRenderer, { node: root })),
        )
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${fonts}<title>${key}</title></head><body>${markup}</body></html>`
      }
      const shoot = async (page: string, width: number, height: number, name: string, parts: Array<'header' | 'footer' | 'viewport' | 'full'>) => {
        html = page
        await tab.setViewportSize({ width, height })
        await tab.goto('https://site.test/', { waitUntil: 'networkidle' })
        await tab.waitForTimeout(250)
        const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (overflow > 0) console.log(`OVERFLOW  ${key} ${name}: ${overflow}px wider than the window`)
        for (const part of parts) {
          const path = join(out, `${key}-${name}${part === 'viewport' || part === 'full' ? '' : `-${part}`}.png`)
          if (part === 'viewport') await tab.screenshot({ path })
          else if (part === 'full') await tab.screenshot({ path, fullPage: true })
          else if (part === 'header') {
            const bottom = await tab.$eval('header', (element: Element) => element.getBoundingClientRect().bottom).catch(() => 160)
            await tab.screenshot({ path, clip: { x: 0, y: 0, width, height: Math.ceil(bottom) + 24 } })
          } else {
            const footer = await tab.$('footer')
            if (footer) await footer.screenshot({ path })
            else console.log(`NO FOOTER ${key} ${name}`)
          }
        }
      }
      const home = defaults.buildDefaultHomeScreen(data.name).nodes
      const light = render(home, 'light', false)
      await shoot(light, 1440, 900, 'desktop-light', ['header', 'footer'])
      await shoot(render(home, 'dark', false), 1440, 900, 'desktop-dark', ['header', 'footer'])
      await shoot(light, 375, 812, 'phone-light', ['header', 'footer'])
      await shoot(render(home, 'light', true), 375, 812, 'phone-menu-open', ['viewport'])
      const short = render(shortPage, 'light', false)
      await shoot(short, 1440, 900, 'short-desktop-light', ['full'])
      await shoot(short, 375, 812, 'short-phone-light', ['full'])
      console.log(`WROTE     ${key} → ${out}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
