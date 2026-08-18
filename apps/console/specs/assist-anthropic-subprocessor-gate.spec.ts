/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RELEASE_FLAGS } from '@aglyn/aglyn'

// `assist-usage` reaches the admin barrel only for FieldValue, and the barrel
// pulls the whole tenancy surface (and `next/cache`) with it. Stubbed to the
// two sentinels the batch writes, so the path assertions below stay about
// PATHS.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: {
      FieldValue: {
        increment: (n: number) => ({ __inc: n }),
        serverTimestamp: () => '__now__',
      },
    },
  },
}))

import {
  recordAssistExchange,
  reserveAssistMessage,
} from '../app/api/_lib/assist-usage'

/**
 * AGL-1909: Anthropic must be a published subprocessor BEFORE it processes
 * customer content — and the dependency has to be structural, because as
 * filed it lived in prose on a checklist line already ticked Done.
 *
 * Three claims, each able to go red on its own:
 *
 *  1. `release_assist` still ships OFF, and its description still names both
 *     published preconditions. The description is the only place the
 *     precondition travels with the thing it gates — it is what a staff user
 *     reads in the flags admin at the moment they are deciding to flip it.
 *  2. The set of files that read `ANTHROPIC_API_KEY` is exactly the known
 *     list. This is the load-bearing one.
 *  3. Every Assist record is written UNDER the org document, which is what
 *     makes the retention promise in the privacy disclosure true.
 *
 * ## Why the key, and not the flag
 *
 * AGL-1909 was filed on the premise that flipping `release_assist` is what
 * turns Anthropic into a production subprocessor. It is not, and the
 * difference matters for the ordering the issue exists to protect:
 * `/api/ai/assist` — the besigner copy assistant, AGL-89/130/169, registered
 * unconditionally in `libs/plugins/marketplace/src/lib/server.ts` — carries no
 * release flag at all. It sends customer site copy, blog bodies and section
 * briefs to Anthropic on `ANTHROPIC_API_KEY` plus a Pro entitlement, and
 * nothing else. So setting that key in production makes Anthropic a
 * subprocessor whether or not the Assist flag is ever flipped, and a guard
 * that watched only the flag would pass while the page was already wrong.
 *
 * Test (2) therefore watches the key. A new reader is a new Anthropic data
 * flow, and it fails here until someone has looked at whether the published
 * subprocessor page and privacy disclosure still describe reality.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * Every tracked source file that reads `ANTHROPIC_API_KEY`, and what data it
 * sends to Anthropic when the key is set. Documentation is excluded below —
 * this is about code paths that can move customer content.
 *
 * Adding an entry is the point at which someone must ask whether
 * `/legal/subprocessors` and the privacy disclosure still describe what the
 * platform does. Do not add one to make this suite pass.
 */
const KEY_READERS = new Map<string, string>([
  [
    'apps/console/app/api/assist/chat/route.ts',
    'Aglyn Assist (AGL-1860): the customer question, a trailing window of the thread, and — on Pro+ — the current route, host and org name. Gated by `release_assist` AND the key.',
  ],
  [
    'libs/plugins/marketplace/src/lib/server/ai-assist.ts',
    'Besigner copy assistant (AGL-89/130/169) at /api/ai/assist: element copy, blog bodies with title/excerpt, and section briefs. NO release flag — the key plus a Pro entitlement is the whole gate.',
  ],
])

/**
 * Tracked files that NAME the key without sending anything to Anthropic —
 * provisioning, documentation, specs, and the legal record. Each carries why,
 * because the interesting ones are not the docs.
 */
