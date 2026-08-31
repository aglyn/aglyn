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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../../../..')

/**
 * NOTHING in this repository may claim Aglyn publishes Docker images
 * (AGL-2434), because nothing does and — more to the point — nothing SHOULD
 * until a refactor lands that has not been started.
 *
 * Next textually inlines every `NEXT_PUBLIC_*` value into the client bundles
 * at BUILD time, and `.env.selfhost.example` declares 27 of them: the
 * operator's Firebase client config, their console URL and tenant apex, their
 * brand name, and the operator-identity and DMCA-agent block printed on the
 * public abuse and §512 counter-notice intakes. An image built by us is
 * therefore an image whose bundles carry OUR answers — in practice the unset
 * defaults, several of which are Aglyn's own — into somebody else's
 * deployment, unchangeable without the rebuild the image existed to avoid.
 * That is worse than shipping no image, because it looks like it works.
 *
 * Publishing becomes possible only after the operator-facing public config
 * moves from build time to request time. Until then the honest sentence is
 * `docker compose up --build` from an Apache-2.0 source tree, and this guard
 * is what stops a cheerful edit from quietly promising otherwise.
 *
 * It sweeps DOCUMENTATION AND WORKFLOWS rather than one runbook on purpose:
 * the claim that prompted the issue was written somewhere nobody would think
 * to check, and a guard aimed at the file where the claim is absent proves
 * nothing about the file where it appears.
 */
const CLAIM_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'a registry pull', pattern: /\bdocker\s+pull\b/i },
  { label: 'a registry push', pattern: /\bdocker\s+push\b/i },
  { label: 'GitHub Container Registry', pattern: /\bghcr\.io\b/i },
  { label: 'Docker Hub', pattern: /\bhub\.docker\.com\b/i },
  { label: 'a Docker Hub namespace', pattern: /\bdocker\.io\/aglyn\b/i },
  { label: 'an image-publishing action', pattern: /\bbuild-push-action\b/i },
  { label: 'a registry login action', pattern: /\bdocker\/login-action\b/i },
  {
    label: 'prose promising prebuilt images',
    pattern: /\b(pre-?built|published|official)\s+(docker\s+)?images?\b/i,
  },
]

/**
 * Lines that match a pattern and are NOT the claim, each with its reason.
 * Deliberately exact strings rather than path exemptions: exempting a whole
 * file is how the next real claim gets in through a file already on the list.
 */
const NOT_A_CLAIM: Array<{ fragment: string; why: string }> = [
  {
    fragment: 'in a third of the published images',
    why: 'tools/e2e — screenshots in the docs, not container images.',
  },
  {
    fragment: 'a self-host image tag',
    why: 'Version-drift commentary naming a hypothetical future consumer.',
  },
  {
    fragment: 'self-host image tag. Every one of them gets',
    why: 'Same sentence, wrapped differently in the sibling module.',
  },
  {
    fragment: 'There is no `docker pull`',
    why: 'SELF_HOSTING.md stating the absence — the opposite of a claim.',
  },
  {
    fragment: 'treat any claim that Aglyn ships prebuilt images',
    why: 'SELF_HOSTING.md saying the claim is false — the opposite of one.',
  },
  {
    fragment: 'claiming Aglyn offers prebuilt images',
    why: 'The docs-site page saying the same, also a denial.',
  },
  {
    fragment: 'Aglyn publishes **no** Docker images',
    why: 'The docs-site denial itself.',
  },
  {
    fragment: 'already-published images get their intrinsic size',
    why: 'CHANGELOG restating a commit about MEDIA images — photographs on a site being measured, not container images. The changelog is generated from commit subjects, so this cannot be reworded in place.',
  },
]

const SWEEP_EXTENSIONS = ['.md', '.mdx', '.yml', '.yaml']

/** Generated output, not authored text — regenerating it is the fix there. */
const GENERATED_PREFIXES = ['apps/docs/build/']

function sweptFiles(): string[] {
  const listed = execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return listed
    .split('\n')
    .filter(Boolean)
    .filter((path) => SWEEP_EXTENSIONS.some((ext) => path.endsWith(ext)))
    .filter(
      (path) => !GENERATED_PREFIXES.some((prefix) => path.startsWith(prefix)),
    )
    .filter((path) => path !== 'libs/aglyn/src/lib/app-utils/' + __filename)
}

function offendingLines(): string[] {
  const offences: string[] = []
  for (const path of sweptFiles()) {
    let body: string
    try {
      body = readFileSync(join(REPO_ROOT, path), 'utf8')
    } catch {
      continue
    }
    body.split('\n').forEach((line, index) => {
      const hit = CLAIM_PATTERNS.find(({ pattern }) => pattern.test(line))
      if (!hit) return
      if (NOT_A_CLAIM.some(({ fragment }) => line.includes(fragment))) return
      offences.push(`${path}:${index + 1} (${hit.label}) — ${line.trim()}`)
    })
  }
  return offences
}

describe('nothing claims Aglyn publishes Docker images (AGL-2434)', () => {
  it('the sweep really reads the repository', () => {
    // Anti-vacuity. A `git ls-files` that returned nothing, or an extension
    // list that matched nothing, would make every assertion below pass while
    // reading zero bytes — the shape of green check this repo has been bitten
    // by before.
    const files = sweptFiles()
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('docs/SELF_HOSTING.md')
    expect(files).toContain('apps/docs/docs/developers/self-hosting.md')
  })

  it('the patterns really would catch a claim', () => {
    // The second half of anti-vacuity: patterns that no longer match are
    // indistinguishable from a repository that never offends.
    const wouldOffend = [
      'Run `docker pull ghcr.io/aglyn/console:latest` to get started.',
      'Use the official images instead of building from source.',
      '      - uses: docker/login-action@v3',
    ]
    for (const line of wouldOffend) {
      expect(CLAIM_PATTERNS.some(({ pattern }) => pattern.test(line))).toBe(true)
    }
  })

  it('no documentation or workflow makes the claim', () => {
    expect(offendingLines()).toEqual([])
  })

  it.each([
    ['docs/SELF_HOSTING.md', 'You build the images; we do not publish any.'],
    [
      'apps/docs/docs/developers/self-hosting.md',
      'Aglyn publishes **no** Docker images',
    ],
  ])(
    '%s says plainly that there is no image to pull',
    (path: string, denial: string) => {
      // Absence of a false claim is weaker than the presence of a true one: a
      // reader arriving from a press release needs the denial where they are
      // looking, not silence. Asserted as an exact sentence rather than a
      // loose pattern — a regex permissive enough to match "no images" also
      // matches half the runbook, and passed with the denial deleted.
      const body = readFileSync(join(REPO_ROOT, path), 'utf8')
      expect(body).toContain(denial)
      // And says WHY, so the next person to propose publishing meets the
      // reason rather than a bare prohibition.
      expect(body).toMatch(/NEXT_PUBLIC/)
      expect(body).toMatch(/docker compose up --build/)
    },
  )
})
