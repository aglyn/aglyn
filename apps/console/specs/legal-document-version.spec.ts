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
 * AGL-1497 — a version has to mean ONE text.
 *
 * The whole clickwrap record rests on `v1` naming a fixed document set. If the
 * archived text can be edited while the version stays put, every record that
 * says "accepted v1" becomes decorative: two users could have agreed to
 * materially different terms and the evidence would be identical.
 *
 * Nobody should have to remember to bump the version, so this makes it
 * mechanical. Editing a snapshot without changing the hash fails here; the fix
 * is to add `legal/v2/` and bump `LEGAL_DOCUMENT_VERSION`, which is exactly
 * the ceremony republishing the Terms is supposed to involve.
 *
 * This guards the text WE archive. It cannot see the live page — that drift is
 * caught by re-snapshotting at publish time, which is when the version should
 * be bumped anyway.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  LEGAL_DOCUMENT_VERSION,
  LEGAL_DOCUMENTS,
} from '../constants/legal-documents'
import { LEGAL_URLS } from '../constants/shared'

/**
 * The snapshot TEXT is no longer in this repo (AGL-1497, moved 2026-08-20).
 * It lives in the shared drive at
 * `Platform Docs/Legal/Acceptance-Snapshots/<version>/`, and
 * `npm run check:legal-snapshots` fetches it in CI, hashes it, and fails if it
 * disagrees with the `sha256` below.
 *
 * Why it moved: one folder per version accumulated seven versions in eight
 * days, all of them pinning text nobody had ever accepted. Git already retains
 * every superseded snapshot, so keeping them checked out as well was pure
 * redundancy — `git show <sha>:apps/console/constants/legal/v1/privacy.txt`
 * still produces any of them.
 *
 * What stays HERE is the part a reviewer must see in a diff: the version, the
 * hash, and the rule that every linked document has one. Content verification
 * needs Drive credentials and belongs in CI; asserting shape needs neither and
 * belongs in a unit test. Splitting them that way is what keeps this file
 * runnable by anyone, offline.
 */
