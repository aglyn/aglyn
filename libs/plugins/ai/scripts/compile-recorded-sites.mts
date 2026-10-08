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
 * Recorded model answers compiled again with TODAY'S compiler, offline
 * (AGL-3660): the cheapest way to see what a change to the layout compiler,
 * the look or the picture fill does to real sites, with no model call.
 *
 *   node libs/plugins/ai/scripts/compile-recorded-sites.mts --out <dir> <input>…
 *
 * An input is either
 *
 *  - a GUIDED-START RUN: the JSON `{ look, frame, plans: [plan], forms, pages }`
 *    — the tool inputs one guided start's recordings carried
 *    (`submit_site_look`, `submit_frame`, `submit_build_plan`, `submit_form`
 *    and each `submit_page`, in plan order), as a dev replay cache
 *    (`.cache/ai-replay`) holds them; `--kind <id>` and `--name <words>` say
 *    what the run was, where its plan does not; or
 *  - a LAYOUT-EVAL BRIEF: `<dir>/<key>` naming the files the layout-language
 *    live spec writes under `AGLYN_LIVE_AI_OUT` — `<key>-site.json` (its look
 *    and compiled layout) and `<key>-<page>.answer-<n>.json` (each page's
 *    answers; the last one is taken). Its plan is read from `--plans <json>`,
 *    `{ "<key>": [{ "title", "slug", "sections": [{ "name", "items" }] }] }`.
 *
 * Each page is held to the page step's own check (`aiLayoutPageCheck`: the
 * reader, the compiler, the store, the copy check and the doctrine), and its
 * empty picture slots are filled from the starter photos as the page step
 * fills them. A page the check refuses is reported and written anyway, so a
 * shot still shows it. What it writes, per page, is a
 * `render-layout-shots.mts` input: `<out>/<key>-<page>.json`.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(join(ROOT, 'package.json'))
type Dict = Record<string, any>

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

function option(argv: string[], name: string): string | null {
  const at = argv.indexOf(name)
  return at === -1 ? null : (argv[at + 1] ?? null)
}

const slugKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'page'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const out = option(argv, '--out')
  if (!out) throw new Error('Usage: compile-recorded-sites.mts --out <dir> [--kind <id>] [--name <words>] [--plans <json>] <input>…')
  const kindOverride = option(argv, '--kind')
  const nameOverride = option(argv, '--name')
  const plansFile = option(argv, '--plans')
  const valued = new Set(['--out', '--kind', '--name', '--plans'])
  const inputs = argv.filter((arg, index) => !valued.has(arg) && !valued.has(argv[index - 1] ?? ''))
  mkdirSync(resolve(out), { recursive: true })

  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    alias: readAliases(),
    jsx: true,
    interopDefault: true,
    moduleCache: true,
    fsCache: join(tmpdir(), 'aglyn-ai-recorded-sites-jiti'),
    sourceMaps: false,
  })
  const load = (file: string): Promise<Dict> => jiti.import(join(ROOT, file)) as Promise<Dict>
  const language = await load('libs/plugins/ai/src/lib/jobs/ai-job-page-language.ts')
  const frameJob = await load('libs/plugins/ai/src/lib/jobs/ai-job-layout-language.ts')
  const sectionsJob = await load('libs/plugins/ai/src/lib/jobs/ai-job-page-sections.ts')
  const pictures = await load('libs/plugins/ai/src/lib/layout-language/ai-layout-pictures.ts')
  const kinds = await load('libs/plugins/ai/src/lib/model/ai-site-kinds.ts')
  const look = await load('libs/plugins/ai/src/lib/model/ai-site-look.ts')
  const inventoryMod = await load('libs/plugins/ai/src/lib/model/ai-site-inventory.ts')

  const FORM_ID = 'form-contact'
  const LAYOUT_ID = 'layout-main'

  /** One site's pages compiled, written as shot inputs. */
  const compileSite = async (site: {
    key: string
    name: string
    kind: Dict
    style: Dict
    facts: string
    pages: Array<{ id: string; title: string; slug: string; sections: Dict[]; answer: unknown }>
    frame?: unknown
    layoutNodes?: Dict
    form?: { rootId: string; nodes: Dict } | null
  }) => {
    const inventory = {
      ...inventoryMod.emptyAiSiteInventory('host-recorded'),
      layouts: [{ id: LAYOUT_ID, name: 'Main Layout', parentId: null }],
      forms: [{ id: FORM_ID, name: 'Contact form', fields: ['Name', 'Email', 'Message'] }],
      components: [],
    }
    const sitePages = site.pages.map((page) => ({ id: page.id, label: page.title, slug: page.slug }))
    const job = (id: string) => ({
      $id: id,
      brief: site.facts,
      inputs: {
        businessName: site.name,
        siteKind: site.kind.id,
        siteStyle: { ...site.style },
        sitePages,
        [language.AI_LAYOUT_LANGUAGE_INPUT]: true,
        [language.AI_LAYOUT_FORM_PAGE_INPUT]: null,
      },
    })
    let layoutNodes = site.layoutNodes ?? null
    if (site.frame) {
      const unit = job(`job-recorded-${site.key}-layout`)
      const targets = frameJob.aiLayoutFrameTargets(unit, inventory)
      const check = frameJob.aiLayoutFrameCheck({
        headerAlign: site.style['headerAlign'],
        siteName: site.name,
        homeId: site.pages[0]?.id ?? null,
        pages: sitePages,
        targets,
        extend: () => [],
      })
      const checked = check(site.frame)
      if (checked.violations.length) console.log(`REFUSED   ${site.key} frame: ${checked.violations.map((v: Dict) => v.code).join(', ')}`)
      layoutNodes = checked.value?.nodes ?? null
    }
    for (const page of site.pages) {
      const unit = job(`job-recorded-${site.key}-${page.id}`)
      const screen = {
        id: page.id,
        title: page.title,
        slug: page.slug,
        layout: LAYOUT_ID,
        sections: page.sections.map((section) => ({ name: section.name, uses: section.uses ?? [], items: section.items ?? 0 })),
      }
      const sectionIds = screen.sections.map((_: unknown, position: number) => sectionsJob.aiPageSectionNodeId(unit.$id, position))
      const { linkablePages } = sectionsJob.aiPageLinkablePages(inventory, sitePages, [page.id])
      const context = {
        ...sectionsJob.aiPageCheckContext(inventory, { reusableComponents: false, sections: screen.sections.map((s: Dict) => s.name), linkablePages }),
        codeBuilt: true,
      }
      const targets = language.aiLayoutPageTargets({ job: unit, inventory, own: [page.id] })
      const check = language.aiLayoutPageCheck({
        screen,
        sectionIds,
        targets,
        context,
        reusableComponents: false,
        // Read by a compiler that designs per site kind and seed; ignored by one that does not.
        ...(language.aiLayoutDesignOf ? { design: language.aiLayoutDesignOf(unit, page.slug) } : {}),
      })
      // The page step's last answer has its gaps taken out rather than refused.
      let checked = check(page.answer)
      for (let again = 1; again < 3 && !checked.value; again += 1) checked = check(page.answer)
      if (!checked.value) {
        console.log(`REFUSED   ${site.key} ${page.title}: ${checked.violations.map((v: Dict) => `${v.code} ${v.message}`).join(' | ')}`)
        continue
      }
      const pictured = await pictures.aiResolveLayoutPictures(checked.value.nodes, {
        rootId: '_@_',
        sectionIds,
        sectionNames: screen.sections.map((s: Dict) => s.name),
        seed: `${unit.$id}:${page.id}`,
        kind: site.kind.id,
      })
      const file = join(resolve(out), `${site.key}-${slugKey(page.title)}.json`)
      writeFileSync(
        file,
        JSON.stringify(
          {
            name: site.name,
            nodes: layoutNodes,
            page: pictured,
            style: site.style,
            ...(site.form ? { forms: { [FORM_ID]: site.form } } : {}),
          },
          null,
          1,
        ),
      )
      console.log(`WROTE     ${basename(file)}${checked.value.settled.length ? ` (${checked.value.settled.length} settled)` : ''}`)
    }
  }

  const plans: Dict = plansFile ? JSON.parse(readFileSync(resolve(plansFile), 'utf8')) : {}
  for (const input of inputs) {
    const path = resolve(input)
    if (existsSync(path) && path.endsWith('.json')) {
      // A guided-start run.
      const run = JSON.parse(readFileSync(path, 'utf8')) as Dict
      const plan = run['plans'][0] as Dict
      const screens = plan['screens'] as Dict[]
      const first = screens[0] ?? {}
      const name = nameOverride ?? String(first['seoTitle'] ?? 'Site').split(/\s[|–—-]\s/)[0].trim()
      const facts = screens.map((screen) => `${screen['seoTitle'] ?? ''}. ${screen['seoDescription'] ?? ''}`).join('\n')
      const kind = (kindOverride ? kinds.aiSiteKind(kindOverride) : null) ?? kinds.aiSiteKindFor(facts)
      // The ids the recorded answers link to, by the label they carry.
      const ids = new Map<string, string>()
      const collect = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(collect)
        else if (value && typeof value === 'object') {
          const record = value as Dict
          if (typeof record['to'] === 'string' && /^page:/.test(record['to']) && typeof record['title'] === 'string') ids.set(record['title'].toLowerCase(), record['to'].slice(5))
          if (typeof record['to'] === 'string' && /^page:/.test(record['to']) && typeof record['text'] === 'string' && record['kind'] === 'button') ids.set(`button:${record['text'].toLowerCase()}`, record['to'].slice(5))
          Object.values(record).forEach(collect)
        }
      }
      collect(run['frame'])
      collect(run['pages'])
      const key = slugKey(basename(path, '.json'))
      const created = new Set(((plan['create'] ?? []) as Dict[]).filter((entry) => entry['kind'] === 'form').map((entry) => `new:${entry['name']}`.toLowerCase()))
      const pages = screens.map((screen, index) => ({
        id: ids.get(String(screen['title']).toLowerCase()) ?? `${key}-p${index}`,
        title: String(screen['title']),
        slug: String(screen['slug']),
        sections: (screen['sections'] as Dict[]).map((section) => ({
          ...section,
          uses: ((section['uses'] ?? []) as string[]).map((ref) => (created.has(ref.toLowerCase()) ? FORM_ID : ref)),
        })),
        answer: run['pages'][index],
      }))
      const formTree = (run['forms']?.[0]?.['tree'] as string | undefined) ?? null
      let form: { rootId: string; nodes: Dict } | null = null
      if (formTree) {
        const parsed = JSON.parse(formTree) as { rootId: string; nodes: Dict }
        const nodes: Dict = {}
        for (const [id, node] of Object.entries(parsed.nodes)) {
          nodes[`${FORM_ID}__${id}`] = {
            ...(node as Dict),
            $id: `${FORM_ID}__${id}`,
            pluginId: 'forms',
            parentId: id === parsed.rootId ? null : `${FORM_ID}__${parsed.rootId}`,
            ...(id === parsed.rootId ? { props: { ...(node as Dict)['props'], formId: FORM_ID } } : {}),
            nodes: (((node as Dict)['nodes'] ?? []) as string[]).map((child) => `${FORM_ID}__${child}`),
          }
        }
        form = { rootId: `${FORM_ID}__${parsed.rootId}`, nodes }
      }
      const style = look.aiSiteStyleFor({ kind, answer: look.aiReadSiteLook(run['look']), seed: look.aiSiteSeed(`recorded:${key}`) })
      await compileSite({ key, name, kind, style, facts, pages, frame: run['frame'], form })
      continue
    }
    // A layout-eval brief: <dir>/<key>.
    const dir = dirname(path)
    const key = basename(path)
    const site = JSON.parse(readFileSync(join(dir, `${key}-site.json`), 'utf8')) as Dict
    const kind = kinds.aiSiteKind(site['kind']) ?? kinds.aiSiteKindFor(String(site['name']))
    const planned = (plans[key] ?? []) as Dict[]
    const answers = readdirSync(dir).filter((file) => file.startsWith(`${key}-`) && /\.answer-\d+\.json$/.test(file))
    const pages = planned.flatMap((page, index) => {
      const own = answers
        .filter((file) => file.startsWith(`${key}-${String(page['title']).toLowerCase()}.answer-`))
        .sort()
      if (!own.length) return []
      return [
        {
          id: `${key}-p${index}`,
          title: String(page['title']),
          slug: String(page['slug']),
          sections: (page['sections'] as Dict[]).map((section) => ({ uses: [], items: 0, ...section })),
          answer: JSON.parse(readFileSync(join(dir, own[own.length - 1]), 'utf8')),
        },
      ]
    })
    await compileSite({
      key: `eval-${key}`,
      name: String(site['name']),
      kind,
      style: site['style'],
      facts: String(site['name']),
      pages,
      layoutNodes: site['nodes'],
      form: null,
    })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
