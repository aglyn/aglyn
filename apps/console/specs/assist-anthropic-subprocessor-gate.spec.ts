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
 *     makes the retention promise in the privacy disclosure true. That claim
 *     drives the AI plugin's meter, so it is pinned beside the meter, in
 *     `libs/plugins/ai/src/lib/usage/assist-records-reachable-by-erase-org.spec.ts`:
 *     an app reaches a plugin only through its generated manifests.
 *
 * ## Why the key, and not the flag
 *
 * AGL-1909 was filed on the premise that flipping `release_assist` is what
 * turns Anthropic into a production subprocessor. It is not, and the
 * difference matters for the ordering the issue exists to protect:
 * `/api/ai/assist` — the besigner copy assistant, AGL-89/130/169, registered
 * unconditionally in `libs/plugins/ai/src/lib/server.ts` — carries no
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
    'libs/plugins/ai/src/lib/providers/anthropic.ts',
    'The Anthropic adapter behind the Aglyn AI provider contract (AGL-2939): it declares the key as its `apiKeyEnv` and puts it on a Messages API request to the host it names. It opens no door of its own and sends whatever request the AI runtime hands it, so what reaches Anthropic is still decided by the doors, the same content to the same subprocessor, and `AI_DOORS` below pins them one by one. The runtime calls it in place of the shared runtime that read the key in `libs/tenant/data/admin` (AGL-2903), which is why that entry left this list and this one stayed.',
  ],
])

/**
 * Every tracked source file that calls the AI runtime, and what customer
 * content it sends to the active provider. The adapter above is the only
 * key reader, so a new door no longer adds a reader — it adds a caller, and
 * this is the list that goes red for it.
 */
