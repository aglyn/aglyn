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
 * Which DOM element does `<Foo />` actually render? Shared by the
 * `no-link-element-switch` rule (AGL-1357).
 *
 * ## Why this is derived rather than listed
 *
 * The rule has to tell `<Link>` (renders `<a>` — the SETTLED shape of the
 * accordion fix) from `<Button>` (renders `<button>` — a live violation in
 * `screen-link.tsx`). Those two are syntactically identical: a capitalised
 * JSX name with no `component=` and no `href`. Nothing in the file under
 * lint distinguishes them.
 *
 * A hand-written set of "link components" would answer it, and would drift
 * exactly the way the org-write deny-list drifted (AGL-1354/1355): the next
 * component added to the plugin is not in the list, so it is silently exempt.
 * So the answer is read from the component's own module instead, from
 * whichever of these it declares — every one of them is the library's own
 * statement about its root element, not this rule's opinion:
 *
 * 1. `RootComponent extends React.ElementType = 'a'` — the default type
 *    parameter of MUI's `<Name>TypeMap` (`Link.d.ts` says `'a'`,
 *    `Button.d.ts` says `'button'`).
 * 2. `OverridableComponent<BoxTypeMap<{}, 'div', …>>` — the same fact spelled
 *    positionally (`Box.d.ts`).
 * 3. `component = 'a'` — the destructuring default in the implementation
 *    (`Link.js:179`, `ButtonBase.js:101`), which is what actually runs.
 *
 * ## Honest limits
 *
 * Only a module that is NAMED for the component is consulted — `Link/Link.d.ts`
 * for `@mui/material/Link`, `Button/Button.js` for `Button`. A component
 * pulled out of a mixed barrel, or defined in the file under lint, resolves to
 * `null` (unknown), and the rule stays silent rather than guessing. Files are
 * scanned with regexes over comment-stripped source, the same trade the repo's
 * other source guards make; a component that computes its root element at
 * runtime declares nothing here and is likewise unknown.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import {
  createResolver,
  findWorkspaceRoot,
  stripComments,
} from './app-router-graph.mjs'

/** Probed in order; a declaration file beats an implementation. */
const CANDIDATE_EXTENSIONS = [
  '.d.ts',
  '.d.mts',
  '.tsx',
  '.ts',
  '.mjs',
  '.js',
  '.jsx',
]

/** `<Name>TypeMap<…, RootComponent extends React.ElementType = 'a'>`. */
const TYPE_MAP_DEFAULT =
  /\b(\w+)TypeMap\s*<[^>]*?(?:RootComponent|DefaultComponent)\s+extends\s+[\w.]*ElementType\s*=\s*'([a-zA-Z][\w-]*)'/g

/** `OverridableComponent<BoxTypeMap<{}, 'div', Theme>>` — same fact, positional. */
const OVERRIDABLE_DEFAULT =
  /OverridableComponent\s*<\s*\w*TypeMap\s*<[^>]*?'([a-z][\w-]*)'/

