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
 * Records how the AI plugin's golden pages look at every width the besigner's
 * device switcher previews (AGL-2907, AGL-3020). Emits one GENERATED file:
 *
 *   libs/plugins/ai/src/lib/jobs/fixtures/ai-page-axe.generated.json
 *
 * Each golden page is assembled through the step's OWN section check and page
 * assembly, and rendered to markup with the real component bundles and node
 * renderer at each of the switcher's devices — `devicePreviewWidth` on the
 * site theme's own breakpoints, with the theme pinned to that width by
 * `createDevicePinnedTheme` and every element's sx by
 * `resolveSxForDeviceWidth`, exactly as the canvas pins them — and loaded into
 * a headless Chrome whose viewport is that width. There it is measured:
 *
 *   - what runs past the viewport's edge (a document wider than its screen);
 *   - how many columns each row a layout element draws holds on its first
 *     line, so a band that keeps its desktop columns on a phone shows;
 *   - axe-core's audit, every rule on, `color-contrast` included, since a
 *     browser paints the colors jsdom never could.
 *
 * The result is a fixture, never a live run: `ai-job-page-widths.spec.ts` reads
 * it, holds every page to what the device audit requires
 * (`runtime/ai-device-audit.ts`), and refuses a recording whose fingerprint no
 * longer matches the goldens it claims to have rendered.
 *
 *   node tools/scripts/record-ai-page-axe.mts          (write the file)
 *   node tools/scripts/record-ai-page-axe.mts --check  (fail if it differs)
 *
 * Rendering needs the bundles, which are React modules in TypeScript with
 * `@aglyn/*` aliases, so they load through jiti exactly as the palette
 * generator loads them, inside a jsdom window this script installs as the
 * globals the bundles expect at import time. Measuring needs a browser that
 * lays a page out: Chrome, found the way the e2e tools find it
 * (`E2E_CHROME_PATH` first). The run takes a few minutes, which is why it is
 * recorded here rather than recomputed in a spec.
 *
 * STAND-IN DEFINITIONS. A golden site's reusable components are inventory
 * rows — an id, a name and declared prop names — with no stored definition to
 * graft, so this builds one per row from the declared props: a heading for the
 * first, body text for the rest, which is the shape the definitions in the
 * fixtures' plans describe. The audit therefore measures the page the model
 * wrote and a faithful placeholder for what the site already had.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PAGES_OUT = join(ROOT, 'libs/plugins/ai/src/lib/jobs/fixtures/ai-page-axe.generated.json')

/** The viewport's height at every width; only its width is measured. */
const VIEWPORT_HEIGHT = 900

const require = createRequire(join(ROOT, 'package.json'))

type Dict = Record<string, any>

/**
 * Emotion decides once, when its modules evaluate, whether it runs in a
 * browser, by looking for a global `document`. In a browser it inserts rules
 * into the document from an insertion effect, which a server render never
 * runs; on a server it writes each rule into the markup beside its element,
 * which is what a published page's server render sends. Loaded before the
 * jsdom globals exist, it takes the server's path, and the markup a device
 * render produces carries its own styles.
 */
function loadEmotionForServerRendering(): void {
  for (const id of [
    '@emotion/cache',
    '@emotion/react',
    '@emotion/styled',
    '@emotion/use-insertion-effect-with-fallbacks',
    '@emotion/utils',
  ]) {
    require(id)
  }
}

/**
 * The `@aglyn/*` aliases, in the prefix form jiti resolves: a wildcard path
 * becomes a directory prefix, a bare one a file.
 */
function readAliases(): Record<string, string> {
  const base = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'))
  const alias: Record<string, string> = {}
  const paths = base.compilerOptions.paths as Record<string, string[]>
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0].replace(/^\.\//, '')
    if (key.endsWith('/*')) {
      alias[key.slice(0, -1)] = join(ROOT, target.replace(/\/?\*$/, '')) + '/'
    } else {
      alias[key] = join(ROOT, target)
    }
  }
  return alias
}

/**
 * A jsdom window installed as the globals a browser bundle reads at import
 * time. Written before the bundles load, since a module that reads `document`
 * while evaluating cannot be given one afterwards.
 */
