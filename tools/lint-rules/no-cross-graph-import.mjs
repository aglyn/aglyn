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
 * ESLint rule: an import that crosses App Router's two module graphs.
 *
 * This is the AGL-1349 class. `nx build console` failed on `main` with five
 * Turbopack errors — "You're importing a module that depends on
 * `createContext` into a React Server Component module" — because AGL-1280
 * added one import to `apps/console/utils/usage-metering.ts`:
 *
 * ```ts
 * import { type AglynOrgBilling, planMetersInfraOverage } from '@aglyn/aglyn'
 * ```
 *
 * That module is **dual-graph**: the Billing card imports it (client) and
 * three App Routes import it (`report-usage`, `usage-alerts`, `host-usage`).
 * `@aglyn/aglyn` re-exports `app-utils/contexts`, so the routes dragged
 * `createContext` into the RSC graph.
 *
 * Nothing about it typechecks wrong — 141/141 was clean before and after —
 * and a unit test never sees a module graph. The class is only observable at
 * BUILD time, which is promotion time, which is the most expensive moment to
 * find it. That is the whole reason it is a lint rule.
 *
 * ## What it reports
 *
 * Both directions of the same boundary, because AGL-1349's fix had to dodge
 * both:
 *
 * - **client into server** — a module reachable from an App Route or an
 *   unmarked `page`/`layout` importing something that reaches `createContext`.
 * - **server into client** — a module reachable from a `'use client'` file
 *   importing something that reaches `node:*` (`@aglyn/aglyn/server` carries
 *   the `node:stream` API adapter, AGL-405).
 *
 * Reachability is transitive and comes from a real walk of the workspace
 * import graph (`lib/app-router-graph.mjs`, ~1s, computed once per ESLint
 * process). The blame lands on the module that wrote the import — the same
 * place the fix goes — not on the route that merely reached it.
 *
 * ## Honest limits
 *
 * The graph snapshot is up to 30s old inside a long-lived editor server, so a
 * file that *becomes* reachable from a route can take one refresh to start
 * reporting; the file being edited is always read fresh from the AST. Imports
 * inside `node_modules` are opaque. `import type` is ignored because it is
 * erased and creates no runtime edge — which is exactly why the AGL-1349 fix
 * could keep `import type { AglynOrgBilling } from '@aglyn/aglyn/foundation'`.
 *
 * The companion guard spec (`apps/console/specs/app-router-graph.spec.ts`)
 * asserts the same invariant over the whole tree in one pass, so the
 * invariant survives someone disabling the rule.
 */

import {
  findWorkspaceRoot,
  getAppRouterGraph,
} from './lib/app-router-graph.mjs'

const FIX_HINT =
  'Name the module underneath instead — `@aglyn/aglyn/foundation`, ' +
  '`@aglyn/aglyn/app-utils/plan-entitlements` — which is safe in either ' +
  'graph and is what 48 other call sites already do (AGL-405/1349).'

/** True for a statement TypeScript erases, so it is not a graph edge. */
function isTypeOnly(node) {
  if (node.importKind === 'type' || node.exportKind === 'type') return true
  const specifiers = node.specifiers ?? []
  return (
    specifiers.length > 0 &&
    specifiers.every((specifier) => specifier.importKind === 'type')
  )
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "never import across App Router's server/client module graphs; " +
        'name the module underneath an entry barrel',
    },
    schema: [],
    messages: {
      clientIntoServer:
        "`{{specifier}}` is CLIENT-ONLY — it reaches `createContext` via " +
        '{{chain}}. This module is in an App Router SERVER graph ' +
        '({{entry}}), where App Router forbids that, so `nx build` fails at ' +
        'promotion time (AGL-1349). ' +
        FIX_HINT,
      serverIntoClient:
        '`{{specifier}}` is SERVER-ONLY — it reaches {{chain}}. This module ' +
        'is bundled for the BROWSER ({{entry}}), which cannot provide it ' +
        '(AGL-405). ' +
        FIX_HINT,
      dualGraph:
        '`{{specifier}}` is {{side}}-only and this module is in BOTH App ' +
        'Router graphs — reached from {{entry}} AND from a `use client` ' +
        'file, exactly like `usage-metering.ts` in AGL-1349. It may import ' +
        'NEITHER entry barrel: `@aglyn/aglyn` carries the client React ' +
        'contexts and `@aglyn/aglyn/server` carries the `node:stream` API ' +
        'adapter. ' +
        FIX_HINT,
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.()
    if (
      !filename ||
      !filename.startsWith('/') ||
      /\.(spec|test|e2e|stories)\.[^.]+$/.test(filename)
    ) {
      return {}
    }

    let graph
    let resolved = false
    const load = () => {
      if (resolved) return graph
      resolved = true
      const root = findWorkspaceRoot(context.cwd ?? process.cwd())
      graph = root ? getAppRouterGraph(root) : null
      return graph
    }

    const check = (node, source) => {
      if (!source || typeof source.value !== 'string') return
      const active = load()
      if (!active) return
      const specifier = source.value
      const target = active.resolve(specifier, filename)
      if (!target) return
      const verdict = active.classifyImport(filename, specifier, target)
      if (!verdict) return

      const entry = verdict.reachedFrom[0] ?? filename
      const chain = verdict.through[verdict.through.length - 1] ?? specifier
      if (verdict.dualGraph) {
        context.report({
          node: source,
          messageId: 'dualGraph',
          data: {
            specifier,
            entry,
            side:
              verdict.direction === 'client-into-server' ? 'client' : 'server',
          },
        })
        return
      }
      context.report({
        node: source,
        messageId:
          verdict.direction === 'client-into-server'
            ? 'clientIntoServer'
            : 'serverIntoClient',
        data: { specifier, entry, chain },
      })
    }

    return {
      ImportDeclaration(node) {
        if (isTypeOnly(node)) return
        check(node, node.source)
      },
      ExportNamedDeclaration(node) {
        if (!node.source || isTypeOnly(node)) return
        check(node, node.source)
      },
      ExportAllDeclaration(node) {
        if (isTypeOnly(node)) return
        check(node, node.source)
      },
      ImportExpression(node) {
        if (node.source?.type !== 'Literal') return
        check(node, node.source)
      },
    }
  },
}