const AI_DOORS = new Map<string, string>([
  [
    'libs/plugins/ai/src/lib/server/assist-chat.ts',
    'Aglyn Assist (AGL-1860) at /api/assist/chat: the customer question, a trailing window of the thread, and — on Pro+ — the current route, host and org name. Gated by `release_assist` AND a ready provider. The same URL, content and gates it had as the console route before it moved into the AI plugin (AGL-2939): a move, not a new flow, so /legal/subprocessors still describes it. Its edit rung (AGL-2906) sends one more kind of content, and only behind `release_ai_generative`, the `aiGenerative` entitlement, the caller’s `ai.generate` and the `ai-generate` lockdown key, on a versioned besigner route: an outline of the canvas the member has open — element ids, component ids, layer names, primitive setting values cut to 80 characters (400 for the selected element) and the selected element’s styles. That is site content of the document being edited, the kind the besigner copy assistant already sends; the flag’s own description says turning it on sends site content to Anthropic under the Assist disclosure, and restating the published row for generation is the decision AGL-2902 carries.',
  ],
  [
    'libs/plugins/ai/src/lib/server/ai-assist.ts',
    'Besigner copy assistant (AGL-89/130/169) at /api/ai/assist: element copy, blog bodies with title/excerpt, and section briefs. NO release flag — a ready provider plus a Pro entitlement is the whole gate. The same URL, content and gate it had in the marketplace plugin before it moved into the AI plugin (AGL-2939): a move, not a new flow, so /legal/subprocessors still describes it.',
  ],
  [
    'libs/plugins/ai/src/lib/runtime/ai-doctrine.ts',
    'The building doctrine’s generation loop (AGL-2935), which every generator runs its request through. It sends what the calling door sends — today a generation job’s plan step (`jobs/ai-job-plan-step.ts`): the job’s brief, kind and scalar inputs — together with the site inventory: the names and ids of the site’s reusable components (with their prop names), layouts, templates, forms and datasets (with their field names), content collections and screens (with their slugs), and the theme’s summary, light-scheme colors and fonts. On its one re-ask it also sends the rules the first answer broke, with the offending parts of that answer. Behind `release_ai_generative`, the `aiGenerative` entitlement, the `ai-generate` lockdown key and the `ai.generate` permission. `/legal/subprocessors` describes Anthropic as generating the assistants’ responses from questions, site copy, blog bodies and section briefs; it does not yet name a generation job’s brief or the site structure this inventory sends, so the published row must say so before `release_ai_generative` is on for a customer.',
  ],
  [
    'libs/plugins/ai/src/lib/jobs/ai-job-text-step.ts',
    'A generation job’s text step (AGL-2904): the brief the job was created with. Behind `release_ai_generative`, the `aiGenerative` entitlement and the `ai-generate` lockdown key. It called the shared runtime before the AI plugin existed too; it is listed because the runtime’s callers are now the list that pins each flow, not because the flow is new.',
  ],
  [
    'libs/plugins/ai/src/lib/jobs/ai-job-theme-step.ts',
    'A generation job’s theme step (AGL-2938): the brief, the site’s current theme settings — its colors, font, corner radius, spacing, navigation heights and component style overrides — and brand colors as hex values: a white-label workspace’s brand color, colors read from the site logo in its media library, and colors read from a public page the brief links to. Design settings of the customer’s own site; no visitor or personal data. Behind `release_ai_generative` (staff preview), the `aiGenerative` entitlement, the `ai.generate` permission and the `ai-generate` lockdown key, the same gates as the text step. A NEW flow to the same subprocessor: /legal/subprocessors names the assistant and the copy assistant, and its data description does not yet name generation jobs’ briefs or theme settings. AGL-2902 carries that description, with the Terms, before the flag is released.',
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
    'apps/console/constants/subprocessor-inventory.ts',
    'The subprocessor registry (AGL-1648) — the declarative disclosure of who Aglyn shares data with. It names the key because DISCLOSING the Anthropic relationship is its entire purpose, which makes it the one file whose mention is the opposite of an undisclosed data flow. Note it is imported by nothing but its own spec, so it reads no key and reaches no runtime.',
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
    '.github/workflows/tools-guards.yml',
    'The workflow step that RUNS `check:provider-key-exposure` — the guard proving no model-provider key is reachable from the client closure (AGL-2379). It names the key only in the comment explaining what that guard proves. A workflow that runs a check ABOUT the key is the opposite of a data flow, but the suite is right to have stopped on it: "a new file mentions ANTHROPIC_API_KEY" is exactly the event it exists to make someone look at.',
  ],
  [
    'cloud/firebase-remoteconfig.template.json',
    'The DEPLOYED flag seed and its staff-facing description — the one that actually decides the flag in production.',
  ],
  [
    'libs/plugins/ai/src/lib/server/assist-chat.spec.ts',
    'Sets a fake key to exercise the 501 gate. It moved with the chat door into the AI plugin (AGL-2939); still a test double, not a flow.',
  ],
  [
    'libs/plugins/ai/src/lib/server/assist-chat-edit-rung.spec.ts',
    'Sets a fake key (`test-key`) so the chat door reaches its mocked provider on the edit rung (AGL-2906), and asserts on the request that fake receives — including that the canvas never reaches it below the rung. A test double, not a flow; the door it drives is the `assist-chat.ts` entry in `AI_DOORS`.',
  ],
  [
    'libs/plugins/ai/src/lib/server/ai-assist.spec.ts',
    'Sets a fake key (`sk-test`) to exercise the same 501 gate on the besigner route, and asserts the mocked fetch is never called. Added by AGL-2073; not a data flow. It moved with its handler into the AI plugin (AGL-2939).',
  ],
  [
    'libs/plugins/ai/src/lib/runtime/ai-runtime.spec.ts',
    'Sets a fake key (`sk-test`) to drive the shared runtime against a mocked fetch (AGL-2903), and asserts it refuses to run without one. A test double, not a flow. It moved with the runtime into the AI plugin (AGL-2939).',
  ],
  [
    'libs/plugins/ai/src/lib/providers/conformance.spec.ts',
    'The provider conformance suite (AGL-2939). Sets a fake key (`sk-test`) so the Anthropic adapter answers recorded fixtures through a mocked `fetch`, with no network and no real key. A test double, not a flow.',
  ],
  [
    'apps/console/.env.development.local.example',
    'Local development template.',
  ],
  [
    'docs/drafts/agl-1648-dpa-transfer-scc-language.md',
    'AGL-1648 working draft of proposed DPA transfer/SCC wording. Prose about whether Anthropic must be disclosed as a subprocessor — it names the key to explain WHY the disclosure question exists. Analysis, not a data flow, and it reaches no runtime.',
  ],
  [
    'docs/drafts/agl-1648-subprocessor-change-notification.md',
    'AGL-1648 working draft of the subprocessor change-notification mechanism. Names the key while arguing that setting it in production is what makes Anthropic a live subprocessor — which is this suite\'s own premise, written down. Prose, not a data flow.',
  ],
  [
    '.env.selfhost.example',
    'The self-host env template (AGL-2014). Names the key so an operator knows Assist needs their OWN Anthropic key; without it both Assist surfaces answer 501. A template, not a flow.',
  ],
  [
    'docs/SELF_HOSTING.md',
    'The self-host runbook (AGL-2014). Documents the same key as an optional operator-supplied credential. Documentation, not a flow.',
  ],
  [
    'libs/plugins/ai/src/lib/components/assist-panel.component.spec.tsx',
    'The panel suite (AGL-2486). Names the key only inside a CANNED 501 body it arms, to assert the panel does NOT relay that operator string to the user. A test double, not a flow — and the assertion is that the string stops there. It moved with the panel into the AI plugin (AGL-2939).',
  ],
  ['docs/PLATFORM_PROVISIONING.md', 'Documentation.'],
  ['apps/docs/docs/developers/self-hosting.md', 'Documentation.'],
  [
    'apps/docs/docs/developers/self-hosting-environment.md',
    'The published environment-variable reference. Names the key in the row telling an operator to bring their own, alongside the spend ceilings that bound it. Documentation, not a flow.',
  ],
  [
    'docs/BREACH_NOTIFICATION.md',
    'The breach runbook (AGL-1915). Names the key only in the list of credentials to rotate after an exposure, alongside FIREBASE_PRIVATE_KEY and STRIPE_SECRET_KEY — a rotation target, not a data flow to Anthropic.',
  ],
  [
    'apps/console/specs/assist-anthropic-subprocessor-gate.spec.ts',
    'This suite.',
  ],
  [
    'tools/scripts/check-provider-key-exposure.mjs',
    'The AGL-2240 exposure checker. Names the key only inside a regex of provider-credential NAMES it refuses to find in the browser bundle; it never reads `process.env` for one and sends nothing anywhere. The complement of this suite: that one asks which MODULE GRAPH a reader is in, this one asks which FILES read it at all — and a reader can be correctly listed here while shipping to every visitor, which is the hole it closes.',
  ],
  [
    'apps/console/specs/provider-key-exposure.spec.ts',
    'The spec driving that checker. Names the key in its expected-reader assertions and in the list of env names the pattern must match. A guard, not a flow.',
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

  it('has exactly the expected doors calling the AI runtime', () => {
    // The adapter is the only key reader, so a new customer-content path is a
    // new CALLER of the runtime rather than a new reader of the key. Specs
    // drive the runtime with doubles and are not doors.
    const tracked = execSync('git ls-files libs apps', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.spec\.tsx?$/.test(path))
    const callers = tracked.filter(
      (path) =>
        path !== 'libs/plugins/ai/src/lib/runtime/ai-runtime.ts' &&
        /\brunAiRequest\(/.test(readFileSync(join(REPO_ROOT, path), 'utf8')),
    )
    expect(callers.sort()).toEqual([...AI_DOORS.keys()].sort())
  })

  it('records the besigner assistant as unflagged, so nobody re-derives it', () => {
    const besigner = AI_DOORS.get('libs/plugins/ai/src/lib/server/ai-assist.ts')
    expect(besigner).toContain('NO release flag')
    // And the claim is checked against the source, not just asserted about
    // the comment: the handler is registered with no flag around it.
    const server = readFileSync(
      join(REPO_ROOT, 'libs/plugins/ai/src/lib/server.ts'),
      'utf8',
    )
    expect(server).toContain("registerPluginApiRoute('ai/assist', aiAssistHandler)")
    const handler = readFileSync(
      join(REPO_ROOT, 'libs/plugins/ai/src/lib/server/ai-assist.ts'),
      'utf8',
    )
    expect(handler).not.toMatch(/isServerReleaseFlagOnForOrg|release_/)
  })
})
