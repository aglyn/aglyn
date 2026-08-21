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
 * ESLint rule: a DEFERRED first-party import inside a TEST file.
 *
 * `import('@aglyn/x')`, and `require('@aglyn/x')` written anywhere but the top
 * level, register a `dynamic` edge on the whole project pair in nx's graph. nx
 * then considers the target library lazy-loaded, and
 * `@nx/enforce-module-boundaries` forbids every STATIC import of that library —
 * transitively, in every project that reaches it. The blast lands in a
 * DIFFERENT project, on files that did not change, under a message whose
 * "is lazy-loaded in these files:" list is EMPTY, because
 * `findFilesWithDynamicImports` only searches the project being linted and the
 * offending line is not in it.
 *
 * This has now happened four times, each costing hours of diagnosis:
 *
 * - **AGL-949** — `await import('@aglyn/aglyn/server')` in a plugins-commerce
 *   spec put 100 errors on nearly every console page and route.
 * - **AGL-1329** — `await import('@aglyn/tenant-data-admin')` in
 *   `plugin-takedown.emulator.spec.ts` put the same error on 14 files that
 *   never touch that spec. A co-existing `static` edge did NOT excuse them:
 *   nx records both kinds on the same pair.
 * - **`email-media-src-drift.spec.ts`** — a literal `require('@aglyn/aglyn')`
 *   under `jest.isolateModules` reddened twenty-odd unrelated console pages.
 * - **AGL-2282 / AGL-2313** — one
 *   `require('@aglyn/aglyn/app-utils/publisher-agreement')` inside a
 *   `jest.mock` factory took `console:lint` from 0 to **441 errors across 364
 *   files** and blocked promotion for hours.
 * - **AGL-1921** — its `onRequestError` hook reached for
 *   `await import('@aglyn/tenant-data-admin')` in BOTH apps'
 *   `instrumentation.ts` and put **222 errors** on the gate: 181 in console,
 *   41 in tenant. This one was not a spec, which is why the rule as first
 *   written (AGL-2347) did not see it — see the scope note below.
 *
 * Each was repaired by hand and then explained in a long comment in the file
 * that caused it — which is exactly the readership that no longer needs
 * telling. The next person writes the same line in a different spec. That is
 * what makes this a rule rather than a comment, the same reasoning as
 * `no-link-element-switch`, whose invariant also lived only in a comment.
 *
 * ## Why a rule and not "just read the code"
 *
 * Because whether a given line is a landmine is genuinely unreadable. Measured
 * against nx's own file map, all four of these are `require` calls of a
 * first-party package and only some register a dynamic edge:
 *
 * | form                                              | edge nx records |
 * | ------------------------------------------------- | --------------- |
 * | `require('@aglyn/x')` at module top level          | static          |
 * | `const f = () => require('@aglyn/x')`              | static          |
 * | `require('@aglyn/x')` inside a `jest.mock` factory | **dynamic**     |
 * | `require('@aglyn/x')` inside an `it()` callback    | **dynamic**     |
 * | `import('@aglyn/x')`, anywhere                     | **dynamic**     |
 *
 * `campaign-preview.spec.ts` sat on the safe side of that line only because
 * its `jest.spyOn(require(...))` happened to be written as a method chain.
 * Nobody can be asked to hold that distinction in their head, and no reviewer
 * can see it in a diff. The rule refuses the whole shape instead.
 *
 * ## Which files, and why not all of them
 *
 * A deferred import is a legitimate, deliberate tool in product code: the
 * generated plugin loader manifests defer `@aglyn/plugins-*`, and seven
 * console pages `lazy()`-load `@aglyn/besigner-feature-designer` and
 * `@aglyn/shared-ui-json-editor`. Those are real code-split boundaries with a
 * real payoff, and the rule leaves them alone. That carve-out is why the rule
 * cannot simply cover everything.
 *
 * It covers the two places where a deferral can never buy a smaller bundle,
 * so the nx edge is charged for nothing:
 *
 * 1. **Specs.** Not bundled, not shipped. Deferring buys nothing at runtime,
 *    but nx charges the whole workspace for the edge anyway. Four of the five
 *    incidents were specs.
 *
 * 2. **`instrumentation.ts`.** Next's instrumentation hook is server-side and
 *    is never sent to a browser, so there is no payload to split. Its
 *    deferrals ARE load-bearing, but for a different reason — keeping
 *    firebase-admin out of the EDGE bundle — and that reason is satisfied just
 *    as well by deferring a RELATIVE module, which crosses no project boundary
 *    and so registers no lazy edge. `apps/tenant/utils/boot-warmup.ts` has
 *    been that shape since AGL-1500 and says so in its docblock; AGL-1921 then
 *    added a second hook to the same file reaching for the lib specifier
 *    directly, sixty lines under the comment warning against it. A comment in
 *    one file did not survive the next edit to that same file, which is
 *    precisely the AGL-1357 argument for making it a rule.
 *
 * nx's own file map records zero legitimate first-party dynamic edges from
 * either kind of file, so the cost of this scope is zero and the thing it
 * forbids has never once been wanted.
 *
 * ## Honest limits
 *
 * Only a LITERAL specifier is reported, which is exactly what nx's collector
 * reads. `reRequire('@aglyn/aglyn')` — the indirection
 * `email-media-src-drift.spec.ts` deliberately introduced — is invisible to
 * both and stays legal, as the documented escape hatch for a genuine
 * `jest.isolateModules` re-require; it conceals nothing, because that file
 * already imports both packages statically at the top.
 *
 * `jest.requireActual` and `jest.requireMock` are NOT reported. They are
 * jest's mock-registry API rather than a module load, and nx does not record
 * an edge for them: the workspace has 97 such call sites and not one appears
 * as a dynamic dependency in nx's file map. Reporting them would make the rule
 * fire ~97 times on code that cannot cause this, which is how a rule gets
 * switched off.
 *
 * This does not replace `@nx/enforce-module-boundaries`. It fires FIRST, on
 * the one line that matters, before the graph is ever consulted.
 */

