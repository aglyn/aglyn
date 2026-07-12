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
 * Static plugin-bundle checks (AGL-426) — Strapi `strapi-plugin verify`
 * parity, but ALSO enforced server-side: the publish API runs the same
 * checks, so a bundle that fails locally fails there identically.
 *
 * These are cheap source-level heuristics, NOT a sandbox: they catch
 * honest build mistakes (leftover imports, missing entry exports,
 * oversized bundles) and lower the review burden by flagging the API
 * calls the platform never wants in marketplace code. The real security
 * boundary stays the trust chain (sandbox tier / staff review + realm
 * signing).
 */

export interface BundleCheckProblem {
  level: 'error' | 'warning'
  message: string
}

export interface BundleCheckResult {
  ok: boolean
  problems: BundleCheckProblem[]
  /** Which entry exports the source declares. */
  exports: { register: boolean; registerApi: boolean }
}

export const MAX_PLUGIN_BUNDLE_BYTES = 1_000_000

const ENTRY_EXPORT = (name: string) =>
  new RegExp(
    // `export function name(`, `export const name =`, `export { name }`,
    // `export { x as name }` — the shapes bundlers actually emit.
    `export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${name}\\b` +
      `|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
  )

/** Patterns the platform refuses outright in marketplace bundles. */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /\beval\s*\(/, message: 'eval() is not allowed' },
  {
    pattern: /\bnew\s+Function\s*\(/,
    message: 'new Function() is not allowed',
  },
  {
    pattern: /\bdocument\s*\.\s*cookie\b/,
    message: 'document.cookie access is not allowed',
  },
  {
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/,
    message: 'browser storage access is not allowed (use host-mediated data)',
  },
  {
    pattern: /\bimport\s*\(\s*['"`]https?:/,
    message: 'dynamic import of remote URLs is not allowed',
  },
]

/**
 * Static ESM import statements mean the bundle is NOT self-contained —
 * the realm loader executes it standalone, so every dependency must be
 * inlined or reached through the host ABI (`__AGLYN_PLUGIN_HOST__`).
 */
const STATIC_IMPORT = /^\s*import\s+(?:[\w${},*\s]+\s+from\s+)?['"][^'"]+['"]/m

export function checkPluginBundle(
  source: string,
  options?: { maxBytes?: number },
): BundleCheckResult {
  const problems: BundleCheckProblem[] = []
  const maxBytes = options?.maxBytes ?? MAX_PLUGIN_BUNDLE_BYTES

  const bytes = new TextEncoder().encode(source).byteLength
  if (bytes === 0) {
    problems.push({ level: 'error', message: 'bundle is empty' })
  } else if (bytes > maxBytes) {
    problems.push({
      level: 'error',
      message: `bundle is ${bytes} bytes (limit ${maxBytes})`,
    })
  }

  const exportsRegister = ENTRY_EXPORT('register').test(source)
  const exportsRegisterApi = ENTRY_EXPORT('registerApi').test(source)
  if (!exportsRegister && !exportsRegisterApi) {
    problems.push({
      level: 'error',
      message:
        'bundle exports neither register(host) nor registerApi() — ' +
        'nothing for the loader to call',
    })
  }

  if (STATIC_IMPORT.test(source)) {
    problems.push({
      level: 'error',
      message:
        'bundle has static imports — realm bundles must be self-contained ' +
        '(react/@aglyn/aglyn come from the host ABI; see the realm rollup ' +
        'template)',
    })
  }

  for (const { pattern, message } of FORBIDDEN) {
    if (pattern.test(source)) problems.push({ level: 'error', message })
  }

  return {
    ok: !problems.some((problem) => problem.level === 'error'),
    problems,
    exports: { register: exportsRegister, registerApi: exportsRegisterApi },
  }
}
