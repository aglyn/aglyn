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
 * ESLint rule: forbid gating an entitlement/quota check on the mere PRESENCE
 * of an org's `plan` field.
 *
 * Root cause of the free-tier leak (AGL-46x): `createOrganization` writes org
 * docs with no `plan` field, and `resolveEffectivePlan` maps a missing plan to
 * `free`. But several call sites short-circuited the gate whenever `plan` was
 * absent, e.g.
 *
 *   if (org.plan && !checkEntitlement(org, 'videoMedia')) { deny() }   // logical
 *   const ok = !org.plan || checkEntitlement(org, 'mediaCdn')          // logical
 *   if (org.plan) { const q = checkQuota(org, 'hostLimit', n); ... }   // block
 *
 * so a plan-less org (every newly created org) skipped the gate entirely.
 *
 * The gate functions already resolve a missing plan as `free`, so coupling them
 * to a raw `plan`-presence check is always wrong. This rule flags BOTH forms:
 *   - a logical `&&`/`||` expression that contains both a `plan` member access
 *     and a gate call, and
 *   - an `if (…plan…) { … }` whose test hinges on a `plan` member access and
 *     whose body contains a gate call.
 *
 * The fix is to call the gate unconditionally (let it resolve to `free`), or,
 * for a genuine internal/staff bypass, use a per-org `entitlements` override —
 * never the absent-plan hole.
 */

const GATE_CALLEES = new Set([
  'checkEntitlement',
  'hasEntitlement',
  'checkQuota',
  'checkSeatQuota',
  'checkDatasetQuota',
  'checkDataStorageQuota',
])

/** True for a node that reads a `.plan` / `['plan']` property (any receiver). */
function isPlanAccess(node) {
  if (!node || node.type !== 'MemberExpression') return false
  const prop = node.property
  if (node.computed) {
    return (
      (prop.type === 'Literal' && prop.value === 'plan') ||
      (prop.type === 'TemplateLiteral' &&
        prop.quasis.length === 1 &&
        prop.quasis[0].value.cooked === 'plan')
    )
  }
  return prop.type === 'Identifier' && prop.name === 'plan'
}

/** True for a call to one of the entitlement/quota gate functions. */
function isGateCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (callee.type === 'Identifier') return GATE_CALLEES.has(callee.name)
  if (callee.type === 'MemberExpression' && !callee.computed) {
    return (
      callee.property.type === 'Identifier' &&
      GATE_CALLEES.has(callee.property.name)
    )
  }
  return false
}

/**
 * Walk a subtree, returning true as soon as `predicate` matches any node.
 * Skips nested function bodies so a gate call in an unrelated inner closure
 * doesn't get attributed to an outer `plan` test.
 */
function subtreeHas(node, predicate, stopAtFunctions) {
  if (!node || typeof node.type !== 'string') return false
  if (predicate(node)) return true
  if (
    stopAtFunctions &&
    (node.type === 'FunctionExpression' ||
      node.type === 'FunctionDeclaration' ||
      node.type === 'ArrowFunctionExpression')
  ) {
    return false
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string' && subtreeHas(child, predicate, stopAtFunctions)) {
          return true
        }
      }
    } else if (value && typeof value.type === 'string') {
      if (subtreeHas(value, predicate, stopAtFunctions)) return true
    }
  }
  return false
}

const MESSAGE =
  'Do not gate an entitlement/quota check on the presence of `plan`: a ' +
  'plan-less org resolves as `free`, so this lets it bypass the gate. Call ' +
  'the gate unconditionally, or use a per-org `entitlements` override.'

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid coupling an entitlement/quota gate to a raw org.plan presence check',
    },
    schema: [],
    messages: { noPlanGate: MESSAGE },
  },
  create(context) {
    return {
      // Form A: `org.plan && !checkEntitlement(...)`, `!org.plan || check(...)`.
      // Only inspect the outermost logical expression of a chain (its parent is
      // not itself a LogicalExpression) so we report once.
      LogicalExpression(node) {
        if (node.parent && node.parent.type === 'LogicalExpression') return
        const hasPlan = subtreeHas(node, isPlanAccess, false)
        const hasGate = subtreeHas(node, isGateCall, false)
        if (hasPlan && hasGate) {
          context.report({ node, messageId: 'noPlanGate' })
        }
      },
      // Form B: `if (…org.plan…) { …checkQuota(...)… }`.
      IfStatement(node) {
        if (!subtreeHas(node.test, isPlanAccess, false)) return
        // A gate call already inside the test is covered by Form A above;
        // here we care about a gate in the guarded body.
        if (
          subtreeHas(node.consequent, isGateCall, true) ||
          (node.alternate && subtreeHas(node.alternate, isGateCall, true))
        ) {
          context.report({ node: node.test, messageId: 'noPlanGate' })
        }
      },
    }
  },
}
