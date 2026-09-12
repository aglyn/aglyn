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
 * A PLUGIN HANDLER MAY ONLY ANSWER 401 FOR A VERIFICATION IT CLASSIFIED
 * (AGL-2852).
 *
 * Seven CRM handlers and a marketplace one caught every throw from
 * `verifyIdToken` and answered 401. A Google certificate-fetch outage —
 * which firebase-admin reports under a forged token's code — therefore told
 * every caller their sign-in was bad, and nothing paged, which is the trap
 * `isRefusedIdToken` exists to avoid (AGL-1993, AGL-2796).
 *
 * ## What this guard asserts, and why it is shaped this way
 *
 * `invalid-id-token-response.spec.ts` can require every console route that
 * verifies a token to consult the classifier, because every one of them
 * answers the caller directly. Plugin handlers do not divide that way: most
 * let the throw reach a catch-all 5xx, which is already the safe direction
 * and needs no classifier. The defect is narrower and so is the rule —
 *
 *   a catch that can answer 401 for a verification must have asked.
 *
 * A handler that keeps a 5xx is out of scope here by construction, not by
 * exemption, so there is no list to go stale.
 *
 * ## Why the 401 is read as a numeric literal
 *
 * It is the shape every one of these handlers has: `refuse(401, …)` or
 * `{ status: 401 }`. Reading the literal rather than the word means a comment
 * mentioning 401, or a message quoting it, does not drag a catch into scope.
 *
 * ## Why the entry point is pinned too
 *
 * The classifier is not exported from `@aglyn/tenant-data-admin`'s barrel on
 * purpose: specs replace that module with hand-built `jest.mock` factories,
 * and a factory that does not list a symbol makes it `undefined` rather than
 * failing loudly — which would turn the classifier into a falsy value and
 * hand every outage back its 401. So a handler must import it from the
 * dedicated entry point, and the module itself must keep importing nothing.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const REPO_ROOT = resolve(__dirname, '../../../../../../..')
const ENTRY_POINT = '@aglyn/tenant-data-admin/server/id-token-refusal'
const CLASSIFIES = /\bisRefusedIdToken\(/

const read = (file: string) => readFileSync(join(REPO_ROOT, file), 'utf8')

/**
 * Every plugin file under a `server` directory or named `server*`, the scope
 * the issue names, that verifies an ID token at all.
 */
const verifying = execFileSync('git', ['ls-files', '--', 'libs/plugins'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !/\.spec\.tsx?$/.test(file) &&
      /\/server[^/]*(\/|\.tsx?$)/.test(file),
  )
  .filter((file) => /\.verifyIdToken\(/.test(read(file)))

const parse = (file: string) =>
  ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

/**
 * Each `.verifyIdToken(` in a file, paired with the catch that runs when it
 * throws — or null when the nearest one is outside its own function, where
 * it cannot run at all for this call.
 */
function verifications(file: string) {
  const source = parse(file)
  const found: { line: number; handler: ts.CatchClause | null }[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'verifyIdToken'
    ) {
      let handler: ts.CatchClause | null = null
      let child: ts.Node = node
      for (
        let parent = node.parent;
        parent && !ts.isFunctionLike(parent);
        parent = parent.parent
      ) {
        if (
          ts.isTryStatement(parent) &&
          parent.tryBlock === child &&
          parent.catchClause
        ) {
          handler = parent.catchClause
          break
        }
        child = parent
      }
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      )
      found.push({ line: line + 1, handler })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { source, found }
}

/** Whether a catch block writes a literal 401 anywhere inside it. */
function canRefuseTheCaller(handler: ts.CatchClause): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if (ts.isNumericLiteral(node) && node.text === '401') found = true
    ts.forEachChild(node, visit)
  }
  visit(handler.block)
  return found
}

/** `file:line` for every verification whose catch can answer 401. */
const refusing = verifying.flatMap((file) => {
  const { source, found } = verifications(file)
  return found
    .filter(({ handler }) => handler && canRefuseTheCaller(handler))
    .map(({ line, handler }) => ({
      at: `${file}:${line}`,
      file,
      text: (handler as ts.CatchClause).getText(source),
    }))
})

describe('the sweep reads what it claims to (AGL-2852)', () => {
  /*
   * Anti-vacuity. A sweep that matched nothing would pass every assertion
   * below, and a silently empty guard is what lets the regression back in.
   */
  it('finds the plugin server files that verify a token', () => {
    expect(verifying.length).toBeGreaterThan(40)
    expect(verifying).toContain('libs/plugins/crm/src/lib/server/org-caller.ts')
    // Both spellings of the scope: a `server/` directory and a `server*` file.
    expect(verifying).toContain('libs/plugins/crm/src/lib/server-deal-stage.ts')
    expect(verifying).toContain(
      'libs/plugins/marketplace/src/lib/server/verification-request.ts',
    )
  })

  it('finds the catches that can answer the caller 401', () => {
    // The eight the fix covered. More may join; fewer means the sweep stopped
    // seeing them, which would make the rule below assert nothing.
    expect(refusing.length).toBeGreaterThanOrEqual(8)
    expect(refusing.map(({ at }) => at.split(':')[0])).toEqual(
      expect.arrayContaining([
        'libs/plugins/crm/src/lib/server-deal-stage.ts',
        'libs/plugins/crm/src/lib/server.ts',
        'libs/plugins/crm/src/lib/server/contact-email-history.ts',
        'libs/plugins/crm/src/lib/server/email-send.ts',
        'libs/plugins/crm/src/lib/server/inbound-address.ts',
        'libs/plugins/crm/src/lib/server/org-caller.ts',
        'libs/plugins/crm/src/lib/server/recipe-routes.ts',
        'libs/plugins/marketplace/src/lib/server/verification-request.ts',
      ]),
    )
  })

  it('leaves the handlers that keep a 5xx out of scope, rather than exempting them', () => {
    // The other half of `verifying`: a catch-all that answers 5xx is already
    // the safe direction. If this ever reached zero the rule would have
    // widened into a demand nobody agreed to.
    const withCatch = verifying.flatMap(
      (file) => verifications(file).found.filter(({ handler }) => handler),
    )
    expect(withCatch.length).toBeGreaterThan(refusing.length)
  })
})

describe('every plugin catch that answers 401 asked first (AGL-2852)', () => {
  it('classifies the throw instead of reading it as a bad credential', () => {
    const unclassified = refusing
      .filter(({ text }) => !CLASSIFIES.test(text))
      .map(({ at }) => at)
    expect(unclassified).toEqual([])
  })

  it('imports the classifier from the entry point no spec mocks wholesale', () => {
    const wrong = [...new Set(refusing.map(({ file }) => file))]
      .filter((file) => !read(file).includes(ENTRY_POINT))
    expect(wrong).toEqual([])
  })
})

describe('the classifier stays importable from anywhere (AGL-2852)', () => {
  it('imports nothing, so no mock of a dependency can blank it', () => {
    const source = parse(
      'libs/tenant/data/admin/src/lib/server/id-token-refusal.ts',
    )
    const imports = source.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement),
    )
    expect(imports).toEqual([])
  })
})
