/**
 * @jest-environment node
 */

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
 * AGL-1466: the two halves of this bug, pinned where they happened.
 *
 * `media-folder-create-scope.emulator.spec.ts` proves what a folder document
 * looks like once written and what the site-scoped query then returns. It
 * cannot prove that THIS COMPONENT is what writes it — the creates are two
 * `writeBatch` calls inside a component that mounts the org context, four
 * Firestore listener stacks, the DAM counters and a dnd-kit surface, so
 * rendering it would be a test of the mocks (the same call the AGL-1413 /
 * AGL-1461 / AGL-1467 specs in this folder make).
 *
 * So: behaviour lives in the emulator spec, and the wiring that connects the
 * component to it lives here. A break in either one leaves folders unscoped,
 * which is invisible from the org page and total from every host.
 *
 * The second half is the sharing editor. It displayed `[ORG_SCOPE_TOKEN]`
 * whenever the stored value was absent, so a folder that was shared with
 * nothing read as "All sites" — that substitution is why nobody caught the
 * missing writes for three weeks, and re-introducing it would re-blind the
 * next occurrence of this class.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as Aglyn from '@aglyn/aglyn'

import { code } from '../../specs/source-text'

const LIBRARY = readFileSync(
  join(__dirname, 'media-library.component.tsx'),
  'utf8',
)

/**
 * Comments removed. Required, not tidy: the comments below the fixes NAME the
 * shape they replaced, which is the right thing for a reader and would make
 * every negative assertion here pass against prose.
 *
 * Through the shared, bounded stripper since AGL-1479 — the copy this file
 * carried read `accept="image/*"` as a comment opener and deleted 16,383
 * characters out of the middle of the library, which is 442 lines of markup
 * that every negative assertion below was silently excused from.
 */
const CODE = code(LIBRARY, 'media-library.component.tsx')

/**
 * The body of a `const <name> = useCallback(` declaration — up to whichever
 * closer comes first, since the inline form ends `}, [deps])` on one line
 * and the multi-line form ends with the dependency array on its own.
 */
function callbackBody(name: string): string {
  const start = CODE.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const ends = ['\n  }, [', '\n  )']
    .map((closer) => CODE.indexOf(closer, start))
    .filter((at) => at > start)
  expect(ends.length).toBeGreaterThan(0)
  return CODE.slice(start, Math.min(...ends))
}

