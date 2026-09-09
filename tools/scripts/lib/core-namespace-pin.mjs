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
 * Fail when an app shell's eager graph holds the `@aglyn/aglyn` namespace as
 * a VALUE (AGL-2706).
 *
 * ## The bug this exists to catch
 *
 * `import * as Aglyn from '@aglyn/aglyn'` is opaque to a bundler. It cannot
 * know which exports the consumer reads, so it keeps every module the barrel
 * reaches — and the core barrel reaches all of `app-utils`. ONE such import,
 * in `apps/console/utils/realm-plugins.client.ts`, which the console's plugin
 * gate imports statically, put 173 of 196 `app-utils` modules into the first
 * load of every console route: the health checks, the request-IP and
 * upload-CORS helpers, the SVG sanitizer, the collection-delete rules. None
 * of them run in a browser. Removing that one import took the
 * `(app)/[orgSlug]` route from 996.7 KB to 782.4 KB gzipped.
 *
 * ## Why the existing gates do not see it
 *
 * `check:aglyn-barrel` pins what the barrel REACHES, and this import moves
 * none of that — the barrel's graph is identical either way. `check:jsx-barrel`
 * guards the other barrel. `check:tenant-page-weight` weighs one entry, the
 * published customer page, and this is the console. A typecheck and a test
 * suite are both silent by construction: the code is correct, it just costs
 * three quarters of a megabyte.
 *
 * ## What "eager" means here
 *
 * The static closure of an app shell's client root. Static edges only: an
 * `import()` is a chunk a visitor pays for when a branch asks for it, which
 * is exactly the shape the fix uses — the one place the console genuinely
 * needs the namespace as a value is the realm-plugin host ABI, and it lives
 * behind a relative `import()` in `realm-plugin-host.client.ts`.
 *
 * A type-only namespace is free: TypeScript erases it, so it is not a runtime
 * edge. That is `readImports`' existing rule (AGL-1349) and the right one
 * here too — most of these imports name nothing but types and the fix is the
 * word `type`.
 *
 * The pin is zero, not a baseline. There is no legitimate reason for an app
 * shell to hold the whole core namespace, so there is nothing to allow and no
 * `--write` discipline to keep honest.
 */

import {
  createResolver,
  readImports,
} from '../../lint-rules/lib/app-router-graph.mjs'
import { collectBarrelGraph } from './jsx-barrel.mjs'

/** The barrel whose namespace pins everything downstream of it. */
export const CORE_BARREL = '@aglyn/aglyn'

/** `import * as <local> from` — the one clause shape that pins the barrel. */
const NAMESPACE_CLAUSE = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\b/

/**
 * The client roots whose static closure must not hold the namespace.
 *
 * The console entry is the `(app)` layout rather than a single page: it is
 * `'use client'`, so every route under it renders what this file reaches, and
 * the site switcher and the org hooks that also held the namespace hang off
 * it. The tenant entry is the published customer page, which reached zero
 * before this gate existed and is here so it cannot quietly stop.
 */
export const SHELL_ENTRIES = [
  'apps/console/app/(app)/layout.tsx',
  'apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx',
]

/**
 * VALUE namespace imports of the core barrel in one file's source.
 *
 * Built on `readImports` so the two rules that matter are inherited rather
 * than re-derived: comments are stripped first, and a type-only import is
 * already not an edge. What is left to decide is the SHAPE of the clause, and
 * a namespace import is one line by construction — the statement's own line
 * is the whole of it.
 *
 * A namespace of anything else is not reported. `import * as React` costs
 * what React costs; it takes a barrel over the whole of `app-utils` to turn
 * the form into a bill.
 *
 * @param {string} source
 * @returns {{line: number, local: string}[]}
 */
export function readCoreNamespaceImports(source) {
  const lines = source.split('\n')
  const found = []
  for (const { specifier, kind, line } of readImports(source)) {
    if (kind !== 'static' || specifier !== CORE_BARREL) continue
    const shape = NAMESPACE_CLAUSE.exec(lines[line - 1] ?? '')
    if (shape) found.push({ line, local: shape[1] })
  }
  return found
}

/**
 * Walk one entry's static first-party graph and report every namespace pin.
 *
 * @param {object} io
 * @param {string} io.entry absolute path to the client root
 * @param {(file: string) => string} io.read
 * @param {(specifier: string, fromFile: string) => string | null} io.resolve
 */
export function measureNamespacePins({ entry, read, resolve }) {
  const graph = collectBarrelGraph({ entry, read, resolve, staticOnly: true })
  const pins = []
  for (const file of [...graph.modules].sort()) {
    let source
    try {
      source = read(file)
    } catch {
      continue
    }
    for (const hit of readCoreNamespaceImports(source))
      pins.push({ file, ...hit })
  }
  return { moduleCount: graph.modules.size, pins }
}

/** Convenience wrapper over `measureNamespacePins` for the real repo. */
export function measureShell(root, read, entry) {
  return {
    entry,
    ...measureNamespacePins({
      entry: `${root}/${entry}`,
      read,
      resolve: createResolver(root),
    }),
  }
}

export const WHY_NAMESPACE_PIN =
  'A VALUE namespace import of @aglyn/aglyn is opaque to the bundler: it ' +
  'cannot know which exports are read, so every module the barrel reaches ' +
  'ships in the first load of this shell. Import the module that DEFINES ' +
  "the value — '@aglyn/aglyn/app-utils/<file>', '@aglyn/aglyn/aglyn' for " +
  'the singleton — or, when the reference is a type, write ' +
  '`import type * as`, which TypeScript erases. The one legitimate need for ' +
  'the namespace as a value is the realm-plugin host ABI, and it belongs ' +
  'behind a relative `import()`: see ' +
  'apps/tenant/utils/realm-plugin-host.client.ts.'
