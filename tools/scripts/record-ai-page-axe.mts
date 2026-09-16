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
 * Records the accessibility audit of the page job's golden briefs (AGL-2907).
 * Emits one GENERATED file:
 *
 *   libs/plugins/ai/src/lib/jobs/fixtures/ai-page-axe.generated.json
 *
 * Each golden page is assembled through the step's OWN section check and page
 * assembly, rendered to markup with the real component bundles and node
 * renderer, and audited with axe-core. The result is a fixture, never a live
 * run: `ai-job-page-evals.spec.ts` reads it, holds every page to zero serious
 * or critical violations, and refuses a recording whose fingerprint no longer
 * matches the goldens it claims to have audited.
 *
 *   node tools/scripts/record-ai-page-axe.mts          (write the file)
 *   node tools/scripts/record-ai-page-axe.mts --check  (fail if it differs)
 *
 * Rendering needs the bundles, which are React modules in TypeScript with
 * `@aglyn/*` aliases, so they load through jiti exactly as the palette
 * generator loads them, inside a jsdom window this script installs as the
 * globals the bundles expect. The run takes a couple of minutes, which is why
 * the audit is recorded here rather than recomputed in a spec.
 *
 * STAND-IN DEFINITIONS. A golden site's reusable components are inventory
 * rows — an id, a name and declared prop names — with no stored definition to
 * graft, so this builds one per row from the declared props: a heading for the
 * first, body text for the rest, which is the shape the definitions in the
 * fixtures' plans describe. The audit therefore measures the page the model
 * wrote and a faithful placeholder for what the site already had.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(
  ROOT,
  'libs/plugins/ai/src/lib/jobs/fixtures/ai-page-axe.generated.json',
)

const require = createRequire(join(ROOT, 'package.json'))

type Dict = Record<string, any>

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
 * time. Written before anything is loaded, since a module that reads
 * `document` while evaluating cannot be given one afterwards.
 */
function installWindow(html: string): Dict {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    url: 'https://example.test/',
    // `outside-only` is what gives the window an `eval` this script can hand
    // the audit library to, without letting the page's own markup run.
    runScripts: 'outside-only',
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
  return dom
}

/** A stand-in definition for an inventory component row, from its declared props. */
function standInDefinition(row: {
  id: string
  name: string
  props?: Record<string, unknown>
}): Dict {
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

/** The whole golden page as the step stores it, folded section by section. */
function assemblePage(fixture: Dict, sections: Dict): Dict {
  const screen = fixture.plan.screens[0]
  const sectionIds = screen.sections.map((_: unknown, index: number) =>
    sections.aiPageSectionNodeId(`job-${fixture.id}`, index),
  )
  const context = sections.aiPageCheckContext(fixture.inventory)
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
 * The page's markup, grafted and rendered the way a published page is: the
 * layout's one `main` around the sections the page owns.
 */
function renderPage(loaded: Dict, fixture: Dict, page: Dict): string {
  const definitions: Dict = {}
  for (const row of fixture.inventory?.components ?? []) {
    definitions[row.id] = standInDefinition(row)
  }
  const grafted = loaded.compose.composeReusableComponentNodes(page, definitions)
  loaded.core.canvas.setNodes(grafted)
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const root = loaded.core.canvas.getNode(loaded.rootId)
  return renderToStaticMarkup(
    React.createElement(
      'main',
      null,
      React.createElement(loaded.renderer.AglynNodeRenderer, { node: root }),
    ),
  )
}

/** Every violation axe finds in one page's document, as the fixture records them. */
async function auditMarkup(markup: string, fixture: Dict): Promise<Dict[]> {
  const title = fixture.seo?.title ?? fixture.id
  const dom = installWindow(
    `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${markup}</body></html>`,
  )
  const source = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8')
  dom.window.eval(source)
  const result = await dom.window.axe.run(dom.window.document, {
    resultTypes: ['violations'],
    // Layout the renderer never computes in jsdom: a color pair and an
    // element's box are measured on a real page, not recorded here.
    rules: { 'color-contrast': { enabled: false } },
  })
  return (result.violations as Dict[]).map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
  }))
}

/** What a recording claims to have audited: the goldens, exactly as they read. */
function fingerprint(fixture: Dict): string {
  return createHash('sha256').update(JSON.stringify(fixture.answers)).digest('hex').slice(0, 16)
}

async function main(): Promise<void> {
  installWindow('<!doctype html><html lang="en"><head><title>Recording</title></head><body></body></html>')
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
  const canvas = (await load('libs/aglyn/src/lib/foundation/constants/canvas.ts')) as Dict
  const loaded = {
    core,
    rootId: canvas.CANVAS_ROOT_ELEMENT_ID as string,
    compose: await load('libs/aglyn/src/lib/app-utils/compose-reusable-components.ts'),
    renderer: await load('libs/aglyn-node-renderer/src/index.ts'),
  }
  const sections = await load('libs/plugins/ai/src/lib/jobs/ai-job-page-sections.ts')
  const { AI_PAGE_BRIEF_FIXTURES } = (await load(
    'libs/plugins/ai/src/lib/jobs/fixtures/ai-page-briefs.ts',
  )) as { AI_PAGE_BRIEF_FIXTURES: Dict[] }

  const pages: Dict[] = []
  for (const fixture of AI_PAGE_BRIEF_FIXTURES) {
    const markup = renderPage(loaded, fixture, assemblePage(fixture, sections))
    pages.push({
      id: fixture.id,
      answers: fingerprint(fixture),
      markupChars: markup.length,
      violations: await auditMarkup(markup, fixture),
    })
  }

  const recorded = {
    note:
      'GENERATED by tools/scripts/record-ai-page-axe.mts (AGL-2907). Do not edit. ' +
      'Each page is the golden brief assembled through the page step, rendered with ' +
      'the component bundles and audited offline; `answers` fingerprints the goldens ' +
      'it was recorded from, and ai-job-page-evals.spec.ts refuses a stale one.',
    axeVersion: JSON.parse(readFileSync(join(ROOT, 'node_modules/axe-core/package.json'), 'utf8'))
      .version,
    rulesOff: ['color-contrast'],
    pages,
  }
  const content = `${JSON.stringify(recorded, null, 2)}\n`
  const current = (() => {
    try {
      return readFileSync(OUT, 'utf8')
    } catch {
      return null
    }
  })()
  const worst = pages.flatMap((page) => page.violations as Dict[]).filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').length
  const summary = `${pages.length} pages, ${worst} serious or critical violation(s)`
  if (current === content) {
    console.log(`OK     ${OUT.slice(ROOT.length + 1)} is current (${summary})`)
  } else if (process.argv.includes('--check')) {
    console.error(
      `STALE  ${OUT.slice(ROOT.length + 1)}\n\n` +
        'The recorded audit does not match the golden briefs.\n' +
        'Run: node tools/scripts/record-ai-page-axe.mts',
    )
    process.exit(1)
  } else {
    writeFileSync(OUT, content)
    console.log(`WROTE  ${OUT.slice(ROOT.length + 1)} (${summary})`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