describe('legal document version', () => {
  it('gives every document a hash and a length', () => {
    expect(LEGAL_DOCUMENTS.length).toBeGreaterThan(0)
    for (const doc of LEGAL_DOCUMENTS) {
      // A 64-hex sha256 and a positive length. `check:legal-snapshots` is what
      // proves they describe the archived bytes; this only proves the manifest
      // is not carrying a placeholder.
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(doc.bytes).toBeGreaterThan(0)
    }
  })

  it('names a version the archive can be looked up by', () => {
    expect(LEGAL_DOCUMENT_VERSION).toMatch(/^v\d+$/)
  })

  it('archives every document the consent control links to', () => {
    // A link with no snapshot behind it is the original problem wearing a
    // manifest: the record would name a document it cannot reproduce. The
    // manifest keys are the contract — `check:legal-snapshots` resolves each
    // one to `<key>.txt` in the archive and fails when one is missing.
    const keys = LEGAL_DOCUMENTS.map((doc) => doc.key).sort()
    expect(keys).toEqual(
      Object.keys(LEGAL_URLS)
        .map((key) => key.toLowerCase())
        .sort(),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps the manifest pointing at the canonical published URLs', () => {
    expect(LEGAL_DOCUMENTS.map((doc) => doc.url).sort()).toEqual(
      [LEGAL_URLS.PRIVACY, LEGAL_URLS.TERMS].sort(),
    )
  })

  // The "does this read like the document, or like a 404 page" sanity check
  // MOVED to `check:legal-snapshots`, which fetches the archived text from
  // Drive and can therefore actually look at it. Asserting it here would mean
  // shipping the text back into the repo to test it, which is the thing this
  // change removed.
})

/**
 * The clickwrap links follow the OPERATOR, and the recorded identity does not
 * (AGL-2017).
 *
 * Both halves are asserted on purpose. A self-hosted console showed its users
 * a checkbox agreeing to Aglyn LLC's Terms for a service Aglyn does not
 * provide; the links are configuration now. But the version and the
 * `sha256`/`bytes` triples still identify OUR snapshots, so the acceptance an
 * operator records still names our bytes. That is a legal decision rather than
 * a refactor — the operator's own document identity, or an explicit "no
 * platform agreement" mode — and pinning it here means the day someone changes
 * it, they are told this suite encodes an unresolved question rather than a
 * behaviour to preserve.
 */
describe('the clickwrap points at the operator (AGL-2017)', () => {
  const KEY = 'NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN'
  const ORIGINAL = process.env[KEY]

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env[KEY]
    else process.env[KEY] = ORIGINAL
    jest.resetModules()
  })

  function loadWith(value: string | undefined) {
    if (value === undefined) delete process.env[KEY]
    else process.env[KEY] = value
    jest.resetModules()
    return {
      shared: require('../constants/shared') as typeof import('../constants/shared'),
      documents:
        require('../constants/legal-documents') as typeof import('../constants/legal-documents'),
    }
  }

  it('SELF-HOST shape: the links name the operator, never us', () => {
    const { shared } = loadWith('https://example.com')
    expect(shared.LEGAL_URLS.TERMS).toBe('https://example.com/legal/terms')
    expect(shared.LEGAL_URLS.PRIVACY).toBe('https://example.com/legal/privacy')
    expect(JSON.stringify(shared.LEGAL_URLS)).not.toContain('aglyn')
  })

  it('tolerates a trailing slash, which a copied origin carries', () => {
    expect(loadWith('https://example.com/').shared.LEGAL_URLS.TERMS).toBe(
      'https://example.com/legal/terms',
    )
  })

  it('AGLYN-OPERATED shape: unset is still our own published documents', () => {
    expect(loadWith(undefined).shared.LEGAL_URLS.TERMS).toBe(
      'https://aglyn.com/legal/terms',
    )
  })

  it('the origin has ONE reader — shared.ts does not read the variable again (AGL-2014)', () => {
    // `constants/shared.ts` used to carry its own copy of
    // `process.env.NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN || 'https://aglyn.com'`,
    // byte-for-byte the same expression as `published-legal-pages.ts`. Two
    // readers of one value is the shape AGL-2195 removed for the tenant apex.
    // The risk was never that they disagreed on the day — it is that a later
    // fix to one (a second accepted name, an empty-string guard, a different
    // trimming rule) would reach the clickwrap LINKS while
    // `isPublishedLegalUrl`, the gate deciding whether a publisher agreement
    // URL counts as published, went on answering from the other.
    //
    // Asserted on the SOURCE rather than by importing the lib module here.
    // A `require('@aglyn/aglyn/...')` in this file marks the whole `aglyn`
    // library lazy-loaded in the nx graph, and
    // `@nx/enforce-module-boundaries` then rejects every STATIC import of it
    // elsewhere — measured: adding one turned `constants/tenant-links.ts`,
    // a file this change never touched, from clean to erroring. The
    // behavioural half is already covered by the three cases above, and the
    // Aglyn literal itself is independently ratcheted by
    // `selfhost-hardcoded-hosts.spec.ts`.
    const source = readFileSync(
      join(__dirname, '..', 'constants', 'shared.ts'),
      'utf8',
    )
    expect(source).toMatch(
      /import \{ LEGAL_ORIGIN as OPERATOR_LEGAL_ORIGIN \} from '@aglyn\/aglyn\/app-utils\/published-legal-pages'/,
    )
    expect(source).toMatch(/const LEGAL_ORIGIN = OPERATOR_LEGAL_ORIGIN/)
    // Comments are stripped first — this file, and the comment directly
    // above, both NAME the variable while explaining why it is no longer
    // read here. Asserting on raw source would fail on its own documentation
    // (it did), which is the same reason `selfhost-hardcoded-hosts.spec.ts`
    // strips comments before counting.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    expect(code).not.toMatch(/process\.env\.NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN/)
  })

  it('the RECORDED document identity is still ours — the open half', () => {
    // Deliberately asserting the LIMITATION, so it is visible rather than
    // assumed closed. An operator's user clicks through to the operator's
    // terms and we record acceptance of a snapshot of OURS.
    const { documents } = loadWith('https://example.com')
    expect(documents.LEGAL_DOCUMENT_VERSION).toMatch(/^v\d+$/)
    // The version is a compile-time constant, and must stay one: making it
    // dynamic turns today's silent degrade into a 500, because
    // recordLegalAcceptance throws on a falsy version.
    expect(documents.LEGAL_DOCUMENT_VERSION).toBeTruthy()
  })
})
