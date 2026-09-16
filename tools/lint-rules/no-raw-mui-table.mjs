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
 * ESLint rule: a MUI `Table` drawn outside the shared table components.
 *
 * A MUI `Card` clips what leaves it, and a table is at least as wide as its
 * widest unbreakable cell — an id, a date, a figure. A bare `Table` in a card
 * is therefore cut off at the card's edge at whatever width its content stops
 * fitting, and nothing on the page can reach the columns past it (AGL-3045:
 * the staff org page's AI card, with its "Started" column out of reach).
 *
 * The console has two answers, and this rule accepts only those:
 *
 *   - **A record list** — rows of jobs, people, orders, anything paged or
 *     sorted — is `ListTable` (or `DataTableComponent`), a grid that scrolls
 *     its own columns.
 *   - **Every other table** is `ScrollTable`
 *     (`@aglyn/shared-ui-jsx/components/scroll-table.component`), which puts
 *     the table in a box that scrolls sideways and fades while it does.
 *
 * `ScrollTable`'s own module is the one file that may render MUI's `Table`,
 * because it is where the box is put around it.
 *
 * ## What counts as a violation
 *
 * A USE of MUI's `Table` or `TableContainer` — a JSX element, `styled(Table)`,
 * a component handed on as a value, or a re-export — reached through any
 * import shape: the `@mui/material` barrel (named or aliased), a namespace
 * import (`<Mui.Table>`), or a `@mui/material/Table` subpath (default import,
 * `import()`, `require()`). `TableContainer` is on the list because a
 * hand-rolled scroll box beside the shared one is the drift this rule exists to
 * stop; `ScrollTable` takes `ContainerProps` for anything the box needs.
 *
 * `TableHead`, `TableBody`, `TableRow` and `TableCell` are NOT reported: they
 * are the rows and cells a `ScrollTable` holds.
 *
 * ## Honest limits
 *
 * False negatives, chosen so the rule never fires on correct code:
 *
 *   - **An import that is never used** is not reported. It draws nothing;
 *     `no-unused-vars` already says so.
 *   - **A type** (`TableProps`, `typeof Table` in a type position) draws
 *     nothing and is not reported.
 *   - **A property read off a dynamic import**
 *     (`import('@mui/material').then((m) => m.Table)`) is not modelled.
 *   - **A raw HTML `<table>`** is not a MUI `Table` and is not this rule's —
 *     an email template has to be built from them.
 *
 * ## No allowlist
 *
 * Nothing is excused. A table that must sit inside another table's cell (a
 * tree's subtree) is `ScrollTable` with `nested`, which draws no box of its
 * own; there is no table this rule refuses that has no place to go.
 */

/** The one module that may render MUI's `Table`: the box goes around it there. */
export const SCROLL_TABLE_MODULE =
  'libs/shared/ui/jsx/src/lib/components/scroll-table.component.tsx'

/** The components a raw table is drawn with. */
const TABLE_COMPONENTS = new Set(['Table', 'TableContainer'])

/** `@mui/material/Table` → `Table`; anything else → null. */
function subpathComponent(source) {
  const match = /^@mui\/material\/(Table|TableContainer)$/.exec(source ?? '')
  return match ? match[1] : null
}

/**
 * Whether a linted file is `repoPath`. Matched on a path-segment suffix
 * rather than against a computed root, so a worktree, a symlinked `/tmp` and
 * a relative RuleTester filename all answer the same way.
 */
function isRepoPath(filename, repoPath) {
  const normalized = String(filename ?? '').split('\\').join('/')
  return normalized === repoPath || normalized.endsWith(`/${repoPath}`)
}

/** The innermost variable named `name` visible from `scope`. */
function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name)
    if (variable) return variable
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'draw a table through ScrollTable or a record list through ListTable ' +
        '— a raw MUI Table is cut off by its card with no way to scroll to ' +
        'the rest',
    },
    schema: [],
    messages: {
      rawTable:
        'A raw MUI `{{component}}` is cut off by the card around it once its ' +
        'content is wider than the card, and nothing on the page can scroll ' +
        'to the columns past the edge (AGL-3045). A record list — rows of ' +
        'jobs, people, orders, anything paged or sorted — is `ListTable` ' +
        "('@aglyn/shared-ui-jsx/components/list-table.component'). Any other " +
        "table is `ScrollTable` ('@aglyn/shared-ui-jsx/components/" +
        "scroll-table.component'): same props as `Table`, plus " +
        '`ContainerProps` for its scroll box and `nested` for a table ' +
        "inside another table's cell.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.()
    if (isRepoPath(filename, SCROLL_TABLE_MODULE)) return {}

    const sourceCode = context.sourceCode ?? context.getSourceCode()

    /** Import bindings of a table component: variable → component name. */
    const bindings = new Map()
    /** Namespace imports of the barrel: `import * as Mui from '@mui/material'`. */
    const namespaces = new Set()
    const jsxOpenings = []
    const reported = new Set()

    const report = (node, component) => {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node, messageId: 'rawTable', data: { component } })
    }

    const bind = (specifier, component) => {
      for (const variable of sourceCode.getDeclaredVariables(specifier)) {
        bindings.set(variable, component)
      }
    }

    /** `Mui.Table` / `<Mui.Table>` → `Table` when `Mui` is a barrel namespace. */
    const namespaceMember = (object, property, scope) => {
      if (object?.type !== 'Identifier' && object?.type !== 'JSXIdentifier') {
        return null
      }
      if (!TABLE_COMPONENTS.has(property?.name)) return null
      const variable = findVariable(scope, object.name)
      return variable && namespaces.has(variable) ? property.name : null
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return
        const source = node.source?.value
        if (source === '@mui/material') {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportNamespaceSpecifier') {
              for (const variable of sourceCode.getDeclaredVariables(specifier)) {
                namespaces.add(variable)
              }
              continue
            }
            if (specifier.type !== 'ImportSpecifier') continue
            if (specifier.importKind === 'type') continue
            const imported = specifier.imported?.name ?? specifier.imported?.value
            if (TABLE_COMPONENTS.has(imported)) bind(specifier, imported)
          }
          return
        }
        const component = subpathComponent(source)
        if (!component) return
        for (const specifier of node.specifiers) {
          if (specifier.importKind === 'type') continue
          const imported =
            specifier.type === 'ImportSpecifier'
              ? (specifier.imported?.name ?? specifier.imported?.value)
              : null
          if (
            specifier.type === 'ImportDefaultSpecifier' ||
            imported === 'default'
          ) {
            bind(specifier, component)
          }
        }
      },

      // A re-export hands the raw component to a module this rule never sees
      // import it.
      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type') return
        const source = node.source?.value
        if (!source) return
        for (const specifier of node.specifiers ?? []) {
          if (specifier.exportKind === 'type') continue
          const local = specifier.local?.name ?? specifier.local?.value
          if (source === '@mui/material' && TABLE_COMPONENTS.has(local)) {
            report(specifier, local)
          } else if (subpathComponent(source) && local === 'default') {
            report(specifier, subpathComponent(source))
          }
        }
      },

      ExportAllDeclaration(node) {
        const component = subpathComponent(node.source?.value)
        if (component) report(node, component)
      },

      ImportExpression(node) {
        if (node.source?.type !== 'Literal') return
        const component = subpathComponent(node.source.value)
        if (component) report(node, component)
      },

      CallExpression(node) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'require') {
          return
        }
        const [first] = node.arguments
        if (first?.type !== 'Literal') return
        const component = subpathComponent(first.value)
        if (component) report(node, component)
      },

      JSXOpeningElement(node) {
        jsxOpenings.push(node)
      },

      MemberExpression(node) {
        if (node.computed) return
        const component = namespaceMember(
          node.object,
          node.property,
          sourceCode.getScope(node),
        )
        if (component) report(node, component)
      },

      'Program:exit'() {
        // JSX first, resolved by scope rather than read off the variable's
        // references: typescript-eslint records a JSX name as a reference
        // and espree does not, and the answer must not depend on the parser.
        for (const opening of jsxOpenings) {
          const name = opening.name
          const scope = sourceCode.getScope(opening)
          if (name.type === 'JSXIdentifier') {
            const variable = findVariable(scope, name.name)
            if (variable && bindings.has(variable)) {
              report(name, bindings.get(variable))
            }
          } else if (name.type === 'JSXMemberExpression') {
            const component = namespaceMember(name.object, name.property, scope)
            if (component) report(name, component)
          }
        }
        // Every other use: `styled(Table)`, `component: Table`, `const T = Table`.
        for (const [variable, component] of bindings) {
          for (const reference of variable.references) {
            const identifier = reference.identifier
            const parent = identifier.parent
            if (
              parent?.type === 'JSXOpeningElement' ||
              parent?.type === 'JSXClosingElement'
            ) {
              continue
            }
            if (reference.isTypeReference && !reference.isValueReference) continue
            if (parent?.type === 'TSTypeQuery') continue
            report(identifier, component)
          }
        }
      },
    }
  },
}
