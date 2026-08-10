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
 * ESLint rule: never let screen resolution choose the ELEMENT (AGL-1357).
 *
 * ## The invariant
 *
 * A component may not switch its rendered element type on whether a screen
 * resolves. `href` comes from the screens map, and the map behind the render
 * that produced an ISR page is not the map behind the render that hydrates it
 * — a screen published or unpublished in between is enough. Rendering `<a>`
 * on one and `<span>`/`<button>` on the other is a hydration mismatch, and
 * React remounts the subtree.
 *
 * The settled shape, from `f284feeee` (Link Container): **always render the
 * anchor, and simply omit `href` when it does not resolve**. An `<a>` with no
 * `href` is HTML's placeholder link — same element, still inert.
 *
 * ## Why a rule and not the comment that already exists
 *
 * The invariant has been violated three times. The linked accordion header
 * (`b96e97c16`) reintroduced it ONE DAY after the fix shipped, and
 * `screen-link.tsx` carries it twice, live. The comment explaining it lives in
 * `link-box.tsx`, and someone editing `accordion.tsx` has no reason to open
 * that file. A lint rule travels to the file being edited; a comment does not.
 *
 * ## What it reports
 *
 * A conditional whose test is data-flow-connected to the `href` an anchor in
 * one of its branches receives — that IS "over the screens map", derived
 * rather than pattern-matched on names — where one branch renders an anchor
 * and the other renders a different element. Three spellings:
 *
 * - a ternary in JSX, `resolved ? <AppLink href={href}/> : <Link component="span"/>`
 * - an early return, `if (!href) return <Button/>` above `return <AppLink href={href}/>`
 * - a ternary on the tag itself, `component={href ? 'a' : 'span'}` / `as={…}`
 *
 * Anchor-ness is DERIVED, never listed: an explicit `component=`/`as=` literal
 * first, then a lowercase tag, then the presence of `href`, and finally the
 * root element the component's own module declares
 * (`lib/rendered-host-element.mjs` — MUI's `Link.d.ts` says `'a'`,
 * `Button.d.ts` says `'button'`). A hand-kept list of "link components" would
 * drift the way the org-write deny-list drifted (AGL-1354/1355); this cannot,
 * because a new component brings its own declaration with it.
 *
 * ## Honest limits
 *
 * - Both branches must render an element. `{href && <AppLink href={href}/>}`
 *   and `: null` render nothing on one side — the same hydration hazard, but a
 *   different fix, and far too common a shape to report from here.
 * - A branch whose element cannot be classified stays silent. That is any
 *   component whose module declares no root element and that carries no
 *   `href` — including one defined in the file under lint.
 * - Relevance needs an `href={…}` expression somewhere in the enclosing
 *   function. A resolution conditional that never mentions `href` (say
 *   `screens[id] ? <a>…</a> : <span>…</span>`, both hrefless) is invisible.
 * - It is syntactic within one function: a switch pushed into a helper that
 *   returns an element type, or into a prop passed down from a parent, is not
 *   followed.
 * - `component={SomeComponent}` (a value, not a literal) is unknown, so a
 *   switch expressed by swapping two component *values* is not reported.
 */

import { createHostElementResolver } from './lib/rendered-host-element.mjs'

/** Props by which a component is told which element to be. */
const HOST_PROPS = new Set(['component', 'as'])

/** How deep to follow `const x = f(y)` when relating a test to an href. */
const EXPANSION_DEPTH = 3

/** How deep to follow an href back to whatever produced it. */
const PROVENANCE_DEPTH = 2

const FIX =
  'Render the anchor in BOTH branches and drop `href` when it does not ' +
  "resolve — an `<a>` with no `href` is HTML's placeholder link, which is " +
  'the shape Link Container settled on in `f284feeee` (AGL-1268/1357).'

/** Unwraps the type-only wrappers TypeScript puts around an expression. */
function unwrap(node) {
  let current = node
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression')
  ) {
    current = current.expression
  }
  return current
}

