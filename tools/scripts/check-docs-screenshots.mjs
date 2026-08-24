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

// Every image a docs page points at must exist AND carry a picture (AGL-1950).
//
// Docusaurus' own `onBrokenLinks: 'throw'` does not cover this: an asset under
// `static/` is COPIED, not resolved, so a page referencing an image that was
// never captured builds green and ships a broken-image icon. That is how the
// release-docs captures were verified until now — by a human opening each file
// — and a human opening each file is exactly the check that stops being run
// once there are a hundred of them.
//
// The interesting half is the second assertion. A capture harness that fails
// mid-shot, or a `clip` that resolves to a region of empty backdrop, writes a
// perfectly valid PNG of nothing: a real file, of a plausible size, with
// correct dimensions, which passes any check that only asks whether the path
// resolves. So each image is decoded and its per-channel stdev measured.
//
//   npm run check:docs-screenshots
//
// The logic lives in lib/docs-screenshots.mjs and its ability to go red is
// proved by lib/docs-screenshots.test.mjs (`npm run test:docs-screenshots`).
// This file is the walk, the sharp call and the report.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyImage, findImageReferences } from './lib/docs-screenshots.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOCS_ROOT = join(repoRoot, 'apps/docs/docs')
const STATIC_ROOT = join(repoRoot, 'apps/docs/static')

const markdownFiles = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.mdx?$/.test(entry.name)) markdownFiles.push(full)
  }
}
walk(DOCS_ROOT)

const references = []
for (const file of markdownFiles) {
  for (const found of findImageReferences(readFileSync(file, 'utf8'))) {
    references.push({ ...found, file: relative(repoRoot, file) })
  }
}

// A scanner that suddenly matches nothing reports a clean tree, which is the
// same output as a clean tree. Refuse instead of congratulating.
if (references.length === 0) {
  console.error(
    `Refusing to pass: no /img/ references found under ` +
      `${relative(repoRoot, DOCS_ROOT)}. That is a broken scanner, not a ` +
      `clean tree.`,
  )
  process.exit(1)
}

const sharp = (await import('sharp')).default
/** The same image is referenced from several pages; probe each file once. */
const probes = new Map()
const probe = async (absolute) => {
  if (probes.has(absolute)) return probes.get(absolute)
  let result
  try {
    const { size } = statSync(absolute)
    try {
      result = { size, stats: await sharp(absolute).stats(), error: null }
    } catch (error) {
      result = { size, stats: null, error: error.message }
    }
  } catch {
    result = { size: null, stats: null, error: null }
  }
  probes.set(absolute, result)
  return result
}

const failures = []
for (const reference of references) {
  const absolute = join(STATIC_ROOT, reference.url.replace(/^\//, ''))
  const why = classifyImage(await probe(absolute))
  if (why) failures.push({ ...reference, why })
}

if (failures.length) {
  console.error(
    `\n${failures.length} docs image reference(s) do not resolve to a picture:\n`,
  )
  for (const failure of failures) {
    console.error(`  ${failure.file}:${failure.line}`)
    console.error(`    ${failure.url}`)
    console.error(`    ${failure.why}`)
  }
  console.error(
    `\nCapture the shot (apps/docs/SCREENSHOT_PLAN.md) or remove the\n` +
      `reference. A page pointing at a missing image ships a broken-image\n` +
      `icon and still builds green.\n`,
  )
  process.exit(1)
}

console.log(
  `check:docs-screenshots — ${references.length} image reference(s) across ` +
    `${markdownFiles.length} docs pages, ${probes.size} distinct files, all ` +
    `decode to a non-blank image.`,
)
