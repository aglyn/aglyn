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
 * ESLint rule: a plugin component that spreads the node's props and *then*
 * writes its own `sx` literal, which replaces — never merges — whatever the
 * author styled the node with.
 *
 * Five instances of one shape, every one found by a human measuring a
 * computed style rather than by anything in the toolchain:
 *
 *   - Link Container (`db4cd323e`)
 *   - Image (AGL-1240, `63736a494`)
 *   - the Tabs container and the Tab panel (AGL-1284) — "every Tabs on
 *     every site rendered with default MUI styling and no way to change it"
 *   - the Plugin Frame iframe and Custom HTML's placeholder (AGL-1284)
 *
 * The failure is completely silent: the styles are authored in the editor,
 * saved to the document, present in the JSON, and simply never render.
 * Nothing warns, and the canvas looks exactly like the published page — so
 * it reads as "my CSS is wrong", not "the component threw it away".
 *
 * ## What counts as a violation
 *
 * A spread of a props bag (`{...rest}`, `{...props}`) followed, on the SAME
 * element, by an `sx` whose value cannot possibly contain the spread's own
 * `sx`: an object literal with no spread element, or an array literal whose
 * every entry is an object literal. MUI reads the array form left-to-right,
 * so the fix is always to put the author's value LAST:
 *
 * ```tsx
 * const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
 * <Box {...rest} sx={[{ display: 'flex' }, ...nodeSx]} />
 * ```
 *
 * ## Honest limits
 *
 * It is deliberately generous about what merges. `sx={{ ...base, ...other }}`
 * passes even when `other` is not the node's `sx`, and `sx={someVariable}`
 * always passes — the rule cannot follow either without type information,
 * and a rule that fires on correct code teaches people to silence it
 * mechanically, which is worse than no rule (see no-unguarded-loading-hook).
 * What it catches with certainty is the literal-after-spread form, which is
 * the one that has actually shipped, five times.
 *
 * Hide-rules are the one case where the component's value legitimately goes
 * last (a deselected Tab panel must stay hidden however the author styles
 * `display`). Those already merge the author's `sx` in the middle of the
 * array, so they pass — an element that genuinely needs to win outright can
 * carry an eslint-disable line saying why.
 */

/** Spreads of a props bag — `{...rest}`, `{...props.slotProps}`. */
function isPropsSpread(attribute) {
  if (attribute.type !== 'JSXSpreadAttribute') return false
  const argument = attribute.argument
  return (
    argument.type === 'Identifier' ||
    argument.type === 'MemberExpression' ||
    // `{...(rest as Record<string, unknown>)}` — the cast is not the point.
    argument.type === 'TSAsExpression'
  )
}

/** Unwraps casts and parentheses so the shape below is the real one. */
function unwrap(node) {
  let current = node
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSTypeAssertion')
  ) {
    current = current.expression
  }
  return current
}

/**
 * True when this expression *might* be the author's `sx` arriving from the
 * props bag. Anything written inline in the component — an object literal,
 * an array of object literals, a conditional between two of them — provably
 * is not, which is what lets the rule see through
 * `sx={{ …, ...(loading ? { visibility: 'hidden' } : {}) }}`: that spread
 * looks like a merge and merges nothing (the Plugin Frame, AGL-1284).
 * Anything else — an identifier, a member read, a call — could be, and the
 * rule gives it the benefit of the doubt.
 */
function couldBeAuthorSx(node) {
  const value = unwrap(node)
  if (!value) return false
  switch (value.type) {
    case 'ObjectExpression':
      return false
    case 'ArrayExpression':
      return value.elements.some(
        (element) =>
          element !== null &&
          couldBeAuthorSx(
            element.type === 'SpreadElement' ? element.argument : element,
          ),
      )
    case 'ConditionalExpression':
      return (
        couldBeAuthorSx(value.consequent) || couldBeAuthorSx(value.alternate)
      )
    case 'LogicalExpression':
      return couldBeAuthorSx(value.left) || couldBeAuthorSx(value.right)
    default:
      return true
  }
}

/**
 * True when this `sx` value cannot carry the spread's own `sx` through —
 * i.e. it replaces the author's styles outright.
 */
function replacesAuthorSx(node) {
  const value = unwrap(node)
  if (!value) return false
  switch (value.type) {
    // `sx={{ p: 2 }}` — the whole bug. A spread of something that could be
    // the node's value (`...nodeSx`, `...(rest.sx as object)`) is the merge.
    case 'ObjectExpression':
      return !value.properties.some(
        (property) =>
          property.type === 'SpreadElement' &&
          couldBeAuthorSx(property.argument),
      )
    // `sx={[{ p: 2 }]}` replaces just as thoroughly as the object form;
    // `sx={[{ p: 2 }, ...nodeSx]}` and `sx={[BASE, sx]}` are the fix.
    case 'ArrayExpression':
      return !couldBeAuthorSx(value)
    // Both branches have to be safe.
    case 'ConditionalExpression':
      return (
        replacesAuthorSx(value.consequent) || replacesAuthorSx(value.alternate)
      )
    case 'LogicalExpression':
      return replacesAuthorSx(value.right)
    // A variable, a call, a member read: the rule cannot see inside, and
    // guessing would be a false positive.
    default:
      return false
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "compose a node's own `sx` after spreading its props, never " +
        'replace it with a literal',
    },
    schema: [],
    messages: {
      sxAfterSpread:
        '`sx` written after `{{spread}}` REPLACES the author\'s styles — ' +
        'they are saved in the document and silently never render ' +
        '(AGL-1240/1284). Merge instead: `sx={[{ … }, ...nodeSx]}` with the ' +
        "node's value LAST.",
    },
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        let spread = null
        for (const attribute of node.attributes) {
          if (isPropsSpread(attribute)) {
            spread = attribute
            continue
          }
          if (
            !spread ||
            attribute.type !== 'JSXAttribute' ||
            attribute.name.type !== 'JSXIdentifier' ||
            attribute.name.name !== 'sx'
          ) {
            continue
          }
          const value = attribute.value
          if (!value || value.type !== 'JSXExpressionContainer') continue
          if (!replacesAuthorSx(value.expression)) continue
          context.report({
            node: attribute,
            messageId: 'sxAfterSpread',
            data: { spread: context.sourceCode.getText(spread) },
          })
        }
      },
    }
  },
}
