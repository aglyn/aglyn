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
 * The scanner behind `render-path-bounded-io.spec.ts` (AGL-3569): which
 * outbound network calls a tenant page render can AWAIT without a deadline.
 *
 * ## What it walks
 *
 * Symbols, not files. A module-level import graph from the page and layout
 * files reaches ~800 files, because barrels and the plugin manifests pull in
 * every plugin's API handlers — a checkout's Stripe call is in the same file
 * as nothing a page renders. So each file is parsed (syntax only, no type
 * checker) into its top-level declarations, and reachability follows the
 * identifiers a REACHED declaration's body names: through relative and
 * `@aglyn/*` path-alias imports, through re-export barrels by name, and
 * through `import * as X` by the `X.member`s actually used. A file's
 * top-level statements run when anything in it is reached.
 *
 * Two edges are cut on purpose:
 *
 * - A `'use client'` module is not entered. Its code renders on the server
 *   too, but a client component cannot await on the server, so its `fetch`es
 *   run in effects and handlers, in the browser.
 * - `import('@aglyn/plugins-…')` is not followed, except from the site
 *   (client) plugin manifest. The server manifest and the declarations step
 *   load whole plugins, nearly all of which is API routes and jobs. A plugin
 *   enters the render path through what it REGISTERS: every `register*`
 *   exported by a plugin-manager module the render walk reaches is treated as
 *   a render-time registry, and the arguments of every call to it under
 *   `libs/plugins` are walked as entries, to a fixpoint. That is deliberately
 *   wider than "page enrichers" — a registry whose runner a render reaches is
 *   a registry whose callbacks a render can await.
 *
 * ## What counts
 *
 * A call to `fetch` (or `globalThis.fetch`), `fetch` passed on as a value
 * (`options.fetch ?? fetch`), a credential's `getAccessToken()` (a token
 * exchange with Google), or `http(s).request/get`. Firestore reads through
 * `firebase-admin` are not counted; they carry the client's own deadlines.
 *
 * It is BOUNDED when it sits inside the arguments of a `boundedAwait(...)`
 * call or under a `void` (detached, so nothing awaits it) — and so is
 * everything reached only through such a spot. `boundedAwait(review(), …)`
 * bounds every network call `review` makes, however deep.
 *
 * ## What it does not claim
 *
 * Reachability is by name and over-approximates: a reached declaration's
 * whole body counts, including a branch that never runs on a render. That is
 * what the allowlist's reasons are for. It cannot see a call through a value
 * it cannot name (a callback stored and invoked elsewhere, a computed
 * member), which is why registries are walked from their registrations.
 */

import ts from 'typescript'

/** Repo-relative file access, so a spec can scan a fixture tree as well. */
export interface SourceTree {
  /** The file's text, or null when there is no such file. */
  read(path: string): string | null
  /** Every source file below `dir`, repo-relative. */
  list(dir: string): string[]
}

export type NetworkMarker = 'fetch' | 'fetch-ref' | 'access-token' | 'node-http'

export interface NetworkCall {
  file: string
  /** The top-level declaration holding it, or `<module>` / `<hook>`. */
  symbol: string
  line: number
  marker: NetworkMarker
  text: string
  /** How a render gets there: `file#symbol`, nearest first, entry last. */
  via: string[]
}

export interface RenderPathScan {
  /** Calls a render can await with no deadline in front of them. */
  unbounded: NetworkCall[]
  /** Calls reached only behind `boundedAwait` or `void`. */
  bounded: NetworkCall[]
  /** Every file a reached symbol lives in. */
  reachedFiles: Set<string>
  /** Registries treated as render-time, by their `register*` name. */
  registrars: string[]
}

type Mode = 'awaited' | 'bounded'

interface ImportRef {
  spec: string
  /** `default`, a named export, or `*` for a namespace. */
  name: string
}

interface ParsedFile {
  path: string
  sf: ts.SourceFile
  client: boolean
  imports: Map<string, ImportRef>
  reexports: Map<string, ImportRef>
  stars: string[]
  localExports: Map<string, string>
  decls: Map<string, ts.Node>
  sideEffects: Array<{ spec: string } | { node: ts.Node }>
}

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']
const PLUGIN_PACKAGE = /^@aglyn\/plugins-/
const PLUGIN_SITE_MANIFEST = 'plugins.client.generated.ts'
const PLUGIN_MANAGER_DIR = 'libs/aglyn/src/lib/plugin-manager/'

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function dirname(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

/** Is `node` a `boundedAwait(...)` call? Its ARGUMENTS are bounded. */
function isBoundedAwaitCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'boundedAwait'
  )
}