/** Every JSX element an expression can evaluate to, ternaries included. */
function jsxLeaves(node, out = []) {
  const expression = unwrap(node)
  if (!expression) return out
  if (expression.type === 'JSXElement') {
    out.push(expression)
    return out
  }
  if (expression.type === 'ConditionalExpression') {
    jsxLeaves(expression.consequent, out)
    jsxLeaves(expression.alternate, out)
  }
  return out
}

/** `Link`, `a`, `Aglyn.Thing` — whatever stands after the `<`. */
function jsxName(element) {
  const name = element.openingElement?.name
  if (!name) return null
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') return null
  return null
}

function findAttribute(element, predicate) {
  return (element.openingElement?.attributes ?? []).find(
    (attribute) =>
      attribute.type === 'JSXAttribute' &&
      attribute.name?.type === 'JSXIdentifier' &&
      predicate(attribute.name.name),
  )
}

/** The `component=`/`as=` override, and whether it is a plain string. */
function hostOverride(element) {
  const attribute = findAttribute(element, (name) => HOST_PROPS.has(name))
  if (!attribute) return null
  const value = attribute.value
  if (value?.type === 'Literal' && typeof value.value === 'string') {
    return { prop: attribute.name.name, host: value.value }
  }
  const inner = unwrap(value?.expression)
  if (inner?.type === 'Literal' && typeof inner.value === 'string') {
    return { prop: attribute.name.name, host: inner.value }
  }
  return { prop: attribute.name.name, host: null }
}

/**
 * The dotted path an expression reads, or null when it is not a plain
 * identifier/member chain. `href` -> `href`, `inline.href` -> `inline.href`,
 * `screens?.[id]` -> `screens[]`.
 *
 * Paths rather than bare identifiers are what separate a RESOLUTION test from
 * a DISCRIMINANT: `inline.type === 'link'` and `href={inline.href}` share the
 * object `inline`, but they read different properties, and rendering a link
 * run as `<a>` and a text run as `<span>` is correct. `!href` beside
 * `href={href}` reads the same value, and that is the bug.
 */
function pathOf(node) {
  let current = unwrap(node)
  if (current?.type === 'ChainExpression') current = current.expression
  if (!current) return null
  if (current.type === 'Identifier') return current.name
  if (current.type !== 'MemberExpression') return null
  const object = pathOf(current.object)
  if (!object) return null
  if (current.computed) return `${object}[]`
  if (current.property?.type !== 'Identifier') return null
  return `${object}.${current.property.name}`
}

/** Every value path an expression reads. */
function collectPaths(node, out) {
  if (!node || typeof node.type !== 'string') return
  const path = pathOf(node)
  if (path) {
    out.add(path)
    // A computed key is itself a value read: `screens[screenId]`.
    let cursor = unwrap(node)
    while (cursor) {
      if (cursor.type === 'ChainExpression') {
        cursor = cursor.expression
        continue
      }
      if (cursor.type !== 'MemberExpression') break
      if (cursor.computed) collectPaths(cursor.property, out)
      cursor = unwrap(cursor.object)
    }
    return
  }
  switch (node.type) {
    case 'Property':
      if (node.computed) collectPaths(node.key, out)
      collectPaths(node.value, out)
      return
    case 'JSXAttribute':
      collectPaths(node.value, out)
      return
    default:
      break
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) collectPaths(child, out)
    } else if (value && typeof value.type === 'string') {
      collectPaths(value, out)
    }
  }
}

/** Generic subtree walk (parent links skipped so it terminates). */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit)
    } else if (value && typeof value.type === 'string') {
      walk(value, visit)
    }
  }
}

