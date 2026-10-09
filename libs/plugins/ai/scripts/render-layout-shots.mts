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
 *   node libs/plugins/ai/scripts/render-layout-shots.mts --out <dir> [--page-only] <layout.json> [<layout.json>…]
 *
 * Each input is JSON: `{ "name": "Hillside Dog Grooming", "nodes": { …layout
 * node map… }, "theme"?: HostTheme }` — the node map as a layout version
 * stores it (the root `_@_`, a `layoutSlot` somewhere under it), the site's
 * name (what `{{host.businessName}}` resolves to), and the site's theme
 * (the starter site's `DEFAULT_SITE_THEME` when absent). In place of a
 * `theme`, a `"style"` is a site's look tokens (AGL-3660, `ai-site-look.ts`):
 * the theme is then built the way the look unit builds it, the tokens over
 * the base theme they name, read from the themes plugin. A layout job's
 * draft, read back with `readAiDraftNodes`, is exactly that node map. An
 * optional `"page"` is a page's node map (an AI-built Home, say) to render
 * inside the layout in place of the starter home page; with one, the whole
 * page is shot too. An optional `"forms"` maps a form id to its saved design
 * (`{ rootId, nodes }`, as the form job writes it), grafted into every place
 * the page or layout places that form, as a published page grafts it; a form
 * the input names no design for is drawn with the fields a contact form asks
 * for (name, email, phone, message), so a shot never shows an empty form.
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
 *   <key>-page-desktop-light.png     with a `page`: header, that page and footer, whole, 1440 wide
 *   <key>-page-phone-light.png       the same, 375 wide
 *   <key>-page.txt                   with a `page`: the words that page shows, as a visitor reads them
 *   <key>-short-desktop-light.png    a one-heading page, whole: the footer must sit at the window's bottom,
 *                                    and under its heading a Card, two Buttons and a field with no style
 *                                    of their own, as dragged in from the drawer: they take the site's look
 *   <key>-short-phone-light.png
 *
 * and logs any width at which the document is wider than its window. With
 * `--page-only`, an input with a `page` is shot whole and nothing else (the
 * two `page-` shots and its words), for judging pages by the dozen.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(join(ROOT, 'package.json'))
type Dict = Record<string, any>

function parseArgs(argv: string[]): { out: string; inputs: string[]; pageOnly: boolean } {
  const out = argv.indexOf('--out')
  if (out === -1 || !argv[out + 1]) throw new Error('Usage: render-layout-shots.mts --out <dir> [--page-only] <layout.json>…')
  const inputs = argv.filter((arg, index) => index !== out && index !== out + 1 && arg !== '--page-only')
  if (!inputs.length) throw new Error('Name at least one layout JSON file.')
  return { out: resolve(argv[out + 1]), inputs: inputs.map((input) => resolve(input)), pageOnly: argv.includes('--page-only') }
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

/**
 * A page's reusable-component instances drawn as the card such a component
 * draws (AGL-3660): a shot has no component documents to resolve an instance
 * against, and an instance with no definition renders nothing, which read as
 * a section with no items. Each instance becomes a Card — no style of its own,
 * so the site's theme draws it — holding its title-like prop over its others.
 */
function expandInstances(nodes: Dict): Dict {
  const out: Dict = { ...nodes }
  for (const [id, node] of Object.entries(nodes) as Array<[string, Dict]>) {
    if (node?.componentId !== 'reusableInstance') continue
    const values = Object.entries((node.props?.propValues ?? {}) as Record<string, unknown>).filter(([, value]) => typeof value === 'string' && value)
    const title = values.find(([name]) => /title|name|heading|label/i.test(name)) ?? values[0]
    const rest = values.filter((entry) => entry !== title)
    const content = `${id}__content`
    const lines = [
      ...(title ? [{ $id: `${id}__title`, componentId: 'muiTypography', pluginId: 'mui', parentId: content, props: { variant: 'h5', component: 'h3', children: title[1] }, nodes: [] }] : []),
      ...rest.map(([name, value]) => ({ $id: `${id}__${name}`, componentId: 'muiTypography', pluginId: 'mui', parentId: content, props: { variant: 'body1', children: value }, sx: { color: 'text.secondary', mt: 1 }, nodes: [] })),
    ]
    out[id] = { ...node, componentId: 'muiCard', pluginId: 'mui', props: {}, sx: { height: '100%' }, nodes: [content] }
    out[content] = { $id: content, componentId: 'muiCardContent', pluginId: 'mui', parentId: id, props: {}, sx: { p: 3 }, nodes: lines.map((line) => line.$id) }
    for (const line of lines) out[line.$id] = line
  }
  return out
}

const CLOSE_ICON =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z'

async function main(): Promise<void> {
  const { out, inputs, pageOnly } = parseArgs(process.argv.slice(2))
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
  // The store's elements a page or a layout lists the site's records with (AGL-3676).
  for (const file of ['libs/plugins/commerce/src/lib/components/product-grid.tsx', 'libs/plugins/commerce/src/lib/components/cart.tsx']) {
    const mod = await load(file)
    core.components.registerComponent(mod.default, mod.schema)
  }
  const collections = await load('libs/aglyn/src/lib/app-utils/collection-entries.ts')
  const siteContext = await load('libs/aglyn/src/lib/app-utils/site-context.ts')
  const renderer = await load('libs/aglyn-node-renderer/src/index.ts')
  const siteTheme = await load('libs/aglyn-node-renderer/src/lib/hooks/use-aglyn-site-theme.ts')
  const themes = await load('libs/shared/ui/theme/src/index.ts')
  const compose = await load('libs/aglyn/src/lib/app-utils/compose-layout-nodes.ts')
  const tokens = await load('libs/aglyn/src/lib/app-utils/host-tokens.ts')
  const starter = await load('libs/aglyn/src/lib/app-utils/starter-template-nodes.ts')
  const defaults = await load('libs/aglyn/src/lib/app-utils/default-site.ts')
  const drawer = await load('libs/plugins/mui/src/lib/components/drawer.tsx')
  const look = await load('libs/plugins/ai/src/lib/model/ai-site-look.ts')
  const forms = await load('libs/aglyn/src/lib/app-utils/forms.ts')
  const reusable = await load('libs/aglyn/src/lib/app-utils/compose-reusable-components.ts')
  /** A contact form's design, as a form job writes one: a form root over its fields. */
  const contactDesign = (formId: string) => {
    const field = (name: string, label: string, extra: Dict = {}) => ({
      $id: `${formId}__${name}`,
      componentId: 'formField',
      pluginId: 'forms',
      parentId: `${formId}__root`,
      props: { fieldName: name, label, required: name !== 'phone', ...extra },
      nodes: [],
    })
    const fields = [
      field('name', 'Name'),
      field('email', 'Email', { fieldType: 'email' }),
      field('phone', 'Phone', { fieldType: 'tel' }),
      field('message', 'Message', { fieldType: 'textarea' }),
    ]
    return {
      rootId: `${formId}__root`,
      nodes: {
        [`${formId}__root`]: {
          $id: `${formId}__root`,
          componentId: 'form',
          pluginId: 'forms',
          props: { formId, formName: 'Contact', submitLabel: 'Send message' },
          nodes: fields.map((entry) => entry.$id),
        },
        ...Object.fromEntries(fields.map((entry) => [entry.$id, entry])),
      },
    }
  }
  /** Each placed form grafted with its design, as a published page grafts it. */
  const withForms = (nodes: Dict, given: Record<string, { rootId: string; nodes: Dict }> | undefined): Dict => {
    const ids = new Set(
      (Object.values(nodes) as Dict[]).filter((node) => node?.componentId === 'form' && node.props?.formId).map((node) => String(node.props.formId)),
    )
    if (!ids.size) return nodes
    const designs = Object.fromEntries([...ids].map((id) => [id, given?.[id] ?? contactDesign(id)]))
    return reusable.composeReusableComponentNodes(nodes, undefined, [forms.placedFormPlacement(designs)])
  }
  const presets = (await load('libs/plugins/themes/src/lib/presets/index.ts')).THEME_PRESETS as Dict[]
  /** A look's theme, as the look unit saves it: the tokens over the base they name. */
  const themeOfStyle = (style: Dict): Dict => {
    const preset = presets.find((entry) => entry.id === `theme-presets.${style.base}`)
    return look.aiSiteTheme(style, preset?.theme ?? defaults.DEFAULT_SITE_THEME)
  }

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
      // Components as the drawer drops them, with no style of their own: the site's theme styles them.
      { id: 'shot_eyebrow', componentId: 'muiTypography', props: { variant: 'overline', children: 'Dropped from the drawer' }, sx: { display: 'block', marginTop: 4 } },
      {
        id: 'shot_card',
        componentId: 'muiCard',
        sx: { maxWidth: 360, marginTop: 1 },
        children: [
          {
            id: 'shot_card_content',
            componentId: 'muiCardContent',
            children: [
              starter.starterText('shot_card_title', 'h6', 'A card'),
              starter.starterText('shot_card_text', 'body2', 'No variant of its own.'),
            ],
          },
        ],
      },
      { id: 'shot_button', componentId: 'muiButton', props: { variant: 'contained', children: 'A button' }, sx: { marginTop: 2, marginRight: 1 } },
      { id: 'shot_button_quiet', componentId: 'muiButton', props: { variant: 'text', children: 'A quiet one' }, sx: { marginTop: 2 } },
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
      const data = JSON.parse(readFileSync(input, 'utf8')) as {
        name: string
        nodes: Dict
        page?: Dict
        theme?: Dict
        style?: Dict
        forms?: Record<string, { rootId: string; nodes: Dict }>
        /**
         * The site's own records a page lists (AGL-3676), as the published
         * page is handed them: a Product grid's first page, as the commerce
         * enricher seeds it (`items`, each `{ id, name, slug, priceUsd,
         * maxPriceUsd, imageUrl?, soldOut, priceComingSoon? }`), and a blog's
         * entries by its collection slug, as compose expands them.
         */
        records?: { products?: Dict[]; posts?: { slug: string; entries: Dict[] } }
      }
      const theme = data.theme ?? (data.style ? themeOfStyle(data.style) : defaults.DEFAULT_SITE_THEME)
      const fonts = ((theme.fonts ?? []) as Dict[])
        .filter((font) => font.source === 'google')
        .map((font) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}:wght@${(font.weights ?? [400, 700]).join(';')}&display=swap">`)
        .join('')
      const render = (screen: Dict, scheme: 'light' | 'dark', menuOpen: boolean): string => {
        core.components.registerComponent(menuOpen ? OpenDrawer : drawer.default, drawerSchema)
        let composed = tokens.resolveNodesHostTokens(withForms(compose.composeLayoutAndScreenNodes(data.nodes, screen), data.forms), { displayName: data.name })
        // A blog's posts expanded into each Collection Entries block, as compose expands them.
        const posts = data.records?.posts
        if (posts) {
          composed = collections.expandCollectionEntries(composed, { [posts.slug]: { slug: posts.slug, entries: posts.entries } }, posts.slug, 'UTC')
        }
        core.canvas.setNodes(composed)
        const root = core.canvas.getNode('_@_')
        // Each Product grid's first page, seeded as the commerce enricher seeds it.
        const grids = Object.fromEntries(
          (Object.entries(composed) as Array<[string, Dict]>)
            .filter(([, node]) => node?.componentId === 'product-grid')
            // The first page the grid's own query would return: at most its Max items or its page size.
            .map(([id, node]) => {
              const most = Number(node.props?.maxItems ?? node.props?.pageSize) || Infinity
              return [id, { items: (data.records?.products ?? []).slice(0, most) }]
            }),
        )
        const site = data.records ? { hostId: 'site-shot', pageData: { commerce: { grids } } } : {}
        // Both schemes' themes, as the tenant's HostThemeProvider gives them, so an
        // "Always dark" band (a dark band, a photo cover) pins its scheme here too.
        const schemeThemes = themes.createSiteSchemeThemes((pinned: 'light' | 'dark') => siteTheme.createAglynSiteTheme({ theme, scheme: pinned }))
        const markup = renderToStaticMarkup(
          h(
            siteContext.SiteContext.Provider,
            { value: site },
            h(
              themes.SiteSchemeThemesContext.Provider,
              { value: schemeThemes },
              h(themes.ThemeProvider, { theme: schemeThemes(scheme) }, h(CssBaseline, null), h(renderer.AglynNodeRenderer, { node: root })),
            ),
          ),
        )
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${fonts}<title>${key}</title></head><body>${markup}</body></html>`
      }
      const shoot = async (page: string, width: number, height: number, name: string, parts: Array<'header' | 'footer' | 'viewport' | 'full'>) => {
        html = page
        await tab.setViewportSize({ width, height })
        await tab.goto('https://site.test/', { waitUntil: 'networkidle' })
        // A whole-page shot never scrolls, so a lazy picture below the window would shoot empty.
        await tab.evaluate(async () => {
          document.querySelectorAll('img[loading="lazy"]').forEach((image) => image.setAttribute('loading', 'eager'))
          for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
            window.scrollTo(0, y)
            await new Promise((done) => setTimeout(done, 60))
          }
          window.scrollTo(0, 0)
          await Promise.all([...document.images].map((image) => (image.complete ? null : new Promise((done) => image.addEventListener('load', done, { once: true }) || setTimeout(done, 3000)))))
        })
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
      const home = data.page ? expandInstances(data.page) : defaults.buildDefaultHomeScreen(data.name).nodes
      const light = render(home, 'light', false)
      if (data.page) {
        await shoot(light, 1440, 900, 'page-desktop-light', ['full'])
        // The words the page shows, for a grep that proves what a visitor reads.
        writeFileSync(join(out, `${key}-page.txt`), await tab.evaluate(() => document.body.innerText))
        await shoot(light, 375, 812, 'page-phone-light', ['full'])
        if (pageOnly) {
          console.log(`WROTE     ${key} → ${out}`)
          continue
        }
      }
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