const MENTIONS_ONLY = new Map<string, string>([
  [
    'tools/scripts/bootstrap-platform.mjs',
    'The provisioning script that SETS the key on the Vercel projects. Not a data flow — it is the act that starts every data flow above, and therefore the step AGL-1909 orders after publication.',
  ],
  [
    'apps/console/constants/legal-documents.ts',
    "The legal snapshot record. Its v3 note (2026-08-14, AGL-1555) says the Privacy Policy's §3 provider bullet DROPS Anthropic because `ANTHROPIC_API_KEY` is absent from production and the AI-assist route 501s — so the privacy page, not only /legal/subprocessors, was rewritten on that premise and becomes wrong when the key is set.",
  ],
  [
    'libs/aglyn/src/lib/app-utils/release-flags.ts',
    'The `release_assist` description, which carries the precondition this suite pins.',
  ],
  [
    'docs/BREACH_NOTIFICATION.md',
    'The credential-rotation checklist (AGL-1915) lists the key among the secrets to rotate after an incident. Naming a secret in a runbook is the opposite of a data flow — but the suite is right to have stopped on it, because "a new file mentions ANTHROPIC_API_KEY" is exactly the event it exists to make someone look at.',
  ],
  [
    'cloud/firebase-remoteconfig.template.json',
    'The DEPLOYED flag seed and its staff-facing description — the one that actually decides the flag in production.',
  ],
  [
    'apps/console/app/api/assist/chat/route.spec.ts',
    'Sets a fake key to exercise the 501 gate.',
  ],
  [
    'apps/console/.env.development.local.example',
    'Local development template.',
  ],
  [
    'libs/plugins/marketplace/src/lib/components/ai-assist-provider.component.tsx',
    'Client component; names the key only to explain the 501 degrade.',
  ],
  ['docs/PLATFORM_PROVISIONING.md', 'Documentation.'],
  ['apps/docs/docs/developers/self-hosting.md', 'Documentation.'],
  [
    'docs/BREACH_NOTIFICATION.md',
    'The breach runbook (AGL-1915). Names the key only in the list of credentials to rotate after an exposure, alongside FIREBASE_PRIVATE_KEY and STRIPE_SECRET_KEY — a rotation target, not a data flow to Anthropic.',
  ],
  [
    'apps/console/specs/assist-anthropic-subprocessor-gate.spec.ts',
    'This suite.',
  ],
])

/** Tracked files naming the env var at all, build output excluded. */
function filesNamingTheKey(): string[] {
  const tracked = execSync('git ls-files', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.includes('/build/'))
  return tracked.filter((path) => {
    try {
      return readFileSync(join(REPO_ROOT, path), 'utf8').includes(
        'ANTHROPIC_API_KEY',
      )
    } catch {
      // Binary or unreadable — it is not source that reads an env var.
      return false
    }
  })
}

describe('the Assist flag carries its own legal precondition (AGL-1909)', () => {
  const assist = RELEASE_FLAGS.find((flag) => flag.key === 'release_assist')

  it('is still OFF by default', () => {
    // Flipping the default in code — as opposed to per-org in the staff
    // console, which is the reviewable path — must be a failing test rather
    // than a quiet deploy.
    expect(assist).toBeTruthy()
    expect(assist?.defaultEnabled).toBe(false)
  })

  it('names BOTH published artifacts that gate it, and names Anthropic', () => {
    // The precondition has to travel with the flag: this description is what
    // a staff user reads in the flags admin at the moment they decide to
    // flip it. AGL-1909 exists because the same precondition, written on a
    // checklist line already ticked Done, read as satisfied.
    const description = String(assist?.description ?? '')
    expect(description).toContain('/legal/subprocessors')
    expect(description).toContain('Anthropic')
    expect(description).toMatch(/privacy/i)
    expect(description).toContain('AGL-1909')
  })

  it('is seeded OFF in the Remote Config template too', () => {
    // `defaultEnabled` above is only the fallback for an unreachable Remote
    // Config. THIS file is what gets deployed and what actually decides the
    // flag in production, so a guard that watched only the TypeScript
    // constant would pass while the deployed template said `true` — and the
    // constant's own doc comment requires the two to agree.
    const template = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'cloud/firebase-remoteconfig.template.json'),
        'utf8',
      ),
    )
    const seeded = template.parameters?.release_assist
    expect(JSON.parse(seeded.defaultValue.value)).toMatchObject({
      enabled: false,
    })
    // And the precondition travels with it here as well: this description is
    // what a staff user sees in the Firebase console.
    expect(seeded.description).toContain('/legal/subprocessors')
    expect(seeded.description).toContain('ANTHROPIC_API_KEY')
    expect(seeded.description).toContain('AGL-1909')
  })

  it('says the KEY is the trigger, not the flag', () => {
    // The correction to the issue's own premise. A reader who takes the flag
    // for the gate will set the key first and publish second, which is the
    // exact ordering AGL-1909 exists to prevent.
    expect(String(assist?.description ?? '')).toContain('ANTHROPIC_API_KEY')
  })
})