function enclosingFunction(node) {
  let current = node
  while (current) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'Program'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'never switch the rendered element type on whether a screen ' +
        'resolves; render the anchor either way and omit `href`',
    },
    schema: [],
    messages: {
      elementSwitch:
        'Screen resolution decides the ELEMENT here: this branch renders ' +
        '`<{{host}}>` ({{why}}) while the other renders an anchor ' +
        '({{anchorWhy}}). `href` comes from the screens map, and the server ' +
        'render and the client render can disagree about it, so React ' +
        'remounts this subtree at hydration. ' +
        FIX,
      hostPropSwitch:
        "`{{prop}}` picks `'a'` or `'{{host}}'` from screen resolution, " +
        'so the element type depends on the screens map — which the server ' +
        'and the client can disagree about. ' +
        FIX,
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (/\.(spec|test|e2e|stories)\.[^.]+$/.test(filename)) return {}

    const hostElementFor = createHostElementResolver(
      context.cwd ?? process.cwd(),
    )
    /** local JSX name -> the import it came from. */
    const imports = new Map()
    /** local name -> the initialisers it was bound from. */
    const declarators = new Map()
    const reported = new Set()

    const bindNames = (pattern, init) => {
      if (!pattern || typeof pattern.type !== 'string') return
      switch (pattern.type) {
        case 'Identifier': {
          const existing = declarators.get(pattern.name) ?? []
          existing.push(init)
          declarators.set(pattern.name, existing)
          return
        }
        case 'ObjectPattern':
          for (const property of pattern.properties) {
            bindNames(property.value ?? property.argument, init)
          }
          return
        case 'ArrayPattern':
          for (const element of pattern.elements) bindNames(element, init)
          return
        case 'AssignmentPattern':
          bindNames(pattern.left, init)
          return
        case 'RestElement':
          bindNames(pattern.argument, init)
          return
        default:
      }
    }

    /**
     * Every name the expression depends on, followed through local `const`s.
     *
     * A bare-identifier initialiser is NOT followed: `const { screenId, href }
     * = props` would otherwise make every prop share the root `props` and look
     * related to every other one.
     */
    const expand = (node) => {
      const seed = new Set()
      collectPaths(node, seed)
      const out = new Set()
      let frontier = [...seed]
      for (
        let depth = 0;
        depth <= EXPANSION_DEPTH && frontier.length;
        depth += 1
      ) {
        const next = []
        for (const path of frontier) {
          if (out.has(path)) continue
          out.add(path)
          // Only a whole binding can be followed to what produced it; a
          // property read (`bar.href`) has no initialiser of its own.
          if (path.includes('.') || path.includes('[')) continue
          for (const init of declarators.get(path) ?? []) {
            const initialiser = unwrap(init)
            if (
              !initialiser ||
              initialiser.type === 'Identifier' ||
              initialiser.type === 'ThisExpression'
            ) {
              continue
            }
            const inner = new Set()
            collectPaths(initialiser, inner)
            for (const identifier of inner) {
              if (!out.has(identifier)) next.push(identifier)
            }
          }
        }
        frontier = next
      }
      for (const name of imports.keys()) out.delete(name)
      return out
    }

    /**
     * True when the test is about link resolution — i.e. it depends on a value
     * that an `href` in the same function is computed from. That relation is
     * the derivation of "conditional over the screens map": the href IS the
     * resolution result, so anything the href flows from is the map.
     */
    const hrefExpressionCache = new Map()
    const hrefExpressionsIn = (scope) => {
      if (hrefExpressionCache.has(scope)) return hrefExpressionCache.get(scope)
      const found = []
      walk(scope, (node) => {
        if (
          node.type === 'JSXAttribute' &&
          node.name?.type === 'JSXIdentifier' &&
          node.name.name === 'href' &&
          node.value?.type === 'JSXExpressionContainer'
        ) {
          found.push(node.value.expression)
        }
      })
      hrefExpressionCache.set(scope, found)
      return found
    }

    const isFunctionLike = (node) =>
      node?.type === 'ArrowFunctionExpression' ||
      node?.type === 'FunctionExpression'

    /** Everything a function body can hand back. */
    const returnedValues = (fn) => {
      if (fn.body?.type !== 'BlockStatement') return [fn.body]
      const values = []
      walk(fn.body, (node) => {
        if (node.type === 'ReturnStatement' && node.argument) {
          values.push(node.argument)
        }
      })
      return values
    }

    /** The identifier a callee chain starts from (`Aglyn.useLinkTarget` -> `Aglyn`). */
    const calleeRoot = (node) => {
      let current = unwrap(node)
      while (current) {
        if (current.type === 'ChainExpression') {
          current = unwrap(current.expression)
          continue
        }
        if (current.type === 'MemberExpression') {
          current = unwrap(current.object)
          continue
        }
        break
      }
      return current?.type === 'Identifier' ? current.name : null
    }

    /**
     * True when the value was RESOLVED rather than merely handed over: looked
     * up in a map (`screens[id]` — a computed read) or produced by a call into
     * an imported module (`Aglyn.useLinkTarget(screenId, …)`).
     *
     * This is what "over the screens map" means when it is derived instead of
     * name-matched. Resolution is a platform operation, so it arrives through
     * the platform; an href that is a prop, a plain field (`bar.href`) or the
     * result of a local helper is ordinary data, and `data ? <a/> : <span/>`
     * over ordinary data is not this invariant.
     */
    const isResolvedValue = (node, depth) => {
      const expression = unwrap(node)
      if (!expression) return false
      switch (expression.type) {
        case 'ChainExpression':
          return isResolvedValue(expression.expression, depth)
        case 'MemberExpression':
          return Boolean(expression.computed)
        case 'NewExpression':
        case 'CallExpression': {
          const callbacks = (expression.arguments ?? []).filter(isFunctionLike)
          if (callbacks.length) {
            // `useMemo(() => …)` is a wrapper; the value is what it returns.
            return callbacks.some((callback) =>
              returnedValues(callback).some((value) =>
                isResolvedValue(value, depth),
              ),
            )
          }
          const root = calleeRoot(expression.callee)
          return Boolean(root && imports.has(root))
        }
        case 'ConditionalExpression':
          return (
            isResolvedValue(expression.consequent, depth) ||
            isResolvedValue(expression.alternate, depth)
          )
        case 'LogicalExpression':
          return (
            isResolvedValue(expression.left, depth) ||
            isResolvedValue(expression.right, depth)
          )
        case 'TemplateLiteral':
          return expression.expressions.some((part) =>
            isResolvedValue(part, depth),
          )
        case 'Identifier': {
          if (depth <= 0) return false
          return (declarators.get(expression.name) ?? []).some((init) => {
            const initialiser = unwrap(init)
            if (!initialiser || initialiser.type === 'Identifier') return false
            return isResolvedValue(initialiser, depth - 1)
          })
        }
        default:
          return false
      }
    }

    const isResolutionKeyed = (test) => {
      const scope = enclosingFunction(test)
      if (!scope) return false
      const hrefExpressions = hrefExpressionsIn(scope)
      if (!hrefExpressions.length) return false
      const testNames = expand(test)
      if (!testNames.size) return false
      for (const expression of hrefExpressions) {
        if (!isResolvedValue(expression, PROVENANCE_DEPTH)) continue
        for (const name of expand(expression)) {
          if (testNames.has(name)) return true
        }
      }
      return false
    }

    /** anchor | nonAnchor | unknown — derived, in order of specificity. */
    const classify = (element) => {
      const override = hostOverride(element)
      if (override && override.host === null) return { kind: 'unknown' }
      if (override) {
        return {
          kind: override.host === 'a' ? 'anchor' : 'nonAnchor',
          host: override.host,
          why: `\`${override.prop}="${override.host}"\``,
        }
      }
      const name = jsxName(element)
      if (!name) return { kind: 'unknown' }
      if (/^[a-z]/.test(name)) {
        return {
          kind: name === 'a' ? 'anchor' : 'nonAnchor',
          host: name,
          why: `the literal \`<${name}>\``,
        }
      }
      if (findAttribute(element, (attribute) => attribute === 'href')) {
        return { kind: 'anchor', host: 'a', why: 'its `href`' }
      }
      const source = imports.get(name)
      if (!source) return { kind: 'unknown' }
      const host = hostElementFor(
        source.specifier,
        name,
        source.imported,
        filename,
      )
      if (!host) return { kind: 'unknown' }
      return {
        kind: host === 'a' ? 'anchor' : 'nonAnchor',
        host,
        why: `\`${name}\` renders \`<${host}>\` — \`${source.specifier}\` declares it`,
      }
    }

    const report = (element, verdict, anchorVerdict) => {
      const node = element.openingElement?.name ?? element
      if (reported.has(node)) return
      reported.add(node)
      context.report({
        node,
        messageId: 'elementSwitch',
        data: {
          host: verdict.host,
          why: verdict.why,
          anchorWhy: anchorVerdict.why,
        },
      })
    }

    /** Equal-length branches zip; otherwise only homogeneous sides compare. */
    const pairUp = (left, right) => {
      if (left.length === right.length) {
        return left.map((element, index) => [element, right[index]])
      }
      const homogeneous = (list) => {
        const kinds = new Set(list.map((element) => classify(element).kind))
        return kinds.size === 1
      }
      if (homogeneous(left) && homogeneous(right)) return [[left[0], right[0]]]
      return []
    }

    const compare = (test, leftExpression, rightExpression) => {
      const left = jsxLeaves(leftExpression)
      const right = jsxLeaves(rightExpression)
      if (!left.length || !right.length) return
      if (!isResolutionKeyed(test)) return
      for (const [a, b] of pairUp(left, right)) {
        const first = classify(a)
        const second = classify(b)
        if (first.kind === 'anchor' && second.kind === 'nonAnchor') {
          report(b, second, first)
        } else if (second.kind === 'anchor' && first.kind === 'nonAnchor') {
          report(a, first, second)
        }
      }
    }

    /** The expression an `if` branch returns, if it returns one. */
    const returnedExpression = (statement) => {
      if (!statement) return null
      if (statement.type === 'ReturnStatement') return statement.argument
      if (statement.type === 'BlockStatement') {
        for (let index = statement.body.length - 1; index >= 0; index -= 1) {
          if (statement.body[index].type === 'ReturnStatement') {
            return statement.body[index].argument
          }
        }
      }
      return null
    }

    /** The return an early-returning `if` is implicitly the alternative to. */
    const nextReturnAfter = (node) => {
      const block = node.parent
      if (!block || block.type !== 'BlockStatement') return null
      const index = block.body.indexOf(node)
      if (index === -1) return null
      for (let cursor = index + 1; cursor < block.body.length; cursor += 1) {
        const statement = block.body[cursor]
        if (statement.type === 'ReturnStatement') return statement.argument
      }
      return null
    }

    const checkIf = (node) => {
      const consequent = returnedExpression(node.consequent)
      if (!consequent) return
      const alternate = node.alternate
        ? returnedExpression(node.alternate)
        : nextReturnAfter(node)
      if (!alternate) return
      compare(node.test, consequent, alternate)
    }

    const checkTernary = (node) => {
      // A ternary on the tag itself: `component={href ? 'a' : 'span'}`.
      const container = node.parent
      const attribute = container?.parent
      if (
        container?.type === 'JSXExpressionContainer' &&
        attribute?.type === 'JSXAttribute' &&
        attribute.name?.type === 'JSXIdentifier' &&
        HOST_PROPS.has(attribute.name.name)
      ) {
        const consequent = unwrap(node.consequent)
        const alternate = unwrap(node.alternate)
        const isTag = (value) =>
          value?.type === 'Literal' && typeof value.value === 'string'
        if (isTag(consequent) && isTag(alternate)) {
          const hosts = [consequent.value, alternate.value]
          const other = hosts.find((host) => host !== 'a')
          if (hosts.includes('a') && other && isResolutionKeyed(node.test)) {
            context.report({
              node,
              messageId: 'hostPropSwitch',
              data: { prop: attribute.name.name, host: other },
            })
          }
          return
        }
      }
      compare(node.test, node.consequent, node.alternate)
    }

    // Every conditional is collected and judged at `Program:exit`: relevance
    // reads local `const`s, and a declaration below the `if` it explains has
    // not been visited yet while the traversal is still running.
    const conditionals = []

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.local?.type !== 'Identifier') continue
          imports.set(specifier.local.name, {
            specifier: node.source.value,
            imported:
              specifier.type === 'ImportSpecifier'
                ? (specifier.imported?.name ?? null)
                : null,
          })
        }
      },

      VariableDeclarator(node) {
        bindNames(node.id, node.init)
      },

      IfStatement(node) {
        conditionals.push(node)
      },

      ConditionalExpression(node) {
        conditionals.push(node)
      },

      'Program:exit'() {
        for (const node of conditionals) {
          if (node.type === 'IfStatement') checkIf(node)
          else checkTernary(node)
        }
      },
    }
  },
}
