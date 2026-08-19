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
 * Detect the brand name written as a LITERAL into user-visible copy
 * (AGL-2170).
 *
 * ## Why this exists
 *
 * AGL-2153 made the platform brand configuration — `PLATFORM_BRAND_NAME`, read
 * from `NEXT_PUBLIC_PLATFORM_BRAND_NAME` — and rewired the nine places that
 * mattered most, so a self-host operator can rename the product without
 * editing source. Nothing stopped the tenth from being written the next day,
 * and a sweep found the class was already much larger than the nine: an OS
 * desktop notification, a description written into the operator's own Stripe
 * account, copy telling their publishers that *Aglyn* takes a cut of each sale.
 *
 * Every one of those was authored by someone who had no reason to know the
 * brand had become configuration. That is what a ratchet is for.
 *
 * ## Why a ratchet and not a bare zero
 *
 * The same argument AGL-2025 makes for colours, and it holds harder here: a
 * gate that fails on every existing occurrence gets switched off within the
 * hour. The baseline is a per-file CEILING, so a file may lose literals freely
 * and only gains go red, and `stale` rows are red too — a row matching nothing
 * is an exemption nobody has read since it was written.
 *
 * ## What counts
 *
 * The brand name inside a STRING LITERAL or JSX TEXT in shipped code:
 *
 *     'Use your Aglyn account'                ← counts
 *     `Welcome to Aglyn, ${name}`             ← counts
 *     "Aglyn keeps 10% of each sale"          ← counts
 *     <Typography>Aglyn Assist</Typography>   ← counts (AGL-2350)
 *     // Aglyn sends this now, not Firebase   ← does NOT count (comment)
 *     import { x } from '@aglyn/aglyn'        ← does NOT count (identifier)
 *     `${sub}.aglyn.app`                      ← does NOT count (hostname)
 *     const h: AglynHost = …                  ← does NOT count (identifier)
 *
 * **Comments are out**, matching the colour ratchet and for the same reason:
 * the question is what ships, and prose about the brand is not brand copy.
 * A doc comment explaining why a value is configurable would otherwise be
 * counted as the very thing it explains.
 *
 * **Hostnames and package identifiers are out**, and this is the exclusion
 * most worth defending. `aglyn.app`, `@aglyn/aglyn`, `aglyn-tenant-host` and
 * `AglynHost` are hundreds of occurrences of a DIFFERENT problem with a
 * different fix — the apex is `NEXT_PUBLIC_TENANT_DOMAIN` (AGL-2121), the
 * origins are their own issue, and the package scope is not user-visible at
 * all. Folding them in would bury the signal this gate exists to carry under
 * an order of magnitude of noise, which is how a gate stops being read.
 *
 * **Specs are out.** Pinning the brand string is exactly what a spec should do
 * — `platform-brand.spec.ts` asserts the literal `'Aglyn'` on purpose, in both
 * directions, and must keep doing so.
 *
 * ## Why the TypeScript parser, and not a hand-rolled scanner (AGL-2350)
 *
 * This module used to find its literals by walking the source character by
 * character: strip comments, then collect `'`, `"` and `` ` `` spans, with a
 * hand-written regex-literal heuristic bolted on so that an HTML escaper like
 * `/[&<>"']/g` did not desynchronise the quote counting. Three defects were
 * found in that scanner in a single day, and every one produced **false
 * GREENS** — the gate certifying files it could not read:
 *
 *  1. **AGL-2278** — the comment stripper desynced on exactly that escaper and
 *     manufactured phantom string spans, which both invented literals inside
 *     doc comments and HID 7 real ones in a file baselined at 22.
 *  2. **AGL-2319** — `IDENTIFIER_AFTER` excluded a bare trailing `.`, on the
 *     reasoning that `Aglyn.` opens a hostname. A dot followed by a space, a
 *     quote or the end of the string is a full stop, and the sentence it ends
 *     is the commonest shape brand copy takes. Six occurrences in five files
 *     were invisible, two of them in files the baseline never listed at all.
 *  3. **AGL-2350** — JSX child text is not a quote token, so
 *     `<Typography>Aglyn Assist</Typography>` had never been counted at all.
 *     Three real leaks in `assist-panel.component.tsx` — the panel heading,
 *     the empty-state paragraph and the proposal-card caption — sat in a file
 *     the baseline pinned at 5 while it contained 8. They were found by eye,
 *     which does not scale.
 *
 * The first and third are one bug wearing two hats: a lexer written by hand
 * does not know the grammar, so every construct nobody thought of is silently
 * invisible, and invisible reads as clean. The repo already depends on
 * `typescript`, whose parser knows the whole grammar — so the literals now
 * come from real AST nodes. Comments are excluded because they are not nodes,
 * regex literals are excluded because the parser knows what a regex is, and
 * JSX text is one more `SyntaxKind` rather than another hand-written walker.
 *
 * The swap was verified rather than assumed: the parser-based detector was run
 * beside the walker it replaces over all 15,594 swept files and agreed with it
 * **line for line on every one**, so the only behaviour change is the JSX text
 * the walker structurally could not see.
 */

import { createRequire } from 'node:module'

/**
 * `typescript` ships CommonJS. A `createRequire` bound to this module resolves
 * it from the repo's own `node_modules` however the script was invoked, which
 * a bare `import ts from 'typescript'` does not when the caller runs from
 * elsewhere.
 */
const ts = createRequire(import.meta.url)('typescript')

/**
 * The brand as it appears in prose. Capitalised: a lowercase `aglyn` in a
 * string is almost always a hostname, a package scope, a CSS class or a
 * cookie name, and those are excluded by the rules below anyway.
 */
export const BRAND_WORD = 'Aglyn'

/**
 * Contexts where the word is an IDENTIFIER rather than copy, keyed off what
 * immediately surrounds it.
 *
 *  - preceded by `@`, `/`, `.`, `-`, or a word character → part of a longer
 *    name (`@aglyn/`, `x/aglyn`, `foo.Aglyn`, `sub-aglyn`, `MyAglyn`)
 *  - followed by `/`, `-`, `_`, or a letter → `AglynHost`, `Aglynish`
 *  - followed by a DOT AND THEN a letter or digit → `Aglyn.app`, `Aglyn.com`
 *
 * A trailing lowercase letter is deliberately excluded too: `Aglyn` as copy is
 * a proper noun and is followed by a space, punctuation or the end of the
 * string, never by more letters.
 *
 * ## Why the dot needs the character after it (AGL-2319)
 *
 * This rule was a bare `.` in the follow set, on the reasoning that `Aglyn.`
 * is the start of a hostname. It is that only when a label follows. A dot with
 * a SPACE, a QUOTE or the end of the string after it is a full stop, and
 * `'The plugins that ship with Aglyn.'` is the single commonest shape a
 * sentence naming a product takes — so the exclusion written for `Aglyn.app`
 * was silently swallowing brand copy at the end of every sentence.
 *
 * Six occurrences in five files were hidden this way, two of them in files the
 * baseline did not list at all, which is the worse half: a ratchet cannot
 * ratchet what it cannot see, and those files were free to gain more. It is
 * the same failure class as the regex desync (AGL-2278) — an exclusion written
 * for one real shape, applied wider than that shape — and it manufactures
 * false GREENS rather than false reds, which is the direction nobody checks.
 */
const IDENTIFIER_BEFORE = /[@/.\-\w]$/
const IDENTIFIER_AFTER = /^(?:[/\-_A-Za-z]|\.[A-Za-z0-9])/

/**
 * The node kinds that carry text a human reads.
 *
 * The template parts are separate kinds rather than one `TemplateExpression`
 * on purpose: `` `Hello ${name}, welcome to Aglyn` `` is a `TemplateHead` and
 * a `TemplateTail` with an expression between them, and collecting the parts
 * means an interpolated value is never scanned as if it were copy.
 *
 * `JsxText` is the AGL-2350 addition. JSX **attribute** values need no entry —
 * `<img alt="Aglyn logo" />` is an ordinary `StringLiteral` and has always
 * been counted.
 */
const COPY_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

/**
 * Which dialect to parse as.
 *
 * `.ts` must NOT be parsed as `.tsx`: the two disagree about `<T>value`, which
 * is a type assertion in one and an unclosed JSX element in the other. Getting
 * that wrong would not throw — the parser recovers — it would quietly reshape
 * the tree, which is precisely the class of silent misreading this rewrite
 * exists to end.
 *
 * `ScriptKind.JS` parses JSX, so a `.js`/`.mjs`/`.cjs` file carrying JSX is
 * covered without a separate case.
 */
function scriptKindFor(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts'))
    return ts.ScriptKind.TS
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

/**
 * Where a node's own text begins.
 *
 * For an ordinary token that means skipping the leading trivia the parser
 * hangs off `pos`. `JsxText` is the exception and must use `pos` directly: it
 * has no trivia, its content is significant whitespace, and `skipTrivia` would
 * read a `//` occurring in prose as the start of a line comment and skip the
 * rest of the line — reintroducing the comment-stripper desync in the one node
 * kind added to cure it.
 */
function textStart(source, node) {
  return node.kind === ts.SyntaxKind.JsxText
    ? node.pos
    : ts.skipTrivia(source, node.pos)
}

/**
 * Occurrences of the brand word in user-visible copy, with line numbers.
 *
 * @param {string} source file contents
 * @param {string} [path] file name, which selects the dialect. Defaults to a
 *   `.tsx` name: it is the superset that parses JSX, and the callers that omit
 *   the path are tests passing a fragment.
 * @returns {{ line: number, text: string }[]}
 */
export function findBrandLiterals(source, path = 'source.tsx') {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(path),
  )
  const found = []

  const visit = (node) => {
    if (COPY_KINDS.has(node.kind)) {
      const start = textStart(file.text, node)
      const text = file.text.slice(start, node.end)
      let offset = 0
      for (;;) {
        const at = text.indexOf(BRAND_WORD, offset)
        if (at === -1) break
        offset = at + BRAND_WORD.length
        const before = text.slice(Math.max(0, at - 1), at)
        // TWO characters, so `Aglyn.app` stays an identifier while `Aglyn.` at
        // the end of a sentence is the copy it plainly is.
        const after = text.slice(offset, offset + 2)
        if (IDENTIFIER_BEFORE.test(before)) continue
        if (IDENTIFIER_AFTER.test(after)) continue
        found.push({
          line: file.getLineAndCharacterOfPosition(start + at).line + 1,
          text: text.trim().slice(0, 120),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)

  return found.sort((a, b) => a.line - b.line)
}

export { compareToBaseline } from './ratchet-baseline.mjs'