describe('every Anthropic data flow is a known one (AGL-1909)', () => {
  it('has exactly the expected files reading ANTHROPIC_API_KEY', () => {
    // The guard that can catch a flow nobody declared. A new reader is a new
    // customer-content path to Anthropic, and it fails here until someone
    // has checked the published subprocessor page against reality.
    const readers = filesNamingTheKey().filter(
      (path) => !MENTIONS_ONLY.has(path),
    )
    expect(readers.sort()).toEqual([...KEY_READERS.keys()].sort())
  })

  it('keeps the mentions-only list honest', () => {
    // Without this, a stale exemption silently widens what is allowed: a file
    // that stopped naming the key at all would keep excusing a future one
    // that does. Same staleness check the naming sweep uses.
    const naming = new Set(filesNamingTheKey())
    for (const path of MENTIONS_ONLY.keys()) {
      expect([path, naming.has(path)]).toEqual([path, true])
    }
  })

  it('records the besigner assistant as unflagged, so nobody re-derives it', () => {
    const besigner = KEY_READERS.get(
      'libs/plugins/marketplace/src/lib/server/ai-assist.ts',
    )
    expect(besigner).toContain('NO release flag')
    // And the claim is checked against the source, not just asserted about
    // the comment: the handler is registered with no flag around it.
    const server = readFileSync(
      join(REPO_ROOT, 'libs/plugins/marketplace/src/lib/server.ts'),
      'utf8',
    )
    expect(server).toContain("registerPluginApiRoute('ai/assist', aiAssistHandler)")
    const handler = readFileSync(
      join(REPO_ROOT, 'libs/plugins/marketplace/src/lib/server/ai-assist.ts'),
      'utf8',
    )
    expect(handler).not.toMatch(/isServerReleaseFlagOnForOrg|release_/)
  })
})

/**
 * The retention half of the disclosure, pinned as behaviour.
 *
 * The privacy text can promise that erasing a workspace erases its assistant
 * history only because all four Assist collections are genuine
 * SUBCOLLECTIONS of the org document — `eraseOrg` finishes with
 * `recursiveDelete(orgRef)`, and a path-scoped cascade is structurally blind
 * to anything not under the path. `apiKeys`, `ssoDomains` and the console
 * domain claims are the standing proof of that blindness: each carries
 * `orgId` as a FIELD and needed its own sweep.
 *
 * So this asserts the WRITES, not the doc comment. The standing condition it
 * enforces: if a later phase denormalizes exchanges into a top-level
 * staff-mining collection — which the AGL-1860 spec explicitly wants, ranking
 * docs gaps by question frequency across orgs — this goes red, and the right
 * response is to change the published policy or add the sweep, not to widen
 * the assertion.
 */
describe('assist records stay reachable by eraseOrg (AGL-1860, AGL-1909)', () => {
  it('writes every record under orgs/{orgId}/', async () => {
    const written: string[] = []
    const makeDoc = (path: string) => ({
      path,
      id: path.split('/').pop(),
      collection: (name: string) => makeCollection(`${path}/${name}`),
    })
    const makeCollection = (prefix: string) => ({
      doc: (id?: string) => makeDoc(`${prefix}/${id ?? 'auto-1'}`),
    })
    const firestore = {
      collection: (name: string) => makeCollection(name),
      // The counters/rollup writes moved into the RESERVATION (AGL-2057), so
      // the erasure surface is only complete if this test drives both halves.
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: async () => ({
            exists: false,
            data: () => undefined,
            get: () => undefined,
          }),
          set: (ref: { path: string }) => {
            written.push(ref.path)
          },
        }),
      batch: () => ({
        set: (ref: { path: string }) => {
          written.push(ref.path)
        },
        commit: async () => undefined,
      }),
    } as unknown as FirebaseFirestore.Firestore

    await reserveAssistMessage(firestore, 'org-1', false)
    await recordAssistExchange(firestore, 'org-1', {
      uid: 'user-1',
      question: 'How do I publish?',
      answer: 'Press Publish.',
      route: '/acme/screens',
      hostId: 'host-1',
      model: 'claude-sonnet-5',
      tier: 'free',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      docsPaths: [],
      stopReason: 'end_turn',
    })

    // All FOUR: the exchange, its signal, the daily counter, the monthly
    // rollup. `assistSignals` is the half AGL-1972 split out so the prose
    // could be given a TTL without destroying the data loop — and splitting
    // it created a new collection, which is precisely the moment a cascade
    // silently stops covering everything. The length is asserted so a fifth
    // collection added later cannot slip past this list unnoticed.
    // Deduped: the monthly rollup is touched by BOTH halves now — the
    // reservation counts the message, the batch folds in the tokens.
    const distinct = [...new Set(written)]
    expect(distinct).toHaveLength(4)
    for (const path of distinct) {
      expect([path, path.startsWith('orgs/org-1/')]).toEqual([path, true])
    }
    expect(distinct.map((path) => path.split('/')[2]).sort()).toEqual([
      'assistExchanges',
      'assistSignals',
      'assistUsage',
      'counters',
    ])
  })

  it('still finishes eraseOrg with a recursive delete of the org doc', () => {
    // The other half of the reachability claim. Org-scoped paths only help
    // while something actually walks the org tree; if this call goes away the
    // subcollection assertion above becomes decorative.
    const erase = readFileSync(
      join(REPO_ROOT, 'libs/tenant/data/admin/src/lib/server/erase.ts'),
      'utf8',
    )
    expect(erase).toContain('recursiveDelete(orgRef)')
  })
})
