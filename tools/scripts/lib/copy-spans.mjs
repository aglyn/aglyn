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
 * The spans of a source file that carry text a HUMAN READS (AGL-2763).
 *
 * This is the half of `brand-literals.mjs` that is not about the brand: parse
 * with the TypeScript parser, then collect the node kinds whose text ships as
 * copy. It was extracted so a second gate — the British-spelling ratchet —
 * asks the same question of a file rather than answering it again, because the
 * expensive part of that question is not the word being looked for, it is
 * knowing which bytes are copy in the first place.
 *
 * `brand-literals.mjs` documents at length why this must not be a hand-rolled
 * scanner: three separate defects in the character-walker it replaced all
 * produced false GREENS, the direction nobody checks. That reasoning applies
 * unchanged to every caller, which is the argument for one implementation.
 *
 * ## What counts as copy
 *
 *     'Use your Aglyn account'                ← counts (StringLiteral)
 *     `Welcome to ${name}, in colour`         ← counts (template parts)
 *     <Typography>Hover state</Typography>    ← counts (JsxText)
 *     // the colour is a canvas setting       ← does NOT count (comment)
 *     const roomColours = …                   ← does NOT count (identifier)
 *     /[&<>"']/g                              ← does NOT count (regex)
 *
 * **Comments are excluded**, and for the British-spelling caller that is not
 * an optimization but the rule it enforces: the standing spelling rule says
 * prose and UI labels are in scope and code comments explicitly are not.
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
 * The node kinds that carry text a human reads.
 *
 * The template parts are separate kinds rather than one `TemplateExpression`
 * on purpose: `` `Hello ${name}, welcome` `` is a `TemplateHead` and a
 * `TemplateTail` with an expression between them, and collecting the parts
 * means an interpolated value is never scanned as if it were copy.
 *
 * JSX **attribute** values need no entry — `<img alt="Aglyn logo" />` is an
 * ordinary `StringLiteral`.
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
 * the tree, which is precisely the class of silent misreading the parser-based
 * detector exists to end.
 *
 * `ScriptKind.JS` parses JSX, so a `.js`/`.mjs`/`.cjs` file carrying JSX is
 * covered without a separate case.
 */
export function scriptKindFor(path) {
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
 * rest of the line — reintroducing the comment-stripper desync that the node
 * kind was added to cure.
 */
function textStart(source, node) {
  return node.kind === ts.SyntaxKind.JsxText
    ? node.pos
    : ts.skipTrivia(source, node.pos)
}

/**
 * Every copy span in a source file, in traversal order.
 *
 * @param {string} source file contents
 * @param {string} [path] file name, which selects the dialect. Defaults to a
 *   `.tsx` name: it is the superset that parses JSX, and callers that omit the
 *   path are tests passing a fragment.
 * @returns {{ file: object, spans: { text: string, start: number }[] }} the
 *   parsed `SourceFile` — callers need it to turn an offset into a line — and
 *   the spans, each with its absolute offset in `source`.
 */
export function copySpans(source, path = 'source.tsx') {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(path),
  )
  const spans = []

  const visit = (node) => {
    if (COPY_KINDS.has(node.kind)) {
      const start = textStart(file.text, node)
      spans.push({ text: file.text.slice(start, node.end), start })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)

  return { file, spans }
}

/** The 1-based line an absolute offset falls on. */
export function lineOf(file, pos) {
  return file.getLineAndCharacterOfPosition(pos).line + 1
}