describe('AGL-1466 · a folder create carries its scope', () => {
  /**
   * Every `mediaFolders` document this component writes is shaped by the one
   * function that requires a scope. Counted rather than merely searched for:
   * the bug was TWO creation paths and only fixing the loud one leaves the
   * legacy migration reproducing it on any org that still has AGL-124
   * folder strings.
   */
  it('routes both creation paths through newMediaFolderDoc', () => {
    const creates = CODE.match(/batch\.set\(\s*ref,/g) ?? []
    expect(creates.length).toBeGreaterThanOrEqual(2)

    const shaped = CODE.match(/batch\.set\(\s*ref,\s*Aglyn\.newMediaFolderDoc\(/g) ?? []
    expect(shaped).toHaveLength(creates.length)
  })

  /**
   * The exact literal that shipped the bug — `{ name, parentId, createdAt }`
   * with no scope — may not come back in any spelling.
   */
  it('never writes a bare folder literal again', () => {
    // Matched to a boolean, not to the source: a failure here should print
    // the verdict, not 3,700 lines of component.
    expect(/batch\.set\(\s*ref,\s*\{\s*name/.test(CODE)).toBe(false)
  })

  /**
   * A SITE library has no org to scope to, so it stores no field; the org
   * library takes the same AGL-1048 default as the datasets and uploads
   * created next to it. Both facts are one expression, so the null branch
   * cannot drift away from the `orgId` test that selects the collection.
   */
  it('picks the org default only for an org library', () => {
    const declaration = CODE.slice(
      CODE.indexOf('const newFolderScope'),
      CODE.indexOf('const newFolderScope') + 500,
    )
    expect(declaration).toMatch(/orgId/)
    expect(declaration).toMatch(/defaultScopeForNewResource/)
    expect(declaration).toMatch(/:\s*null/)
  })
})

describe('AGL-1466 · the sharing editor shows what is stored', () => {
  const openFolderScope = () => callbackBody('openFolderScope')

  /**
   * The substitution itself. Opening the editor on a folder with no
   * `visibleTo` must not seed the control with `['org']`, because Apply then
   * writes a value the user never chose and, far worse, Cancel leaves a
   * dialog that said "All sites" about a folder no site can see.
   */
  it('does not seed an absent folder scope with the org token', () => {
    expect(openFolderScope()).not.toMatch(
      /visibleTo:\s*stored\?\.length\s*\?\s*stored\s*:\s*\[Aglyn\.ORG_SCOPE_TOKEN\]/,
    )
  })

  /** It says so instead, on a flag the dialog can render. */
  it('marks the dialog as unset when nothing is stored', () => {
    expect(openFolderScope()).toMatch(/unset:/)
    expect(/scopeDialog\?\.unset/.test(CODE)).toBe(true)
  })

  /**
   * The same substitution existed for a selection of files, through
   * `scopeOfMedia`. A dialog that lies about one resource type and not the
   * other is a dialog that will lie again.
   */
  it('does not seed an absent file scope with the org token', () => {
    expect(callbackBody('scopeOfMedia')).not.toMatch(/\[Aglyn\.ORG_SCOPE_TOKEN\]/)
  })

  /**
   * The same claim, over the WHOLE component rather than two callbacks named
   * by hand.
   *
   * Both assertions above were written against a `CODE` with 16,383 characters
   * missing from the middle of it (AGL-1479), so "no picker substitutes" was
   * only ever checked at the two sites someone thought to name. Restoring the
   * hole turned up a third — the grid card's `onDetails` — and a fourth in the
   * same file, `handleEditorSave`'s `previousScope`. AGL-1480 fixed both, and
   * this is the assertion that would have caught them: it is scoped to the
   * component, not to a list of callbacks a reader has to keep current.
   *
   * AGL-1479 pinned it with `it.failing` so it would turn red the moment the
   * fix landed. It did, and the marker came off here rather than the
   * assertion being deleted — the guarantee is the point, the marker was only
   * ever the bookmark.
   */
  it('never seeds an absent scope with the org token, anywhere', () => {
    const seeds =
      CODE.match(/visibleTo:[\s\S]{0,140}?\[Aglyn\.ORG_SCOPE_TOKEN\]/g) ?? []
    // The legitimate ones: a NEW resource's default, the normalizer's floor,
    // the preview call that needs a usable scope to get a count, and the
    // radio whose 'org' option IS the org token. What may not appear is a
    // fallback for a resource that already exists and stored nothing.
    expect(seeds.filter((seed) => /Array\.isArray/.test(seed))).toHaveLength(0)
  })

  /**
   * The positive half of the same claim, and the one that stops a FIFTH copy.
   *
   * Four call sites in two files have now each written their own
   * `Array.isArray(x.visibleTo) ? x.visibleTo : [ORG_SCOPE_TOKEN]`, which is
   * the same lesson AGL-1466 drew when two independent creates each forgot
   * the field: the answer is one function, not four correct copies. Every
   * place this component reads a STORED scope goes through
   * `Aglyn.storedScope`, so "absent means nothing is stored" is decided once.
   */
  it('reads every stored scope through the one helper', () => {
    // The three readers: the selection dialog, the drawer seed, the save gate.
    expect(CODE.match(/Aglyn\.storedScope\(/g) ?? []).toHaveLength(3)
  })

  /**
   * And the user is told, in words, what an unset scope means — which is
   * "hidden", the opposite of what the dialog used to imply.
   */
  it('names the consequence of an unset scope', () => {
    expect(
      /never been (shared|saved)|not shared with any site/i.test(LIBRARY),
    ).toBe(true)
  })
})

/**
 * AGL-1480: the same substitution at the surface everybody actually uses.
 *
 * The two AGL-1466 sites need a bulk selection or a folder's overflow menu.
 * This one is the DETAILS item on every card in the grid, and it seeded the
 * drawer's "Shared with" control with `[ORG_SCOPE_TOKEN]` whenever the field
 * was absent — so the most-travelled reading of a file's sharing was "All
 * sites" for a file no site can see.
 *
 * It survived AGL-1466 because the spec above was checked against a `CODE`
 * with this entire JSX region deleted from it (AGL-1479), so the guarantee
 * looked complete and held at two of three sites.
 *
 * The treatment is AGL-1466's, deliberately not re-litigated: show the true
 * state rather than persist a default on render. Opening a drawer would
 * write; the write cascades; the AGL-1042 rules refuse it from any member who
 * is not org-wide; and it would repair only what somebody happens to open,
 * which is a repair mechanism wearing a UI.
 */
describe('AGL-1480 · the detail drawer shows what is stored', () => {
  /**
   * The `onDetails` seed, from the `visibleItems.map` card down to the close
   * of the `setEditor` call. Anchored on `onDetails=` rather than on a
   * callback name because this one is an inline JSX prop, not a `useCallback`.
   */
  const onDetails = (): string => {
    const start = CODE.indexOf('onDetails={')
    expect(start).toBeGreaterThan(-1)
    const end = CODE.indexOf('onDelete=', start)
    expect(end).toBeGreaterThan(start)
    return CODE.slice(start, end)
  }

  /** The `handleEditorSave` local that decides whether the save writes. */
  const previousScope = (): string => {
    const start = CODE.indexOf('const previousScope')
    expect(start).toBeGreaterThan(-1)
    return CODE.slice(start, CODE.indexOf('\n', start))
  }

  /** The drawer's "Shared with" block. */
  const sharedWith = (): string => {
    const start = CODE.indexOf("{'Shared with'}")
    expect(start).toBeGreaterThan(-1)
    const end = CODE.indexOf("{'Custom metadata'}", start)
    expect(end).toBeGreaterThan(start)
    return CODE.slice(start, end)
  }

  /** The literal that shipped the bug, in the place it shipped from. */
  it('does not seed an absent file scope with the org token', () => {
    expect(onDetails()).not.toMatch(/\[Aglyn\.ORG_SCOPE_TOKEN\]/)
    expect(onDetails()).toMatch(/Aglyn\.storedScope\(/)
  })

  /** And it carries the same `unset` signal the folder dialog renders. */
  it('carries the unset signal into the drawer', () => {
    expect(onDetails()).toMatch(/scopeUnset:/)
    expect(/editor\?\.scopeUnset/.test(CODE)).toBe(true)
  })

  /**
   * The one that matters most, and the trap in fixing this at all.
   *
   * Today an untouched drawer writes nothing only by coincidence: the seed and
   * `previousScope` happened to substitute the SAME `['org']`, so
   * `scopeChanged` came out false. Change one side and not the other and a
   * display bug becomes a WRITE — on every unset file anyone merely looks at,
   * from a dialog they never touched, through a `set-scope` that cascades.
   *
   * So this is asserted on values, not on prose: both expressions are lifted
   * out of the component's own source and evaluated against the same document.
   * If they agree, `scopeChanged` is false however it is spelled.
   */
  it('opens the drawer without making the save gate think anything changed', () => {
    const seed = /const storedScope = ([^\n]+)/.exec(onDetails())?.[1]
    expect(seed).toBeTruthy()
    const previous = /const previousScope: string\[\] = ([^\n]+)/.exec(
      previousScope(),
    )?.[1]
    expect(previous).toBeTruthy()

    const evaluate = (expression: string, doc: unknown) =>
      new Function(
        'Aglyn',
        'media',
        'editor',
        `return (${expression.replace(/,\s*$/, '')})`,
      )(Aglyn, doc, { media: doc })

    for (const doc of [
      {},
      { visibleTo: undefined },
      // A stored empty array is "visible to nobody" — a written value, and
      // the drawer must not read it as org-wide either.
      { visibleTo: [] },
      { visibleTo: ['org'] },
      { visibleTo: ['host:a', 'host:b'] },
    ]) {
      expect(evaluate(`${seed} ?? []`, doc)).toEqual(evaluate(previous!, doc))
    }
  })

  /** The write is still gated on that comparison, and only on it. */
  it('still writes the scope only when it changed', () => {
    expect(CODE).toMatch(
      /\.\.\.\(orgId && viewerOrgWide && scopeChanged\s*\?\s*\{ visibleTo:/,
    )
  })

  /**
   * A real sentinel, never `''` — MUI cannot hold an empty string as a
   * selected value, and a corpus spec forbids one. Rendered only while unset
   * and disabled, so the control cannot be set back into "unknown".
   */
  it('offers a real sentinel rather than an empty option value', () => {
    expect(sharedWith()).toMatch(/<MenuItem value="unset" disabled>/)
    expect(sharedWith()).not.toMatch(/value=""/)
    expect(sharedWith()).toMatch(/editor\?\.scopeUnset\s*\?\s*'unset'/)
  })

  /**
   * The host chips are the "Selected sites…" detail. Showing them under an
   * unset file would invite a save of the empty selection that is already
   * there, which is the widening-by-accident this class keeps producing.
   */
  it('hides the host chips while the scope is unset', () => {
    expect(sharedWith()).toMatch(/!editor\?\.scopeUnset\s*&&/)
  })

  /** And the drawer says the consequence, as the folder dialog does. */
  it('names the consequence at the drawer too', () => {
    expect(sharedWith()).toMatch(/never been shared/i)
    expect(sharedWith()).toMatch(/hidden from every site/i)
  })
})
