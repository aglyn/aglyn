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

import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import * as ts from 'typescript'

/**
 * EVERY ELEMENT ATTRIBUTE EXPLAINS ITSELF, IN ITS OWN WORDS (AGL-2486).
 *
 * The attributes panel is where a site is actually authored, and its fields
 * are named in one or two words — `Variant`, `Gutters`, `Align`. A label that
 * short can only be a reminder; the tooltip is the explanation, and a field
 * without one is a control an author has to discover by trying it on a
 * published page.
 *
 * The sweep that produced this guard found 24 fields with no help at all
 * (fourteen of the email blocks, seven `Show …` switches, three site-settings
 * fields) and ten tooltips SHARED across different fields. Sharing is the
 * subtler failure: three separate elements said "The variant to use." — true
 * of all three, useful on none, and identical text on two different fields
 * reads as a copy-paste an author cannot trust. The pairs were worse where
 * the two fields genuinely differ: sign-in's "After sign-in" and sign-up's
 * "After sign-up" carried one sentence about a `continue` param and said
 * nothing about the different moments they fire at.
 *
 * Both halves are asserted, because either alone leaves the other open: text
 * can be present and duplicated, or unique and absent.
 *
 * WHAT COUNTS AS HELP: a `description` (the tooltip the panel renders) or a
 * `help` object — the besigner's animation fields build theirs by spreading a
 * `help()` helper, and the console's forms point at a docs anchor with
 * `docsHelp()`. All three are an explanation; only nothing is not.
 *
 * The uniqueness half reads only text this file can resolve statically — a
 * plain literal or a `'a ' + 'b'` concatenation. A description built from a
 * template (`${label} profile URL`) or held in a shared constant is one
 * sentence PER FIELD by construction, and reading it would mean evaluating
 * the module.
 */

const REPO_ROOT = join(__dirname, '../../..')

/** The bundles an author actually drops elements from. */
const SCAN_ROOTS = ['libs/plugins']

/**
 * Fields exempted from the unique-text rule, with the reason. Empty, and the
 * intent is that it stays that way: two fields that genuinely need the same
 * sentence are usually two fields whose difference has not been written down
 * yet.
 */
const SHARED_TEXT_EXCEPTIONS: ReadonlyMap<string, string> = new Map()

interface Attribute {
  file: string
  line: number
  name: string
  description?: string
  hasHelp: boolean
}

const sourceFiles = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, found)
    else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
      found.push(full)
    }
  }
  return found
}

/** String literals and the `'a ' + 'b'` concatenations the repo wraps with. */
const literal = (node: ts.Node | undefined): string | undefined => {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = literal(node.left)
    const right = literal(node.right)
    if (left !== undefined && right !== undefined) return left + right
  }
  return undefined
}

const collectAttributes = (): Attribute[] => {
  const attributes: Attribute[] = []
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFiles(join(REPO_ROOT, root))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      )
      const visit = (node: ts.Node) => {
        if (ts.isObjectLiteralExpression(node)) {
          const props = new Map<string, ts.Expression>()
          let spreadsHelp = false
          for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) {
              // `...help('Animation', '…')` — the besigner's field builder.
              if (/\bhelp\s*\(/.test(property.getText(source))) {
                spreadsHelp = true
              }
              continue
            }
            if (!ts.isPropertyAssignment(property) || !property.name) continue
            props.set(
              property.name.getText(source).replace(/['"]/g, ''),
              property.initializer,
            )
          }
          const fieldType = props.get('component')
          // A schema attribute: a `name` beside a FieldComponentType.
          if (
            props.has('name') &&
            fieldType &&
            /FieldComponentType/.test(fieldType.getText(source))
          ) {
            attributes.push({
              file: relative(REPO_ROOT, file),
              line:
                source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              name:
                literal(props.get('name')) ??
                props.get('name')!.getText(source),
              description: literal(props.get('description')),
              hasHelp:
                spreadsHelp || props.has('help') || props.has('description'),
            })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  return attributes
}

describe('every element attribute carries its own help (AGL-2486)', () => {
  const attributes = collectAttributes()

  it('finds the attributes at all, so a pass is not vacuous', () => {
    // A parser change that stopped matching would otherwise report a clean
    // sweep of nothing.
    expect(attributes.length).toBeGreaterThan(250)
  })

  it('leaves no field without a tooltip', () => {
    const bare = attributes.filter(
      (attribute) => !attribute.description?.trim() && !attribute.hasHelp,
    )
    if (bare.length > 0) {
      throw new Error(
        'These element attributes render a field with no explanation. Add a ' +
          '`description` (or a `help`), saying what the field does and what ' +
          'leaving it blank means:\n\n  ' +
          bare
            .map((a) => `${a.file}:${a.line}  ${a.name}`)
            .join('\n  '),
      )
    }
  })

  it('gives each field its own words', () => {
    const byText = new Map<string, Attribute[]>()
    for (const attribute of attributes) {
      const text = attribute.description?.trim()
      if (!text || SHARED_TEXT_EXCEPTIONS.has(text)) continue
      byText.set(text, [...(byText.get(text) ?? []), attribute])
    }
    const shared = [...byText.entries()].filter(([, list]) => list.length > 1)
    if (shared.length > 0) {
      throw new Error(
        'These tooltips are shared by more than one field. A sentence true ' +
          'of two fields rarely explains either — say what THIS field does, ' +
          'or add the text to SHARED_TEXT_EXCEPTIONS with a reason:\n\n' +
          shared
            .map(
              ([text, list]) =>
                `  "${text.slice(0, 70)}"\n` +
                list
                  .map((a) => `      ${a.file}:${a.line}  ${a.name}`)
                  .join('\n'),
            )
            .join('\n'),
      )
    }
  })
})