function networkMarker(node: ts.Node): NetworkMarker | null {
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (ts.isIdentifier(callee) && callee.text === 'fetch') return 'fetch'
    if (ts.isPropertyAccessExpression(callee)) {
      const member = callee.name.text
      const target = callee.expression
      if (
        member === 'fetch' &&
        ts.isIdentifier(target) &&
        /^(globalThis|self|window)$/.test(target.text)
      ) {
        return 'fetch'
      }
      if (member === 'getAccessToken') return 'access-token'
      if (
        (member === 'request' || member === 'get') &&
        ts.isIdentifier(target) &&
        /^https?$/.test(target.text)
      ) {
        return 'node-http'
      }
    }
    return null
  }
  if (ts.isIdentifier(node) && node.text === 'fetch') {
    const parent = node.parent
    if (ts.isCallExpression(parent) && parent.expression === node) return null
    if (ts.isPropertyAccessExpression(parent) && parent.name === node)
      return null
    const named =
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isVariableDeclaration(parent)
    if (named && (parent as { name?: ts.Node }).name === node) return null
    return 'fetch-ref'
  }
  return null
}

export function scanRenderPath(
  tree: SourceTree,
  options: { entries: string[]; pluginRoot: string },
): RenderPathScan {
  const tsconfig = JSON.parse(tree.read('tsconfig.base.json') ?? '{}') as {
    compilerOptions?: { paths?: Record<string, string[]> }
  }
  const paths = tsconfig.compilerOptions?.paths ?? {}

  const tryFile = (base: string): string | null => {
    if (/\.tsx?$/.test(base) && tree.read(base) !== null) return base
    for (const extension of EXTENSIONS) {
      if (tree.read(base + extension) !== null) return base + extension
    }
    return null
  }
  const resolveSpec = (spec: string, from: string): string | null => {
    if (spec.startsWith('.'))
      return tryFile(normalize(`${dirname(from)}/${spec}`))
    if (paths[spec]) return tryFile(normalize(paths[spec][0]))
    for (const [pattern, targets] of Object.entries(paths)) {
      if (pattern.endsWith('/*') && spec.startsWith(pattern.slice(0, -1))) {
        return tryFile(
          normalize(targets[0].replace('*', spec.slice(pattern.length - 1))),
        )
      }
    }
    return null
  }

  const parsed = new Map<string, ParsedFile>()
  const parse = (path: string): ParsedFile => {
    const held = parsed.get(path)
    if (held) return held
    const sf = ts.createSourceFile(
      path,
      tree.read(path) ?? '',
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const info: ParsedFile = {
      path,
      sf,
      client: false,
      imports: new Map(),
      reexports: new Map(),
      stars: [],
      localExports: new Map(),
      decls: new Map(),
      sideEffects: [],
    }
    const first = sf.statements[0]
    info.client = Boolean(
      first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === 'use client',
    )
    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) {
        const spec = (statement.moduleSpecifier as ts.StringLiteral).text
        const clause = statement.importClause
        if (!clause) {
          info.sideEffects.push({ spec })
          continue
        }
        if (clause.isTypeOnly) continue
        if (clause.name)
          info.imports.set(clause.name.text, { spec, name: 'default' })
        const bindings = clause.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) {
          info.imports.set(bindings.name.text, { spec, name: '*' })
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue
            info.imports.set(element.name.text, {
              spec,
              name: (element.propertyName ?? element.name).text,
            })
          }
        }
        continue
      }
      if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue
        const spec =
          statement.moduleSpecifier &&
          (statement.moduleSpecifier as ts.StringLiteral).text
        if (!statement.exportClause) {
          if (spec) info.stars.push(spec)
          continue
        }
        if (ts.isNamespaceExport(statement.exportClause)) {
          if (spec)
            info.reexports.set(statement.exportClause.name.text, {
              spec,
              name: '*',
            })
          continue
        }
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue
          const source = (element.propertyName ?? element.name).text
          if (spec)
            info.reexports.set(element.name.text, { spec, name: source })
          else info.localExports.set(element.name.text, source)
        }
        continue
      }
      if (ts.isExportAssignment(statement)) {
        if (ts.isIdentifier(statement.expression)) {
          info.localExports.set('default', statement.expression.text)
        } else {
          info.decls.set('default', statement)
          info.localExports.set('default', 'default')
        }
        continue
      }
      if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)
      )
        continue
      const modifiers = ts.canHaveModifiers(statement)
        ? (ts.getModifiers(statement) ?? [])
        : []
      if (modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword))
        continue
      const exported = modifiers.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      )
      const isDefault = modifiers.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      )
      if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      ) {
        const name = statement.name?.text ?? 'default'
        info.decls.set(name, statement)
        if (exported) info.localExports.set(isDefault ? 'default' : name, name)
        continue
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const names: string[] = []
          const collect = (name: ts.BindingName) => {
            if (ts.isIdentifier(name)) names.push(name.text)
            else
              for (const element of name.elements)
                if (!ts.isOmittedExpression(element)) collect(element.name)
          }
          collect(declaration.name)
          for (const name of names) {
            info.decls.set(name, declaration)
            if (exported) info.localExports.set(name, name)
          }
        }
        continue
      }
      info.sideEffects.push({ node: statement })
    }
    parsed.set(path, info)
    return info
  }

  type Target = { file: string; name: string }
  const refLocal = (
    info: ParsedFile,
    local: string,
    seen: Set<string>,
  ): Target | null => {
    if (info.decls.has(local)) return { file: info.path, name: local }
    const imported = info.imports.get(local)
    if (!imported) return null
    const file = resolveSpec(imported.spec, info.path)
    if (!file) return null
    return imported.name === '*'
      ? { file, name: '*' }
      : resolveExport(file, imported.name, seen)
  }
  const resolveExport = (
    file: string,
    name: string,
    seen = new Set<string>(),
  ): Target | null => {
    const key = `${file}#${name}`
    if (seen.has(key)) return null
    seen.add(key)
    const info = parse(file)
    const local = info.localExports.get(name)
    if (local !== undefined) return refLocal(info, local, seen)
    const reexport = info.reexports.get(name)
    if (reexport) {
      const target = resolveSpec(reexport.spec, file)
      if (!target) return null
      return reexport.name === '*'
        ? { file: target, name: '*' }
        : resolveExport(target, reexport.name, seen)
    }
    for (const spec of info.stars) {
      const target = resolveSpec(spec, file)
      const found = target && resolveExport(target, name, seen)
      if (found) return found
    }
    return null
  }

  const reached = new Map<string, Set<Mode>>()
  const queue: Array<[string, string, Mode]> = []
  const parents = new Map<string, string>()
  const reach = (target: Target, mode: Mode, from: string) => {
    const key = `${target.file}#${target.name}`
    const modes = reached.get(key) ?? new Set<Mode>()
    if (modes.has(mode)) return
    modes.add(mode)
    parents.set(`${key}@${mode}`, from)
    reached.set(key, modes)
    queue.push([target.file, target.name, mode])
  }

  const calls = new Map<string, NetworkCall & { mode: Mode }>()
  const chain = (key: string, mode: Mode): string[] => {
    const out: string[] = []
    let at: string | undefined = key
    while (at && out.length < 16) {
      out.push(at)
      at =
        parents.get(`${at}@${mode}`) ??
        parents.get(`${at.split('#')[0]}#*@${mode}`)
    }
    return out
  }
  const scanBody = (
    info: ParsedFile,
    root: ts.Node,
    symbol: string,
    mode: Mode,
  ) => {
    const from = `${info.path}#${symbol}`
    const visit = (node: ts.Node, here: Mode): void => {
      if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return
      const marker = networkMarker(node)
      if (marker) {
        const line = lineOf(info.sf, node)
        const key = `${info.path}:${node.getStart(info.sf)}:${marker}`
        const held = calls.get(key)
        if (!held || (held.mode === 'bounded' && here === 'awaited')) {
          calls.set(key, {
            file: info.path,
            symbol,
            line,
            marker,
            text: (marker === 'fetch-ref' ? node.parent : node)
              .getText(info.sf)
              .replace(/\s+/g, ' ')
              .slice(0, 100),
            mode: here,
            via: chain(from, mode),
          })
        }
      }
      if (ts.isIdentifier(node)) {
        const parent = node.parent
        if (ts.isPropertyAccessExpression(parent) && parent.name === node)
          return
        if (
          (ts.isPropertyAssignment(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isPropertyDeclaration(parent)) &&
          parent.name === node
        ) {
          return
        }
        const imported = info.imports.get(node.text)
        if (
          imported?.name === '*' &&
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node
        ) {
          const file = resolveSpec(imported.spec, info.path)
          const target = file && resolveExport(file, parent.name.text)
          if (target) reach(target, here, from)
          return
        }
        const target = refLocal(info, node.text, new Set())
        if (target) reach(target, here, from)
        return
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const argument = node.arguments[0]
        if (
          argument &&
          ts.isStringLiteralLike(argument) &&
          !(
            PLUGIN_PACKAGE.test(argument.text) &&
            !info.path.endsWith(PLUGIN_SITE_MANIFEST)
          )
        ) {
          const file = resolveSpec(argument.text, info.path)
          if (file) reach({ file, name: '*' }, here, from)
        }
      }
      if (isBoundedAwaitCall(node)) {
        visit(node.expression, here)
        for (const argument of node.arguments) visit(argument, 'bounded')
        return
      }
      const inner: Mode = ts.isVoidExpression(node) ? 'bounded' : here
      ts.forEachChild(node, (child) => visit(child, inner))
    }
    visit(root, mode)
  }

  const moduleRun = new Set<string>()
  const processSymbol = (file: string, name: string, mode: Mode) => {
    const info = parse(file)
    const from = `${file}#${name}`
    if (info.client) return
    const moduleKey = `${file}#${mode}`
    if (!moduleRun.has(moduleKey)) {
      moduleRun.add(moduleKey)
      for (const effect of info.sideEffects) {
        if ('spec' in effect) {
          const target = resolveSpec(effect.spec, file)
          if (target) reach({ file: target, name: '<module>' }, mode, from)
        } else {
          scanBody(info, effect.node, '<module>', mode)
        }
      }
    }
    if (name === '<module>') return
    if (name === '*') {
      for (const exported of new Set([
        ...info.localExports.keys(),
        ...info.reexports.keys(),
      ])) {
        const target = resolveExport(file, exported)
        if (target) reach(target, mode, from)
      }
      for (const spec of info.stars) {
        const target = resolveSpec(spec, file)
        if (target) reach({ file: target, name: '*' }, mode, from)
      }
      return
    }
    const declaration = info.decls.get(name)
    if (declaration) scanBody(info, declaration, name, mode)
  }

  const drain = () => {
    while (queue.length) {
      const [file, name, mode] = queue.shift() as [string, string, Mode]
      processSymbol(file, name, mode)
    }
  }

  const pluginFiles = tree
    .list(options.pluginRoot)
    .filter((path) => !/\.(spec|test)\.tsx?$/.test(path))
  const registrars = new Set<string>()
  const renderRegistrars = (): string[] => {
    const found = new Set<string>()
    for (const key of reached.keys()) {
      const [file, name] = key.split('#')
      if (
        !file.startsWith(PLUGIN_MANAGER_DIR) ||
        name === '*' ||
        name === '<module>' ||
        /^register/.test(name)
      ) {
        continue
      }
      for (const exported of parse(file).localExports.keys()) {
        if (/^register[A-Z]/.test(exported)) found.add(exported)
      }
    }
    return [...found].filter((registrar) => !registrars.has(registrar))
  }

  for (const entry of options.entries)
    reach({ file: entry, name: '*' }, 'awaited', 'entry')
  for (;;) {
    drain()
    const fresh = renderRegistrars()
    if (!fresh.length) break
    for (const registrar of fresh) registrars.add(registrar)
    for (const file of pluginFiles) {
      const text = tree.read(file) ?? ''
      if (!fresh.some((registrar) => text.includes(registrar))) continue
      const info = parse(file)
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          fresh.includes(node.expression.text)
        ) {
          for (const argument of node.arguments)
            scanBody(info, argument, '<hook>', 'awaited')
        }
        ts.forEachChild(node, visit)
      }
      visit(info.sf)
    }
  }

  const all = [...calls.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  )
  const strip = (call: NetworkCall & { mode: Mode }): NetworkCall => ({
    file: call.file,
    symbol: call.symbol,
    line: call.line,
    marker: call.marker,
    text: call.text,
    via: call.via,
  })
  return {
    unbounded: all.filter((call) => call.mode === 'awaited').map(strip),
    bounded: all.filter((call) => call.mode === 'bounded').map(strip),
    reachedFiles: new Set([...reached.keys()].map((key) => key.split('#')[0])),
    registrars: [...registrars].sort(),
  }
}