/** `component = 'a'` — the destructuring default that actually runs. */
const DESTRUCTURED_DEFAULT = /[{,]\s*component\s*=\s*'([a-z][\w-]*)'/

/** A JSX name that could name a component module (`Link`, `MuiBox`). */
const isComponentName = (name) => /^[A-Z]/.test(name)

/**
 * Strips the conventional local-alias prefix so `MuiBox` still matches the
 * `Box` module it was imported from. Only ever used to CONFIRM a module the
 * import statement already named — never to find one.
 */
function nameMatches(stem, componentName) {
  const normalise = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const a = normalise(stem)
  const b = normalise(componentName)
  if (!a || !b) return false
  return a === b || b.endsWith(a) || a.endsWith(b)
}

/** Reads a file once per process; misses are cached as null too. */
function createFileReader() {
  const cache = new Map()
  return (path) => {
    if (cache.has(path)) return cache.get(path)
    let source = null
    try {
      source = stripComments(readFileSync(path, 'utf8'))
    } catch {
      source = null
    }
    cache.set(path, source)
    return source
  }
}

/**
 * The host element `source` declares for `componentName`, or null.
 *
 * A `<Name>TypeMap` whose prefix matches the component wins outright; a file
 * that declares several and none of them match is ambiguous, so it answers
 * null rather than picking one.
 */
export function hostElementFromSource(source, componentName) {
  if (!source) return null

  const typeMatches = []
  TYPE_MAP_DEFAULT.lastIndex = 0
  let match
  while ((match = TYPE_MAP_DEFAULT.exec(source)) !== null) {
    typeMatches.push({ owner: match[1], host: match[2] })
  }
  const named = typeMatches.find((entry) =>
    nameMatches(entry.owner, componentName),
  )
  if (named) return named.host
  if (typeMatches.length === 1) return typeMatches[0].host

  const overridable = OVERRIDABLE_DEFAULT.exec(source)
  if (overridable) return overridable[1]

  const destructured = DESTRUCTURED_DEFAULT.exec(source)
  if (destructured) return destructured[1]

  return null
}

/** Walks up from `fromFile` for `node_modules/<specifier>`. */
function findInNodeModules(specifier, fromFile) {
  let directory = dirname(fromFile)
  for (let depth = 0; depth < 24; depth += 1) {
    const candidate = join(directory, 'node_modules', specifier)
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

/**
 * The files worth scanning for `componentName`, given whatever the specifier
 * resolved to. Only modules NAMED for the component qualify — a barrel is
 * never scanned, because the first `component = '…'` in it would belong to
 * some other component.
 */
function candidateFiles(target, componentName) {
  const files = []
  const push = (path) => {
    if (path && existsSync(path) && statSync(path).isFile()) files.push(path)
  }

  let directory = target
  if (statSync(target).isFile()) {
    const stem = basename(target).replace(
      /\.(d\.[mc]?ts|[mc]?tsx?|[mc]?jsx?)$/,
      '',
    )
    if (!nameMatches(stem, componentName)) return files
    push(target)
    for (const extension of CANDIDATE_EXTENSIONS) {
      push(join(dirname(target), stem + extension))
    }
    return files
  }

  const stem = basename(directory)
  if (!nameMatches(stem, componentName)) return files
  for (const extension of CANDIDATE_EXTENSIONS) {
    push(join(directory, stem + extension))
  }
  for (const extension of CANDIDATE_EXTENSIONS) {
    push(join(directory, `index${extension}`))
  }
  return files
}

/**
 * Resolves the host element a component renders by default, from the module
 * the file under lint imported it from.
 *
 * `specifier` is the import source as written; `componentName` is the local
 * JSX name; `importedName` is the name inside the module (null for a default
 * import). Returns a lowercase tag name, or null when nothing is declared.
 */
export function createHostElementResolver(cwd) {
  const root = findWorkspaceRoot(cwd ?? process.cwd())
  const resolveWorkspace = root ? createResolver(root) : () => null
  const readFile = createFileReader()
  const cache = new Map()

  return function hostElementFor(
    specifier,
    componentName,
    importedName,
    fromFile,
  ) {
    if (!specifier || !componentName || !isComponentName(componentName))
      return null
    const key = `${specifier}::${importedName ?? '*'}::${componentName}`
    if (cache.has(key)) return cache.get(key)

    let host = null
    try {
      const targets = []
      const workspaceFile = resolveWorkspace(specifier, fromFile)
      if (workspaceFile) targets.push(workspaceFile)
      if (specifier.startsWith('.')) {
        targets.push(resolvePath(dirname(fromFile), specifier))
      } else {
        const packagePath = findInNodeModules(specifier, fromFile)
        if (packagePath) {
          targets.push(packagePath)
          // A named import off a package root: `{ Button } from '@mui/material'`
          // lives in the `Button/` folder beside every other component.
          const inner = importedName ?? componentName
          if (isComponentName(inner)) targets.push(join(packagePath, inner))
        }
      }

      for (const target of targets) {
        if (!target || !existsSync(target)) continue
        for (const file of candidateFiles(
          target,
          importedName ?? componentName,
        )) {
          host = hostElementFromSource(
            readFile(file),
            importedName ?? componentName,
          )
          if (host) break
        }
        if (host) break
      }
    } catch {
      host = null
    }

    cache.set(key, host)
    return host
  }
}