function installWindow(): void {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Recording</title></head><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.test/',
  })
  const globals = globalThis as Dict
  const keys = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'SVGElement',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'matchMedia',
    'localStorage',
    'sessionStorage',
  ]
  for (const key of keys) {
    const value = (dom.window as Dict)[key]
    if (value === undefined || globals[key] !== undefined) continue
    try {
      globals[key] =
        typeof value === 'function' && !/^[A-Z]/.test(key)
          ? (value as (...args: unknown[]) => unknown).bind(dom.window)
          : value
    } catch {
      // A global this Node keeps read-only; the window's own copy still serves.
    }
  }
  if (!globals['matchMedia']) {
    globals['matchMedia'] = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    })
  }
  // jiti compiles JSX to the classic runtime, which reads a global React.
  globals['React'] = require('react')
}

/** The Chrome the e2e tools use: `E2E_CHROME_PATH`, else the first flavor installed. */
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

/** A stand-in definition for an inventory component row, from its declared props. */
function standInDefinition(row: { id: string; name: string; props?: Record<string, unknown> }): Dict {
  const names = Object.keys(row.props ?? {})
  const nodes: Dict = {}
  const children: string[] = []
  names.forEach((prop, index) => {
    const id = `${row.id}__${prop}`
    nodes[id] = {
      $id: id,
      componentId: 'muiTypography',
      parentId: `${row.id}__root`,
      props: {
        variant: index === 0 ? 'h3' : 'body2',
        ...(index === 0 ? { component: 'h3' } : {}),
        children: `{{prop.${prop}}}`,
      },
      nodes: [],
    }
    children.push(id)
  })
  nodes[`${row.id}__root`] = {
    $id: `${row.id}__root`,
    componentId: 'muiStack',
    parentId: null,
    props: { direction: 'column' },
    nodes: children,
  }
  return { rootId: `${row.id}__root`, nodes }
}

/** A golden page as the step stores it, folded section by section. */
function assemblePage(loaded: Dict, fixture: Dict, reusableComponents: boolean): Dict {
  const { sections } = loaded
  const screen = fixture.plan.screens[0]
  const sectionIds = screen.sections.map((_: unknown, index: number) =>
    sections.aiPageSectionNodeId(`job-${fixture.id}`, index),
  )
  const context = sections.aiPageCheckContext(fixture.inventory, reusableComponents ? {} : { reusableComponents: false })
  let page = sections.aiEmptyPage()
  fixture.answers.forEach((answer: Dict, index: number) => {
    const check = sections.aiPageSectionCheck({
      page,
      sectionIds,
      index,
      context,
      uses: screen.sections[index].uses ?? [],
      inventory: fixture.inventory,
    })
    const result = check({ tree: JSON.stringify(answer) })
    if (!result.value) {
      const violations = result.violations
        .map((violation: Dict) => `${violation.code}: ${violation.message}`)
        .join('; ')
      throw new Error(`${fixture.id} section ${index + 1} does not validate — ${violations}`)
    }
    page = sections.aiPageWithSection(page, result.value, sectionIds)
  })
  return page
}

/**
 * Where each element sits, as a recording names it: `name(id)` when the tree
 * carries a name for the element, else the child positions from `rootId`.
 */
function locators(nodes: Dict, rootId: string, name: (id: string, path: number[]) => string | null): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (id: string, path: number[]) => {
    const node = nodes[id]
    if (!node || found.has(id)) return
    found.set(id, name(id, path) ?? (path.length ? path.join('.') : 'root'))
    ;(node.nodes ?? []).forEach((child: string, index: number) => walk(child, [...path, index]))
  }
  walk(rootId, [])
  return found
}

/** The markup of a document at one width, pinned the way the canvas pins its artboard. */
function renderAt(loaded: Dict, root: Dict, theme: Dict, width: number, landmark: boolean): string {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const CssBaseline = require('@mui/material/CssBaseline').default
  const h = React.createElement
  const tree = h(loaded.renderer.AglynNodeRenderer, { node: root })
  return renderToStaticMarkup(
    h(
      loaded.themes.ThemeProvider,
      { theme: loaded.device.createDevicePinnedTheme(theme, width) },
      h(CssBaseline, null),
      h(
        loaded.renderer.LeafSxTransformContext.Provider,
        { value: (sx: unknown) => loaded.device.resolveSxForDeviceWidth(sx, width) },
        landmark ? h('main', null, tree) : tree,
      ),
    ),
  )
}

