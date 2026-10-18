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
 * site in `AI_SITE_KINDS`, the top of a home page built the way a site job
 * builds one in that style.
 *
 *   node libs/plugins/ai/scripts/render-site-style-previews.mts [--only <kind>,<kind>]
 *
 * WHAT IS DRAWN. Each kind's stand-in home page (`site-style-previews.json`),
 * in that kind's own shape: a photographer's gallery, a café's menu, a
 * store's product grid, a blog's latest posts, a festival's days, an agent's
 * listings, a yoga studio's week of classes. The sections are written by hand
 * in the layout language the page step answers in, never by a model, so no AI
 * call is made. `compile-recorded-sites.mts` holds each to the page step's
 * own check and compiles it with the real compiler, in the design variants
 * the kind draws with (`ai-layout-design.ts`) and the look its look unit
 * builds (`aiSiteStyleFor` over an empty model answer); the seed is the first
 * that gives the kind the hero (and any other choice) its page is written
 * for. A kind whose shape is a grid opens on it: a first section with more
 * than one picture is drawn as written rather than as a designed hero.
 *
 * THE PHOTOS are the starter photos, never a download: whole, or a part of
 * one (`crop`), so the café's shelves and its owner can lead two different
 * pages. A kind none of them suits (a roofer, a gym, a band) opens on type
 * over its own band rather than on a photo that says the wrong thing.
 * `render-layout-shots.mts` renders each page with the real component
 * bundles in headless Chrome.
 *
 * WHAT IT WRITES, per kind, into `libs/plugins/ai/src/lib/assets/site-styles/`:
 * `<kind>.webp`, the top 1024 × 1024 of the page drawn in a 1024 × 480 window
 * (a short window keeps a cover hero short, so the section that shows the
 * kind's shape is in the picture), scaled to 800 × 800. At the width a card
 * shows it, the heading's font and the buttons still read. Each must stay
 * under 80 KB; the run fails on one that does not.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(join(ROOT, 'package.json'))
const OUT = join(ROOT, 'libs/plugins/ai/src/lib/assets/site-styles')
const FIXTURE = join(ROOT, 'libs/plugins/ai/scripts/site-style-previews.json')
const MUG = join(ROOT, 'tools/ai-eval/fixtures/product/stoneware-mug.jpg')
/** The starter photos (`default-site.ts`), by the keys `AI_LAYOUT_STARTER_PHOTOS` names them. */
const STARTERS = join(ROOT, 'apps/tenant/public/_static/starter')
const STARTER_FILES: Readonly<Record<string, string>> = {
  hero: 'hero-team.jpg',
  about: 'about-owner.jpg',
  desk: 'gallery-desk.jpg',
  plants: 'gallery-plants.jpg',
  craft: 'gallery-craft.jpg',
}
/** The window the page is drawn in, and the part of it the picture keeps. */
const VIEWPORT = { width: 1024, height: 480 }
const CROP = { width: 1024, height: 1024 }
const SIZE = { width: 800, height: 800 }
const MAX_BYTES = 80 * 1024
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

/**
 * A part of a starter photo, as a picture given whole: `crop` is its left,
 * top, width and height in the photo's own pixels, so one photo can open two
 * kinds' pages on different subjects (the café's shelves, the owner).
 */
async function cropped(photo: Dict): Promise<Dict> {
  const sharp = require('sharp')
  const [left, top, width, height] = photo['crop'] as number[]
  const file = join(STARTERS, STARTER_FILES[photo['photo']] ?? '')
  if (!STARTER_FILES[photo['photo']]) throw new Error(`no starter photo named ${photo['photo']}`)
  const scale = Math.min(1, 1200 / width)
  const out = { width: Math.round(width * scale), height: Math.round(height * scale) }
  const jpeg: Buffer = await sharp(file).extract({ left, top, width, height }).resize(out.width, out.height).jpeg({ quality: 82 }).toBuffer()
  return { src: `data:image/jpeg;base64,${jpeg.toString('base64')}`, ...out, alt: photo['alt'] }
}

/** A section as the page tool writes it: every field present. */
function section(raw: Dict): Dict {
  return {
    band: raw['band'] ?? 'plain',
    cols: raw['cols'] ?? [],
    align: raw['align'] ?? 'start',
    blocks: (raw['blocks'] as Dict[]).map((block) => ({
      kind: block['kind'],
      col: block['col'] ?? -1,
      text: block['text'] ?? '',
      to: block['to'] ?? '',
      style: block['style'] ?? 'none',
      icon: block['icon'] ?? '',
      items: ((block['items'] ?? []) as Dict[]).map((item) => ({ title: item['title'] ?? '', text: item['text'] ?? '', to: item['to'] ?? '', icon: item['icon'] ?? '' })),
    })),
  }
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
  const design = await load('libs/plugins/ai/src/lib/layout-language/ai-layout-design.ts')
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { kinds: Record<string, Dict> }
  const mug = `data:image/jpeg;base64,${readFileSync(MUG).toString('base64')}`

  const work = join(tmpdir(), `aglyn-ai-style-previews-${process.pid}`)
  const compiled = join(work, 'compiled')
  mkdirSync(compiled, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  const keys: string[] = []
  for (const kind of kinds.AI_SITE_KINDS as Dict[]) {
    if (only && !only.has(kind.id)) continue
    const page = fixture.kinds[kind.id]
    if (!page) throw new Error(`site-style-previews.json has no page for ${kind.id}`)
    // The first seed that draws this kind with the hero (and any other design choice) the page is written for.
    const wanted: Dict = { ...(page['choices'] ?? {}), hero: page['hero'] }
    let seed = 0
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const candidate = look.aiSiteSeed(`style-preview:${kind.id}:${attempt}`)
      const style = look.aiSiteStyleFor({ kind, answer: look.aiReadSiteLook({}), seed: candidate })
      const choices = design.aiLayoutDesignChoices({ kind: kind.id, seed: style.seed, home: true }) as Dict
      if (Object.entries(wanted).every(([name, value]) => choices[name] === value)) {
        seed = candidate
        break
      }
    }
    if (!seed) throw new Error(`no seed draws ${kind.id} with ${JSON.stringify(wanted)}`)
    const photos = await Promise.all(((page['photos'] ?? []) as (string | Dict)[]).map((photo) => (typeof photo === 'string' ? photo : cropped(photo))))
    const sections = page['sections'] as Dict[]
    const run = {
      seed,
      look: {},
      photos,
      frame: {
        header: section({ blocks: [{ kind: 'button', text: page['cta'], to: '#2', style: 'primary' }] }),
        footer: section({ band: 'soft', cols: [2, 1], blocks: [{ kind: 'text', col: 0, text: `${page['name']}.` }, { kind: 'list', col: 1, items: [{ title: 'Home', to: 'page:Home' }] }] }),
      },
      plans: [
        {
          reuse: [],
          create: [],
          screens: [
            {
              title: 'Home',
              slug: '/',
              seoTitle: `${page['name']} | ${kind.label}`,
              seoDescription: [kind.blurb, page['facts']].filter(Boolean).join('. '),
              sections: sections.map((entry) => ({ name: entry['name'], uses: [], items: entry['items'] ?? ((entry['blocks'] as Dict[]).find((block) => block['items'])?.['items'] ?? []).length })),
            },
          ],
        },
      ],
      forms: [],
      pages: [{ sections: sections.map(section) }],
      ...(page['posts'] ? { posts: page['posts'] } : {}),
    }
    const runFile = join(work, `${kind.id}.json`)
    writeFileSync(runFile, JSON.stringify(run))
    const args = [join(ROOT, 'libs/plugins/ai/scripts/compile-recorded-sites.mts'), '--out', compiled, '--kind', kind.id, '--name', page['name']]
    if (page['products']) {
      const recordsFile = join(work, `${kind.id}-records.json`)
      const products = (page['products'] as Dict[]).map((product) => ({ ...product, imageUrl: product['imageUrl'] === 'mug' ? mug : product['imageUrl'] }))
      writeFileSync(recordsFile, JSON.stringify({ products }))
      args.push('--records', recordsFile)
    }
    execFileSync(process.execPath, [...args, runFile], { stdio: 'inherit', cwd: ROOT })
    // A page the check refused is written nowhere: its reason is in the log above.
    if (!existsSync(join(compiled, `${kind.id}-home.json`))) throw new Error(`the page check refused ${kind.id}'s stand-in page`)
    keys.push(kind.id)
  }
  execFileSync(
    process.execPath,
    [join(ROOT, 'libs/plugins/ai/scripts/render-layout-shots.mts'), '--out', work, '--page-only', '--viewport', `${VIEWPORT.width}x${VIEWPORT.height}`, ...keys.map((key) => join(compiled, `${key}-home.json`))],
    { stdio: 'inherit', cwd: ROOT },
  )

  const sharp = require('sharp')
  for (const key of keys) {
    const shot = join(work, `${key}-home-page-desktop-light.png`)
    // The page was shot at twice its size.
    const meta = await sharp(shot).metadata()
    const scale = (meta.width ?? VIEWPORT.width * 2) / VIEWPORT.width
    const target = join(OUT, `${key}.webp`)
    await sharp(shot)
      .extract({ left: 0, top: 0, width: Math.round(CROP.width * scale), height: Math.min(meta.height ?? 0, Math.round(CROP.height * scale)) })
      .resize(SIZE.width, SIZE.height, { fit: 'cover', position: 'top' })
      .webp({ quality: 74, effort: 6 })
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
