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
 * The pictures on the guided start's style cards (AGL-3898): for each kind of
 * site in `AI_SITE_KINDS`, a real page drawn in that kind's style.
 *
 *   node libs/plugins/ai/scripts/render-site-style-previews.mts [--only <kind>,<kind>]
 *
 * WHAT IS DRAWN. The page every new site is born with — the starter home page
 * inside the starter header and footer (`default-site.ts`) — in the theme the
 * look unit builds for the kind (`aiSiteStyleFor` over an empty model answer,
 * so every choice is the kind's own, drawn by a fixed seed per kind, then
 * `aiSiteTheme` over the base preset it names). Nothing is mocked and no model
 * is called: the look is the code's, and the page is rendered by
 * `render-layout-shots.mts` with the real component bundles and node renderer
 * in headless Chrome at 1440 wide. Entrance motion is left off the page, so
 * the shot is the page at rest rather than halfway through its hero's climb.
 *
 * A real site of the kind gets its own variation inside the same style — its
 * own seed and the model's choices for that business — which the style step
 * says beside the cards.
 *
 * WHAT IT WRITES, per kind, into `libs/plugins/ai/src/lib/assets/site-styles/`:
 * `<kind>.webp`, the top of the page at 1440 × 900 scaled to 800 × 500. Each
 * must stay under 80 KB; the run fails on one that does not.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(join(ROOT, 'package.json'))
const OUT = join(ROOT, 'libs/plugins/ai/src/lib/assets/site-styles')
const WIDTH = 800
const HEIGHT = 500
const MAX_BYTES = 80 * 1024
/** The name the starter header and footer show. */
const SITE_NAME = 'Your business'
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const onlyAt = argv.indexOf('--only')
  const only = onlyAt === -1 ? null : new Set(String(argv[onlyAt + 1] ?? '').split(',').filter(Boolean))
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    alias: readAliases(),
    jsx: true,
    interopDefault: true,
    moduleCache: true,
    fsCache: join(tmpdir(), 'aglyn-ai-style-previews-jiti'),
    sourceMaps: false,
  })
  const load = (file: string): Promise<Dict> => jiti.import(join(ROOT, file)) as Promise<Dict>
  const kinds = await load('libs/plugins/ai/src/lib/model/ai-site-kinds.ts')
  const look = await load('libs/plugins/ai/src/lib/model/ai-site-look.ts')
  const defaults = await load('libs/aglyn/src/lib/app-utils/default-site.ts')
  const animation = await load('libs/aglyn/src/lib/app-utils/element-animation.ts')

  // The starter home page, at rest: its entrance motion props taken off.
  const page: Dict = JSON.parse(JSON.stringify(defaults.buildDefaultHomeScreen(SITE_NAME).nodes))
  for (const node of Object.values(page) as Dict[]) {
    if (!node?.props) continue
    for (const prop of animation.NODE_ANIMATION_PROPS as string[]) delete node.props[prop]
  }
  const layout = defaults.buildDefaultSiteLayout('home').nodes

  const work = join(tmpdir(), `aglyn-ai-style-previews-${process.pid}`)
  mkdirSync(work, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  const inputs: string[] = []
  for (const kind of kinds.AI_SITE_KINDS as Dict[]) {
    if (only && !only.has(kind.id)) continue
    const style = look.aiSiteStyleFor({ kind, answer: look.aiReadSiteLook({}), seed: look.aiSiteSeed(`style-preview:${kind.id}`) })
    const file = join(work, `${kind.id}.json`)
    writeFileSync(file, JSON.stringify({ name: SITE_NAME, nodes: layout, page, style }))
    inputs.push(file)
  }
  execFileSync(process.execPath, [join(ROOT, 'libs/plugins/ai/scripts/render-layout-shots.mts'), '--out', work, '--page-only', ...inputs], {
    stdio: 'inherit',
    cwd: ROOT,
  })

  const sharp = require('sharp')
  for (const input of inputs) {
    const key = input.slice(work.length + 1).replace(/\.json$/, '')
    const shot = join(work, `${key}-page-desktop-light.png`)
    // The page was shot at twice its size: the first 1440 × 900 is 2880 × 1800.
    const meta = await sharp(shot).metadata()
    const scale = (meta.width ?? 2880) / 1440
    const target = join(OUT, `${key}.webp`)
    await sharp(shot)
      .extract({ left: 0, top: 0, width: Math.round(1440 * scale), height: Math.min(meta.height ?? 0, Math.round(900 * scale)) })
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'top' })
      .webp({ quality: 72, effort: 6 })
      .toFile(target)
    const bytes = statSync(target).size
    console.log(`PREVIEW   ${key}.webp ${(bytes / 1024).toFixed(1)} KB`)
    if (bytes > MAX_BYTES) throw new Error(`${key}.webp is ${bytes} bytes, over ${MAX_BYTES}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