/**
 * What the browser measures of the loaded document: the deepest elements past
 * the viewport's edge, and the columns on the first line of each row element
 * named. Runs in the page.
 */
function measureInPage(rowIds: string[]): Dict {
  const nodeIdOf = (element: Element) => (element.getAttribute('data-aglyn') ?? '').replace(/^leaf:/, '')
  const box = (element: Element) => {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') return null
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? rect : null
  }
  const viewport = document.documentElement.clientWidth
  const wanted = new Set(rowIds)
  const columns: Record<string, number> = {}
  for (const element of Array.from(document.querySelectorAll('[data-aglyn]'))) {
    const id = nodeIdOf(element)
    if (!wanted.has(id)) continue
    const boxes = Array.from(element.children)
      .map(box)
      .filter((rect): rect is DOMRect => rect !== null)
    if (!boxes.length) continue
    const [first] = boxes
    columns[id] = boxes.filter((rect) => rect.top < first.bottom - 0.5 && rect.bottom > first.top + 0.5).length
  }
  const overflow: string[] = []
  if (document.documentElement.scrollWidth > viewport) {
    // An element is past the edge when its box is, or when what it holds is:
    // a word too long for its line overflows its heading's box, not the box.
    const past = Array.from(document.querySelectorAll('[data-aglyn]')).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left + Math.max(rect.width, element.scrollWidth) > viewport + 0.5 || rect.left < -0.5
    })
    for (const element of past) {
      if (!past.some((other) => other !== element && element.contains(other))) overflow.push(nodeIdOf(element))
    }
    // Wider than the screen with no element to name: the document itself.
    const outermost = document.querySelector('[data-aglyn]')
    if (!overflow.length && outermost) overflow.push(nodeIdOf(outermost))
  }
  return { columns, overflow }
}

/** axe-core's violations of the loaded document, every rule on. Runs in the page. */
async function axeInPage(): Promise<Dict[]> {
  const result = await (window as unknown as Dict)['axe'].run(document, { resultTypes: ['violations'] })
  return (result.violations as Dict[]).map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
  }))
}

/** Whether an element is a control rather than content: an Input or Navigation element of the palette, or an icon. */
function isControl(loaded: Dict, node: Dict | undefined): boolean {
  if (!node) return false
  const { ComponentCategory } = loaded.categories
  const category = loaded.core.components.getSchema(node.componentId)?.category
  return category === ComponentCategory.INPUT || category === ComponentCategory.NAVIGATION || node.componentId === 'icon'
}

/**
 * A document rendered and measured at every device of the switcher: the
 * shape `AiDeviceAudit` names, plus the characters of markup it renders.
 */
