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
 * ESLint rule: a Firestore write whose payload spreads a row that came out of
 * a listener configured with `idField`, so the synthetic `$id` the hook
 * stamped in memory gets stored as a real field.
 *
 * `idField: '$id'` puts the document id onto the in-memory object and nothing
 * persists it — that is the whole point of the option. `{...row}` reaching a
 * payload persists it anyway: silently, since nothing reads the key, and
 * cumulatively, since a row copied twice can carry a `$id` that no longer
 * matches its own document id. Once stored, no later reader can tell a
 * listener artifact from a field the card meant to write.
 *
 * Four writes shipped this shape before anyone looked (AGL-1374, all fixed in
 * `86270af4a`):
 *
 *   - `catalog-organization-card` — the delete's reparent, `{...child,
 *     parentId: null}`, on every child of a deleted category
 *   - `discounts-card` and `reservations-card` — an editor seeded
 *     `{ id: row.$id, ...row }` and saved with `const { id, ...data } = draft`,
 *     which takes `id` off and leaves `$id` behind
 *   - `product-editor-dialog` — `{...current}` at `merge: false`, so the key
 *     was stored on every product save
 *
 * It is the third issue out of one affordance (AGL-1372 omits fields, AGL-1358
 * overwrites whole documents, AGL-1374 invents one), which is the AGL-1357
 * threshold for turning an invariant into a rule. The runtime fix — stamping
 * the id non-enumerable — is stronger and is not free: `host-overlays-card`
 * seeds its dialog by spreading a row and then reads `editor.$id`, so a
 * non-enumerable key would mint a fresh uid and duplicate the overlay instead
 * of updating it. This buys the guarantee in the meantime.
 *
 * ## What counts as a violation
 *
 * The payload argument of `setDoc` / `updateDoc` / `addDoc` traces back to a
 * listener row, through object spreads and local bindings, without `$id` ever
 * being taken off. "Listener row" is established two ways, both of them
 * syntactic and both of them inside the file being linted:
 *
 *   1. the value comes from `useFirestoreCollection` / `useFirestoreDoc` /
 *      `useDoc` **called with an `idField` option**, or from
 *      `useSwitcherCollection`, which defaults `idField` to `'$id'`. A
 *      listener without `idField` stamps nothing and is not an instance.
 *   2. the value comes from a binding, parameter or prop whose declared TYPE
 *      names `$id`. In this repo `$id` only ever means the synthetic key, so a
 *      type that admits it is describing a listener row —
 *      `product: (HostProduct & { $id: string }) | null` is how the key
 *      reaches `product-editor-dialog` from the hub one file over.
 *
 * Three things stop the trace, and each is a real idiom the rule must not
 * punish:
 *
 *   - **the strip**: a rest destructure that names `$id`
 *     (`const { $id: _syntheticId, ...data } = seeded`) — what `discounts`,
 *     `reservations`, `product-editor`, `host-overlays-card` and
 *     `host-experiments-card` all do today. Also `omit(row, '$id')`.
 *   - **an assembled literal**: an object built key by key taints nothing,
 *     because only a spread can carry a key nobody named. This is the whole
 *     difference between `suppliers-card` — `setDraft({ id: supplier.$id,
 *     name: …, email: … })`, which is NOT an instance despite spreading
 *     `...data` into its write — and `discounts-card`, whose seed is
 *     `setDraft({ id: discount.$id, ...discount })` and is. The rule tells
 *     them apart by the thing that actually differs, not by a name list.
 *   - **an explicit `$id` in the payload**: the author is controlling the key
 *     deliberately. Besigner canvas nodes genuinely store theirs.
 *
 * Conditional spreads (`...(cond ? { x } : {})`) — about fifteen sites — fall
 * out for free: they trace to object literals, and a literal is clean.
 * `...parentPath` in `besigner-versions` is a spread into `doc(firestore, …)`,
 * an argument list rather than a payload object, so the rule never looks at
 * it.
 *
 * ## Honest limits
 *
 * These are deliberate false NEGATIVES. A rule that fires on every `...row`
 * gets switched off, and across the pre-fix tree there are 149 `setDoc` /
 * `updateDoc` / `addDoc` payload sites, 35 of them spread-bearing, against 4
 * real instances — so the cost of reaching is 31 reports that are all wrong.
 *
 *   - **Cross-file flow.** A row spread into a payload in a file that neither
 *     calls a listener hook nor declares `$id` in a type is invisible. The
 *     `$id`-in-the-type signal is what rescues the one instance that crossed a
 *     file boundary; a prop typed `any` would not be caught.
 *   - **State updaters.** `setDraft(prev => ({ ...prev, … }))` is skipped —
 *     `prev` is the state being resolved, so following it loops. Every
 *     instance so far seeds the state with a plain value, which is followed.
 *   - **Server writes.** `snapshot.data()` on the admin SDK carries no
 *     synthetic key, and the rule does not look at it.
 *   - **`Map.set` and other non-Firestore sinks** are out of scope; only the
 *     three client write functions are payload sinks.
 *
 * The one speculative step is `TRACE_THROUGH_CALLS`: an unrecognised call
 * passes taint from its arguments, because a helper handed a listener row
 * usually returns the row with adjustments. It was measured rather than
 * assumed — over the whole pre-fix tree it is worth exactly one report,
 * `product-editor-dialog`'s `liftLegacyProduct(product)`, which is a true
 * positive, and zero others. Turning it off drops that instance and changes
 * nothing else, so it earns its place.
 *
 * ## Provenance
 *
 * Run against `86270af4a^` — the revision before AGL-1374's fix — this rule
 * reports the four instances that issue listed and nothing else, across
 * 14,742 files. Against today's tree it reports nothing. That is the whole
 * claim: it has been observed failing on the code that shipped, and passing
 * on the code that replaced it.
 */

/**
 * Listener hooks that can stamp a synthetic id. `useSwitcherCollection`
 * defaults `idField` to `'$id'`; the rest stamp nothing without the option,
 * which is why the option is checked rather than the name alone.
 */
const LISTENER_HOOKS = new Set([
  'useFirestoreCollection',
  'useFirestoreDoc',
  'useDoc',
])
const ALWAYS_STAMPING_HOOKS = new Set(['useSwitcherCollection'])

/** Client write functions whose second argument is the stored payload. */
const WRITE_FUNCTIONS = new Set(['setDoc', 'updateDoc', 'addDoc'])

/**
 * Array methods that hand back the same rows. `map` is absent on purpose: it
 * returns whatever the callback built, and the callback is where a projection
 * would have dropped the key.
 */
const ROW_PRESERVING_METHODS = new Set([
  'filter',
  'find',
  'slice',
  'sort',
  'concat',
  'reverse',
  'at',
  'flat',
  'findLast',
])

/** Methods whose callback parameter is one of the receiver's rows. */
const ITERATION_METHODS = new Set([
  'map',
  'filter',
  'find',
  'forEach',
  'flatMap',
  'some',
  'every',
  'findLast',
  'reduce',
])

/** Hooks whose first argument is a factory for the value they return. */
const MEMO_HOOKS = new Set(['useMemo', 'useCallback'])

/** See the doc comment — the one inference the rule makes without proof. */
const TRACE_THROUGH_CALLS = true

/** Unwraps casts, non-null assertions and awaits so the shape below is real. */
function unwrap(node) {
  let current = node
  while (current) {
    switch (current.type) {
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
        current = current.expression
        break
      case 'TSInstantiationExpression':
        current = current.expression
        break
      case 'AwaitExpression':
        current = current.argument
        break
      case 'ChainExpression':
        current = current.expression
        break
      default:
        return current
    }
  }
  return current
}

/** The callee's name, for both `setDoc(…)` and `firestore.setDoc(…)`. */
function calleeName(node) {
  const callee = unwrap(node.callee)
  if (!callee) return null
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && !callee.computed) {
    return callee.property.type === 'Identifier' ? callee.property.name : null
  }
  return null
}

/** `$id` written as `$id` or `'$id'`, as a key or as a string argument. */
function namesSyntheticId(node) {
  if (!node) return false
  if (node.type === 'Identifier') return node.name === '$id'
  if (node.type === 'Literal') return node.value === '$id'
  return false
}

/**
 * A declared type that admits `$id`. Textual on purpose: `$id` has exactly one
 * meaning in this repo, and walking intersections, unions, references and
 * generic arguments to find it would be a lot of machinery to reach the same
 * answer less legibly.
 */
function typeTextNamesSyntheticId(sourceCode, typeNode) {
  if (!typeNode) return false
  return /\$id\s*[?!]?\s*:/.test(sourceCode.getText(typeNode))
}

/** Walks up the scope chain for a binding. */
function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name)
    if (variable) return variable
  }
  return null
}

/** The interface or type alias declared under this name in the same file. */
function findTypeDeclaration(sourceCode, name) {
  for (const statement of sourceCode.ast.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? statement.declaration
        : statement
    if (!declaration) continue
    if (
      (declaration.type === 'TSInterfaceDeclaration' ||
        declaration.type === 'TSTypeAliasDeclaration') &&
      declaration.id?.name === name
    ) {
      return declaration
    }
  }
  return null
}

/** The member of a props interface bound by a destructuring key. */
function propsMemberType(sourceCode, typeAnnotation, key) {
  const reference = unwrapTypeReference(typeAnnotation)
  if (!reference) return null
  const declaration = findTypeDeclaration(sourceCode, reference)
  if (!declaration) return null
  const members =
    declaration.type === 'TSInterfaceDeclaration'
      ? declaration.body?.body
      : declaration.typeAnnotation?.type === 'TSTypeLiteral'
        ? declaration.typeAnnotation.members
        : null
  if (!members) return null
  for (const member of members) {
    if (
      member.type === 'TSPropertySignature' &&
      member.key?.type === 'Identifier' &&
      member.key.name === key
    ) {
      return member.typeAnnotation?.typeAnnotation ?? null
    }
  }
  return null
}

/** `props: HostCardProps` → `'HostCardProps'`. */
function unwrapTypeReference(typeNode) {
  if (!typeNode) return null
  if (typeNode.type === 'TSTypeReference') {
    return typeNode.typeName?.type === 'Identifier'
      ? typeNode.typeName.name
      : null
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'never spread a listener row into a Firestore write payload — the ' +
        'synthetic `$id` the hook stamped in memory gets stored as a real field',
    },
    schema: [],
    messages: {
      listenerRowSpread:
        'This payload spreads a listener row — {{evidence}} — so the SYNTHETIC ' +
        '`$id` the hook stamped in memory is STORED as a real field on every ' +
        'write, silently and permanently (AGL-1374). Strip it ' +
        '(`const { $id: _syntheticId, ...data } = seeded`) or write only the ' +
        'fields the operation changes.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode

    /**
     * Resolves an expression to the listener row behind it, or `null` when it
     * is clean, unknown, or has had `$id` taken off along the way. `seen`
     * breaks the cycle that `setDraft({ ...current, ...patch })` makes, where
     * the state's seed is written in terms of the state.
     */
    function taint(node, seen) {
      const value = unwrap(node)
      if (!value || seen.has(value)) return null
      seen.add(value)

      switch (value.type) {
        // A literal taints only through a spread — a key the author named is
        // a key the author chose. This is the `suppliers-card` boundary.
        case 'ObjectExpression': {
          // An explicit `$id` means the author is controlling the key
          // deliberately (besigner canvas nodes really do store theirs).
          for (const property of value.properties) {
            if (
              property.type === 'Property' &&
              !property.computed &&
              namesSyntheticId(property.key)
            ) {
              return null
            }
          }
          for (const property of value.properties) {
            if (property.type !== 'SpreadElement') continue
            const found = taint(property.argument, seen)
            if (found) return found
          }
          return null
        }

        case 'ConditionalExpression':
          return taint(value.consequent, seen) ?? taint(value.alternate, seen)

        case 'LogicalExpression':
          return taint(value.left, seen) ?? taint(value.right, seen)

        case 'Identifier':
          return taintOfBinding(value, seen)

        case 'MemberExpression': {
          // `row.$id` is the id itself, a string — reading it is what the
          // option is for. Any other named read is a field, not the row.
          if (!value.computed) return null
          // `rows[0]`, `docs?.[index]` — an element of a tainted list.
          return taint(value.object, seen)
        }

        case 'CallExpression':
          return taintOfCall(value, seen)

        default:
          return null
      }
    }

    function taintOfCall(call, seen) {
      const name = calleeName(call)
      if (!name) return null

      if (ALWAYS_STAMPING_HOOKS.has(name)) {
        return { node: call, evidence: `${name} stamps \`$id\` by default` }
      }
      if (LISTENER_HOOKS.has(name)) {
        // No `idField` option means no synthetic key and no instance.
        const stamps = call.arguments.some((argument) => {
          const value = unwrap(argument)
          return (
            value?.type === 'ObjectExpression' &&
            value.properties.some(
              (property) =>
                property.type === 'Property' &&
                !property.computed &&
                property.key?.type === 'Identifier' &&
                property.key.name === 'idField',
            )
          )
        })
        return stamps
          ? { node: call, evidence: `${name}(…, { idField })` }
          : null
      }

      // An explicit `$id` argument is a strip helper — `omit(row, '$id')`.
      if (
        call.arguments.some((argument) => namesSyntheticId(unwrap(argument)))
      ) {
        return null
      }

      const callee = unwrap(call.callee)
      if (callee?.type === 'MemberExpression' && !callee.computed) {
        const method = callee.property?.name
        if (ROW_PRESERVING_METHODS.has(method)) {
          return taint(callee.object, seen)
        }
      }

      // `useMemo(() => row, deps)` returns what the factory returns.
      if (MEMO_HOOKS.has(name)) {
        const factory = unwrap(call.arguments[0])
        if (
          (factory?.type === 'ArrowFunctionExpression' ||
            factory?.type === 'FunctionExpression') &&
          factory.body.type !== 'BlockStatement'
        ) {
          return taint(factory.body, seen)
        }
        return null
      }

      if (!TRACE_THROUGH_CALLS) return null
      // A helper handed a listener row usually hands the row back adjusted.
      for (const argument of call.arguments) {
        const value = unwrap(argument)
        if (
          value?.type === 'ArrowFunctionExpression' ||
          value?.type === 'FunctionExpression'
        ) {
          continue
        }
        const found = taint(argument, seen)
        if (found) return found
      }
      return null
    }

    function taintOfBinding(identifier, seen) {
      const variable = findVariable(
        sourceCode.getScope(identifier),
        identifier.name,
      )
      if (!variable) return null

      for (const definition of variable.defs) {
        const found = taintOfDefinition(variable, definition, seen)
        if (found) return found
      }
      return null
    }

    function taintOfDefinition(variable, definition, seen) {
      const declarator = definition.node
      const name = definition.name

      // A parameter whose declared type admits `$id`.
      if (definition.type === 'Parameter') {
        if (
          typeTextNamesSyntheticId(
            sourceCode,
            name?.typeAnnotation?.typeAnnotation,
          )
        ) {
          return {
            node: name,
            evidence: `\`${name.name}\` is typed with \`$id\``,
          }
        }
        return taintOfCallbackParameter(definition, seen)
      }

      if (definition.type !== 'Variable') return null

      // `for (const child of children)`
      const declaration = declarator.parent
      if (declaration?.type === 'VariableDeclaration') {
        const enclosing = declaration.parent
        if (
          enclosing?.type === 'ForOfStatement' &&
          enclosing.left === declaration
        ) {
          return taint(enclosing.right, seen)
        }
      }

      const id = declarator.id
      const init = declarator.init

      // An annotation on the binding itself.
      if (
        typeTextNamesSyntheticId(sourceCode, id?.typeAnnotation?.typeAnnotation)
      ) {
        return {
          node: id,
          evidence: `\`${variable.name}\` is typed with \`$id\``,
        }
      }

      if (!id) return null

      if (id.type === 'Identifier') return init ? taint(init, seen) : null

      if (id.type === 'ObjectPattern') {
        return taintOfObjectPattern(variable, id, init, seen)
      }

      if (id.type === 'ArrayPattern') {
        return taintOfArrayPattern(variable, id, init, seen)
      }

      return null
    }

    /** `const { $id: _x, ...data } = seeded` and `const { data: rows } = useX()`. */
    function taintOfObjectPattern(variable, pattern, init, seen) {
      // THE STRIP. A rest destructure that names `$id` has removed it, and
      // nothing downstream can carry it. This is the fix idiom, so it has to
      // be a hard stop rather than one more clean branch.
      const strips = pattern.properties.some(
        (property) =>
          property.type === 'Property' &&
          !property.computed &&
          namesSyntheticId(property.key),
      )

      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          if (property.argument?.name !== variable.name) continue
          if (strips) return null
          return init ? taint(init, seen) : null
        }
        if (property.type !== 'Property') continue
        const bound = property.value
        const boundName =
          bound?.type === 'Identifier'
            ? bound.name
            : bound?.type === 'AssignmentPattern' &&
                bound.left?.type === 'Identifier'
              ? bound.left.name
              : null
        if (boundName !== variable.name) continue

        // `const { hostId, product } = props` — ask the props type about the
        // member, which is how a row typed one file over is recognised.
        const source = unwrap(init)
        if (source?.type === 'Identifier' && !property.computed) {
          const key = property.key?.name
          const sourceVariable = findVariable(
            sourceCode.getScope(source),
            source.name,
          )
          const parameter = sourceVariable?.defs?.find(
            (candidate) => candidate.type === 'Parameter',
          )
          const memberType = parameter
            ? propsMemberType(
                sourceCode,
                parameter.name?.typeAnnotation?.typeAnnotation,
                key,
              )
            : null
          if (typeTextNamesSyntheticId(sourceCode, memberType)) {
            return {
              node: property,
              evidence: `\`${source.name}.${key}\` is typed with \`$id\``,
            }
          }
        }

        // `const { data: rows, status } = useFirestoreCollection(…)`
        if (property.key?.name === 'data')
          return init ? taint(init, seen) : null
        return null
      }
      return null
    }

    /** `const [draft, setDraft] = useState(seed)`. */
    function taintOfArrayPattern(variable, pattern, init, seen) {
      const index = pattern.elements.findIndex(
        (element) =>
          element?.type === 'Identifier' && element.name === variable.name,
      )
      if (index !== 0) return null
      const source = unwrap(init)
      if (
        source?.type !== 'CallExpression' ||
        calleeName(source) !== 'useState'
      ) {
        return init ? taint(init, seen) : null
      }

      const initial = source.arguments[0]
      if (initial) {
        const found = taint(initial, seen)
        if (found) return found
      }

      // Everything the setter is ever called with is a possible value of the
      // state. Updater functions are skipped: `prev` IS this state.
      const setter = pattern.elements[1]
      if (setter?.type !== 'Identifier') return null
      const setterVariable = findVariable(
        sourceCode.getScope(setter),
        setter.name,
      )
      if (!setterVariable) return null
      for (const reference of setterVariable.references) {
        const call = reference.identifier.parent
        if (
          call?.type !== 'CallExpression' ||
          call.callee !== reference.identifier
        ) {
          continue
        }
        const argument = unwrap(call.arguments[0])
        if (
          !argument ||
          argument.type === 'ArrowFunctionExpression' ||
          argument.type === 'FunctionExpression'
        ) {
          continue
        }
        const found = taint(argument, seen)
        if (found) return found
      }
      return null
    }

    /** `(discountDocs ?? []).map((discount) => …)` — the row is the receiver's. */
    function taintOfCallbackParameter(definition, seen) {
      const fn = definition.node
      const call = fn?.parent
      if (call?.type !== 'CallExpression' || call.callee === fn) return null
      const callee = unwrap(call.callee)
      if (callee?.type !== 'MemberExpression' || callee.computed) return null
      if (!ITERATION_METHODS.has(callee.property?.name)) return null
      // `reduce`'s row is the SECOND parameter; every other method's is first.
      const rowIndex = callee.property.name === 'reduce' ? 1 : 0
      if (fn.params[rowIndex] !== definition.name) return null
      return taint(callee.object, seen)
    }

    return {
      CallExpression(node) {
        const name = calleeName(node)
        if (!WRITE_FUNCTIONS.has(name)) return
        const payload = node.arguments[1]
        if (!payload) return
        const found = taint(payload, new Set())
        if (!found) return
        context.report({
          node: payload,
          messageId: 'listenerRowSpread',
          data: { evidence: found.evidence },
        })
      },
    }
  },
}
