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

import {
  aiHasPlaceholderToken,
  aiIsOnlyPlaceholders,
  aiPlaceholderTokens,
  type AiPlaceholderKind,
} from './ai-placeholder-tokens'

/*
 * What a template placeholder is in copy, and what is real copy that only
 * looks like one (AGL-3827). A live About page shipped `{{1}}` and `{{2}}` as
 * its testimonials' quote and name.
 */

const found = (text: string, options = {}) =>
  aiPlaceholderTokens(text, options).map(({ kind, token }) => [kind, token] as [AiPlaceholderKind, string])

describe('a placeholder in copy', () => {
  it.each<[string, string, Array<[AiPlaceholderKind, string]>]>([
    // A repeated item's slots, left where no "repeat" fills them.
    ['a slot', '{{1}}', [['repeat-slot', '{{1}}']]],
    ['a slot with spaces', '“{{ 2 }}” — {{3}}', [['repeat-slot', '{{ 2 }}'], ['repeat-slot', '{{3}}']]],
    ['a slot in Arabic copy', 'قال عميلنا: {{1}}', [['repeat-slot', '{{1}}']]],
    // Double braces that bind nothing the platform fills.
    ['a bare name', 'Thanks, {{name}}!', [['template-token', '{{name}}']]],
    ['words in braces', '{{Customer name}}', [['template-token', '{{Customer name}}']]],
    ['a Spanish greeting', '¡Hola, {{nombre}}! Gracias por elegirnos.', [['template-token', '{{nombre}}']]],
    ['a Chinese name slot', '客户：{{客户名称}}', [['template-token', '{{客户名称}}']]],
    ['empty braces', 'Call {{}} today', [['template-token', '{{}}']]],
    // A template's slot in another syntax.
    ['a French wiki slot', '« [[Nom du client]] »', [['double-bracket', '[[Nom du client]]']]],
    ['a German wiki slot', '[[Zitat des Kunden]]', [['double-bracket', '[[Zitat des Kunden]]']]],
    ['a template literal', 'Welcome to ${businessName}', [['template-literal', '${businessName}']]],
    // Words in angle brackets that are no tag.
    ['an English angle slot', '<Your business name> has served Harbor County since 1998.', [['angle-slot', '<Your business name>']]],
    ['a German angle slot', '<Ihr Firmenname> seit 1998', [['angle-slot', '<Ihr Firmenname>']]],
    ['a Spanish angle slot', 'Escrito por <Nombre del cliente>', [['angle-slot', '<Nombre del cliente>']]],
    ['one slot word', 'Quote: <placeholder>', [['angle-slot', '<placeholder>']]],
    ['one "your" word', 'Hi <yourname>', [['angle-slot', '<yourname>']]],
    ['several at once', '{{1}} by <Your name> [[City]]', [
      ['repeat-slot', '{{1}}'],
      ['angle-slot', '<Your name>'],
      ['double-bracket', '[[City]]'],
    ]],
  ])('%s: %j', (_name, text, expected) => {
    expect(found(text)).toEqual(expected)
    expect(aiHasPlaceholderToken(text)).toBe(true)
  })
})

describe('real copy that only looks like a placeholder', () => {
  it.each<[string, string]>([
    // A fact the brief never gave is the honest marker rule 14 asks for, and each draft's note lists it (AGL-3056).
    ['a bracketed fact', 'Call [Office phone number] to book.'],
    ['a bracketed name', '[Customer name], Harbor Point'],
    ['a bracketed fact in Spanish', 'Llámenos al [número de teléfono].'],
    ['an editorial mark', 'They said it was “the best roof we ever had [sic].”'],
    ['a Markdown link', 'See [our menu](/menu) for prices.'],
    ['a price', 'Inspections from $149, or $1,200 for a full repair.'],
    ['a percentage', 'Save 15% on gutter guards.'],
    ['a plan letter', 'Plan A or Plan B'],
    ['a comparison', 'Jobs under 2 hours < 1 visit > 0 surprises'],
    ['a heart', 'We <3 our customers'],
    ['a key name', 'Press <Enter> to search.'],
    ['a type name in code-free copy', 'Lists of <String> values'],
    ['inline markup', 'Our <strong>same-week</strong> promise<br>'],
    ['a tag with words', '<a href>link</a>'],
    ['single braces', 'Sizes {S, M, L} in stock'],
    ['Japanese brackets', '「お客様の声」をご覧ください'],
    ['French quotes', '« Un travail impeccable » — Claire, Lyon'],
    // The platform's own bindings are left to the checks that own them.
    ['a record binding', '{{item.title}}'],
    ['a post binding', '{{entry.date}} · {{entry.author}}'],
    ['a component prop binding', '{{prop.heading}}'],
    ['a product binding', '{{product.name}} from {{product.price}}'],
    ['a recipient merge token', 'Hi {{contact.firstName}},'],
    ['a variable id token', 'Open {{var:abc123}}'],
    ['a function token', 'Today is {{fn:formatDate(now)}}'],
    // Lorem ipsum is rule 14's `filler-copy`, and never reported twice.
    ['lorem ipsum', 'Lorem ipsum dolor sit amet.'],
    ['an empty string', ''],
  ])('%s: %j', (_name, text) => {
    expect(found(text)).toEqual([])
    expect(aiHasPlaceholderToken(text)).toBe(false)
  })

  it('reads markup as markup, and leaves an email its own merge tokens', () => {
    expect(found('<div class="note">Hi</div><Your name>', { markup: true })).toEqual([])
    expect(found('<Your name>', { markup: false })).toEqual([['angle-slot', '<Your name>']])
    expect(found('Welcome, {{firstName}}!', { mergeTokens: true })).toEqual([])
    // A slot is a slot in an email too: no merge token is a number.
    expect(found('Welcome, {{1}}!', { mergeTokens: true })).toEqual([['repeat-slot', '{{1}}']])
    expect(found('Welcome, {{first name}}!', { mergeTokens: true })).toEqual([['template-token', '{{first name}}']])
  })
})

describe('copy that is only placeholders', () => {
  it.each<[string, boolean]>([
    ['{{1}}', true],
    [' {{2}} ', true],
    ['“{{1}}” — {{2}}', true],
    ['[[Customer quote]]', true],
    ['<Your name>', true],
    ['Thanks, {{name}}!', false],
    ['Dana, {{2}}', false],
    ['{{1}} years on Harbor County roofs', false],
    ['Real words', false],
    ['{{item.title}}', false],
    ['', false],
  ])('%j → %s', (text, only) => {
    expect(aiIsOnlyPlaceholders(text)).toBe(only)
  })
})