async function auditDocument(
  loaded: Dict,
  tab: Dict,
  input: {
    nodes: Dict
    rootId: string
    inventory: Dict | null
    landmark: boolean
    title: string
    name: (id: string, path: number[]) => string | null
  },
): Promise<Dict> {
  const definitions: Dict = {}
  for (const row of input.inventory?.components ?? []) definitions[row.id] = standInDefinition(row)
  const grafted = loaded.compose.composeReusableComponentNodes(input.nodes, definitions)
  loaded.core.canvas.setNodes(grafted)
  const root = loaded.core.canvas.getNode(input.rootId)
  if (!root) throw new Error(`${input.title}: the rendered tree has no root ${input.rootId}`)
  const where = locators(grafted, input.rootId, input.name)
  const theme = loaded.theme.createAglynSiteTheme({
    theme: loaded.audit.aiInventoryHostTheme(input.inventory?.theme ?? null) ?? undefined,
  })
  const { ComponentCategory } = loaded.categories
  const rowIds = Object.keys(grafted).filter(
    (id) => where.has(id) && loaded.core.components.getSchema(grafted[id].componentId)?.category === ComponentCategory.LAYOUT,
  )
  const devices: Dict[] = []
  const columns = new Map<string, Record<string, number>>()
  let markupChars = 0
  for (const device of loaded.audit.AI_AUDIT_DEVICES as string[]) {
    const width = loaded.besigner.devicePreviewWidth(loaded.besigner.BesignerDeviceFlag[device], theme.breakpoints.values)
    const markup = renderAt(loaded, root, theme, width, input.landmark)
    if (device === 'XS') markupChars = markup.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').length
    await tab.setViewportSize({ width, height: VIEWPORT_HEIGHT })
    await tab.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title></head><body>${markup}</body></html>`,
      { waitUntil: 'load' },
    )
    const measured = await tab.evaluate(measureInPage, rowIds)
    await tab.addScriptTag({ content: loaded.axeSource })
    const violations = await tab.evaluate(axeInPage)
    for (const [id, count] of Object.entries(measured.columns as Record<string, number>)) {
      columns.set(id, { ...(columns.get(id) ?? {}), [device]: count })
    }
    devices.push({
      device,
      width,
      overflow: [...new Set((measured.overflow as string[]).map((id) => where.get(id) ?? id))],
      violations,
    })
  }
  const rows = rowIds
    .map((id) => {
      const node = grafted[id]
      const counts = Object.fromEntries(
        (loaded.audit.AI_AUDIT_DEVICES as string[]).map((device) => [device, columns.get(id)?.[device] ?? 0]),
      )
      const grid = node.componentId === 'muiGrid' && node.props?.container === true
      const children = (node.nodes ?? []).filter((child: string) => grafted[child] && !grafted[child].hidden)
      return {
        node: where.get(id) as string,
        component: node.componentId,
        grid,
        content: children.filter((child: string) => !isControl(loaded, grafted[child])).length,
        columns: counts,
      }
    })
    .filter((row) => row.grid || Object.values(row.columns).some((count) => (count as number) >= 2))
  return { markupChars, devices, rows }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** What a recording claims to have rendered: the answers, exactly as they read. */
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

/** The golden pages the page step's evals replay from a site's inventory, and how each site builds. */
function goldenPages(briefs: Dict): Array<{ fixture: Dict; reusableComponents: boolean }> {
  return [
    ...(briefs.AI_PAGE_BRIEF_FIXTURES as Dict[]).map((fixture) => ({ fixture, reusableComponents: true })),
    // A Free workspace keeps no reusable components: its repeated items are
    // drawn where they repeat, from the item its answer writes once.
    { fixture: briefs.AI_FREE_PAGE_FIXTURE, reusableComponents: false },
    { fixture: briefs.AI_FREE_PRACTICE_AREAS_FIXTURE, reusableComponents: false },
    { fixture: briefs.AI_TWO_PERSON_PAGE_FIXTURE, reusableComponents: true },
  ]
}

async function recordGoldenPages(loaded: Dict, tab: Dict): Promise<Dict[]> {
  const { CANVAS_ROOT_ELEMENT_ID } = loaded.canvas
  const pages: Dict[] = []
  for (const { fixture, reusableComponents } of goldenPages(loaded.briefs)) {
    const page = assemblePage(loaded, fixture, reusableComponents)
    // A section by its name in the plan, and what it holds by position under it.
    const sectionName = (index: number): string => fixture.plan.screens[0].sections[index]?.name ?? `section ${index + 1}`
    const audit = await auditDocument(loaded, tab, {
      nodes: page,
      rootId: CANVAS_ROOT_ELEMENT_ID,
      inventory: fixture.inventory,
      landmark: true,
      title: fixture.seo?.title ?? fixture.id,
      name: (_id, path) =>
        path.length === 0
          ? 'page'
          : path.length === 1
            ? sectionName(path[0])
            : `${sectionName(path[0])} > ${path.slice(1).join('.')}`,
    })
    pages.push({ id: fixture.id, answers: fingerprint(fixture.answers), ...audit })
    console.log(`       ${fixture.id}`)
  }
  return pages
}

async function main(): Promise<void> {
  loadEmotionForServerRendering()
  installWindow()
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    alias: readAliases(),
    jsx: true,
    interopDefault: true,
    moduleCache: true,
    // Outside the repo: a shared checkout must not gain a build artifact, and
    // the bundles take minutes to compile afresh.
    fsCache: join(tmpdir(), 'aglyn-ai-page-axe-jiti'),
    sourceMaps: false,
  })
  const load = (file: string): Promise<Dict> => jiti.import(join(ROOT, file)) as Promise<Dict>

  const core = (await load('libs/aglyn/src/lib/aglyn.ts')) as Dict
  for (const [file, name] of [
    ['libs/plugins/mui/src/lib/plugin.ts', 'MUI_BUNDLE'],
    ['libs/plugins/forms/src/lib/plugin.ts', 'FORMS_BUNDLE'],
  ]) {
    const bundle = await load(file)
    for (const entry of bundle[name] as Dict[]) {
      core.components.registerComponent(entry.component, entry.schema)
    }
  }
  const loaded: Dict = {
    core,
    canvas: await load('libs/aglyn/src/lib/foundation/constants/canvas.ts'),
    categories: await load('libs/aglyn/src/lib/foundation/constants/components.ts'),
    compose: await load('libs/aglyn/src/lib/app-utils/compose-reusable-components.ts'),
    renderer: await load('libs/aglyn-node-renderer/src/index.ts'),
    theme: await load('libs/aglyn-node-renderer/src/lib/hooks/use-aglyn-site-theme.ts'),
    themes: await load('libs/shared/ui/theme/src/index.ts'),
    besigner: {
      ...(await load('libs/besigner/core/src/lib/constants/besigner.ts')),
      ...(await load('libs/besigner/core/src/lib/device-preview-width.ts')),
    },
    device: await load('libs/besigner/feature/designer/src/lib/utils/device-preview-styles.ts'),
    sections: await load('libs/plugins/ai/src/lib/jobs/ai-job-page-sections.ts'),
    briefs: await load('libs/plugins/ai/src/lib/jobs/fixtures/ai-page-briefs.ts'),
    audit: await load('libs/plugins/ai/src/lib/runtime/ai-device-audit.ts'),
    axeSource: readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8'),
  }
  const axeVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules/axe-core/package.json'), 'utf8')).version

  const { chromium } = require('playwright-core')
  const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
  const outputs: Array<{ file: string; content: string; summary: string }> = []
  try {
    const context = await browser.newContext({ offline: true })
    const tab = await context.newPage()

    console.log('Rendering the golden pages')
    const pages = await recordGoldenPages(loaded, tab)
    const worst = pages
      .flatMap((page) => (page.devices as Dict[]).flatMap((render) => render.violations as Dict[]))
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').length
    const findings = pages.flatMap((page) => loaded.audit.aiDeviceAuditFindings(page))
    outputs.push({
      file: PAGES_OUT,
      summary: `${pages.length} pages at ${loaded.audit.AI_AUDIT_DEVICES.length} widths, ${worst} serious or critical violation(s), ${findings.length} width finding(s)`,
      content: `${JSON.stringify(
        {
          note:
            'GENERATED by tools/scripts/record-ai-page-axe.mts (AGL-2907, AGL-3020). Do not edit. Each page is the golden ' +
            'brief assembled through the page step and rendered with the component bundles at every device of the ' +
            "besigner's switcher, pinned the way the canvas pins its artboard, then measured and audited in a headless " +
            'browser: what runs past the screen, the columns of every row a layout element draws, and axe-core with ' +
            'every rule on. `answers` fingerprints the goldens it was recorded from, and ai-job-page-widths.spec.ts ' +
            'refuses a stale one.',
          axeVersion,
          rulesOff: [],
          pages,
        },
        null,
        2,
      )}\n`,
    })

  } finally {
    await browser.close()
  }

  let stale = false
  for (const output of outputs) {
    const name = relative(ROOT, output.file)
    const current = existsSync(output.file) ? readFileSync(output.file, 'utf8') : null
    if (current === output.content) {
      console.log(`OK     ${name} is current (${output.summary})`)
    } else if (process.argv.includes('--check')) {
      console.error(`STALE  ${name} (${output.summary})`)
      stale = true
    } else {
      writeFileSync(output.file, output.content)
      console.log(`WROTE  ${name} (${output.summary})`)
    }
  }
  if (stale) {
    console.error('\nThe recorded device audit does not match what it claims to have rendered.\nRun: node tools/scripts/record-ai-page-axe.mts')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