const FIRST_PARTY = /^@aglyn\//

/** True for the spec/test files where a deferred import is never a boundary. */
function isTestFile(filename) {
  return /\.(spec|test)\.[^.]+$/.test(filename)
}

/**
 * True for Next's instrumentation hook — `instrumentation.ts` and the
 * `instrumentation-client` variant — which is server-side, never shipped to a
 * browser, and so never a code-split boundary either (AGL-1921).
 *
 * Anchored to the basename so `instrumentation-boot-warmup.spec.ts` and any
 * `utils/instrumentation-helpers.ts` are NOT caught by this arm; a spec is
 * still caught by `isTestFile` on its own merits.
 */
function isInstrumentationFile(filename) {
  return /(^|[/\\])instrumentation(-client)?\.[cm]?[jt]sx?$/.test(filename)
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'never defer a first-party `@aglyn/*` import inside a spec — one ' +
        'dynamic nx graph edge forbids every static import of that library ' +
        'across every project that reaches it',
    },
    schema: [],
    messages: {
      deferredFirstPartyInstrumentation:
        'Deferring `{{specifier}}` here registers a DYNAMIC nx graph edge on ' +
        'this app. nx then treats that library as lazy-loaded and ' +
        '`@nx/enforce-module-boundaries` forbids every STATIC import of it ' +
        'across the app — 222 errors on the gate the last time, in files ' +
        'nobody had touched (AGL-1921). The deferral itself is right: it is ' +
        'what keeps firebase-admin out of the edge bundle. Only the ' +
        'SPECIFIER is wrong. Put the static `{{specifier}}` import in a ' +
        'sibling module under `utils/` and defer THAT by relative path, as ' +
        '`utils/report-server-error.ts` and `utils/boot-warmup.ts` do — a ' +
        'relative specifier crosses no project boundary, so nx records no ' +
        'lazy edge, and the module is still only loaded inside the ' +
        '`NEXT_RUNTIME === \'nodejs\'` branch.',
      deferredFirstParty:
        'Deferring `{{specifier}}` here can register a DYNAMIC nx graph edge ' +
        'on this whole project. nx then treats that library as lazy-loaded ' +
        'and `@nx/enforce-module-boundaries` forbids every STATIC import of ' +
        'it in every project that reaches it — hundreds of errors in a ' +
        'DIFFERENT project, on files that did not change, with an EMPTY ' +
        '"lazy-loaded in these files" list because this line is not in the ' +
        'project being linted (AGL-949, AGL-1329, AGL-2282/AGL-2313: 441 ' +
        'errors across 364 console files, promotion blocked). A spec is not ' +
        'a code-split boundary, so the deferral buys nothing. Import ' +
        '`{{specifier}}` statically at the top of the file instead. If a ' +
        '`jest.mock` factory needs the value, a factory cannot close over an ' +
        'import — assign it from the static import in a `seed()` helper the ' +
        'tests call, as `publish-stored-nodes.spec.ts` does. If ' +
        '`jest.isolateModules` needs a genuine re-require, route it through a ' +
        'helper so the specifier is not a literal, as ' +
        '`email-media-src-drift.spec.ts` does.',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.()
    if (!filename) return {}
    const instrumentation = isInstrumentationFile(filename)
    if (!instrumentation && !isTestFile(filename)) return {}

    const report = (node, specifier) => {
      if (typeof specifier !== 'string' || !FIRST_PARTY.test(specifier)) return
      context.report({
        node,
        messageId: instrumentation
          ? 'deferredFirstPartyInstrumentation'
          : 'deferredFirstParty',
        data: { specifier },
      })
    }

    return {
      // `import('@aglyn/x')` — always a dynamic edge, at any nesting.
      ImportExpression(node) {
        if (node.source?.type !== 'Literal') return
        report(node.source, node.source.value)
      },
      // `require('@aglyn/x')`. Reported wherever it appears: which positions
      // nx classifies as dynamic is an internal heuristic no reviewer can see
      // (see the table above), and a static top-level `require` of a
      // first-party package has no reason to exist when an `import` will do.
      // `jest.requireActual` / `jest.requireMock` are deliberately excluded.
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'Identifier' || callee.name !== 'require') return
        const argument = node.arguments[0]
        if (argument?.type !== 'Literal') return
        report(argument, argument.value)
      },
    }
  },
}
