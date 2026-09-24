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
 * AGL-3331: the faithful XML DOM under the XMP editor.
 *
 * The load-bearing property is `serializeXml(parseXml(s)) === s`. Every
 * byte an XMP edit did not mean to change — a quote style, an indent, an
 * `&#xA;` in an attribute — is carried by this round trip, so the corpus
 * below is deliberately full of the spellings a normalizing DOM rewrites.
 */

import {
  attributeNamespace,
  createElement,
  createText,
  createWhitespace,
  decodeXmlText,
  elementChildren,
  elementNamespace,
  escapeXmlAttribute,
  escapeXmlText,
  getAttribute,
  hasNonXmlCharacters,
  insertChildren,
  parseXml,
  prefixForNamespace,
  removeAttribute,
  removeChild,
  resolvePrefix,
  serializeXml,
  setAttribute,
  setTextContent,
  splitQName,
  textContent,
  walkElements,
  XML_MAX_DEPTH,
  XML_NAMESPACE,
  type XmlDocument,
  type XmlElement,
} from './xml'

function parsed(input: string): XmlDocument {
  const doc = parseXml(input)
  if (!doc) throw new Error(`did not parse: ${input.slice(0, 80)}`)
  return doc
}

function root(doc: XmlDocument): XmlElement {
  const element = elementChildren(doc)[0]
  if (!element) throw new Error('no root element')
  return element
}

function find(doc: XmlDocument, name: string): XmlElement {
  let found: XmlElement | undefined
  walkElements(doc, (element) => {
    if (!found && element.name === name) found = element
  })
  if (!found) throw new Error(`no <${name}>`)
  return found
}

/** A deterministic PRNG, so a fuzz failure reproduces. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const CORPUS: Record<string, string> = {
  xpacket:
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140 79.160451, 2017/05/06-01:08:21        ">\n' +
    '   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '      <rdf:Description rdf:about=""\n' +
    '            xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '         <dc:format>image/jpeg</dc:format>\n' +
    '      </rdf:Description>\n' +
    '   </rdf:RDF>\n' +
    '</x:xmpmeta>\n' +
    '                                                                    \n' +
    '<?xpacket end="w"?>',
  quoteStyles: `<a one='single' two="double" three='has "double" inside' four="has 'single' inside"/>`,
  spacedTags: '<a  b = "1"\n\tc=\'2\'   >text</a   >',
  selfClosingVariants: '<r><a/><b /><c\n/><d></d></r>',
  entitiesInText:
    '<r>&lt;tag&gt; &amp; &quot;q&quot; &apos;a&apos; &#65;&#x42;&#x1F600; ]]&gt;</r>',
  entitiesInAttributes:
    '<r a="&lt;&amp;&gt;&quot;" b=\'&apos;\' c="line&#xA;break&#10;tab&#9;" d="  spaced  "/>',
  cdata: '<r><![CDATA[<not a tag> & not an entity]]>after</r>',
  comments:
    '<!-- lead --><r><!-- inside -- still a comment? --><x/></r><!-- tail -->',
  processingInstructions:
    '<?xml version="1.0" encoding="UTF-8"?><?pi?><r><?inner data here?></r>',
  crlf: '<r>\r\n  <a>one\r\ntwo</a>\r\n</r>\r\n',
  mixedContent: '<p>Hello <b>bold</b> and <i>italic</i> text.</p>',
  unicode: '<r é="ü">日本語 — “quotes” 😀</r>',
  trailingPadding: '<r/>' + ' '.repeat(200) + '\n\u0000\u0000',
  multipleRoots: '<a/>\n<b>two</b>\n<c/>',
  bomFirst: '\uFEFF<r/>',
}

describe('parseXml / serializeXml round trip', () => {
  it.each(Object.entries(CORPUS))(
    '%s serializes back byte for byte',
    (_, input) => {
      expect(serializeXml(parsed(input))).toBe(input)
    },
  )

  it('round-trips a large, realistic packet with thousands of nodes', () => {
    const items = Array.from(
      { length: 2000 },
      (_, i) => `     <rdf:li>keyword ${i} &amp; more</rdf:li>`,
    ).join('\n')
    const input = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n <rdf:Bag>\n${items}\n </rdf:Bag>\n</rdf:RDF>`
    expect(serializeXml(parsed(input))).toBe(input)
  })
})

describe('decoding', () => {
  it('decodes the five predefined entities and character references in text', () => {
    const doc = parsed(CORPUS['entitiesInText'] ?? '')
    expect(textContent(root(doc))).toBe(`<tag> & "q" 'a' AB\u{1F600} ]]>`)
  })

  it('keeps the raw spelling next to the decoded value', () => {
    const text = root(parsed('<r>a &#x26; b</r>')).children[0]
    expect(text).toEqual({ type: 'text', value: 'a & b', raw: 'a &#x26; b' })
  })

  it('normalizes attribute values the way XML 1.0 §3.3.3 does', () => {
    const r = root(parsed(CORPUS['entitiesInAttributes'] ?? ''))
    expect(getAttribute(r, 'a')?.value).toBe('<&>"')
    expect(getAttribute(r, 'b')?.value).toBe("'")
    // References survive normalization; literal whitespace does not.
    expect(getAttribute(r, 'c')?.value).toBe('line\nbreak\ntab\t')
    expect(getAttribute(r, 'd')?.value).toBe('  spaced  ')
    const literal = root(parsed('<r a="one\ntwo\tthree\r\nfour"/>'))
    expect(getAttribute(literal, 'a')?.value).toBe('one two three four')
  })

  it('normalizes line ends in text (XML 1.0 §2.11)', () => {
    const doc = parsed(CORPUS['crlf'] ?? '')
    expect(textContent(find(doc, 'a'))).toBe('one\ntwo')
  })

  it('reads CDATA verbatim', () => {
    expect(textContent(root(parsed(CORPUS['cdata'] ?? '')))).toBe(
      '<not a tag> & not an entityafter',
    )
  })

  it('decodeXmlText refuses what a conforming parser refuses', () => {
    expect(decodeXmlText('a &amp; b')).toBe('a & b')
    expect(decodeXmlText('&nbsp;')).toBeNull()
    expect(decodeXmlText('a & b')).toBeNull()
    expect(decodeXmlText('&#0;')).toBeNull()
    expect(decodeXmlText('&#xD800;')).toBeNull()
    expect(decodeXmlText('&#x110000;')).toBeNull()
    expect(decodeXmlText('&#xZZ;')).toBeNull()
    expect(decodeXmlText('&#;')).toBeNull()
    expect(decodeXmlText('&amp')).toBeNull()
  })
})

describe('escaping', () => {
  it('escapes text so it reads back unchanged', () => {
    const value = `a < b > c & d ]]> "e" 'f'\r\n`
    const raw = escapeXmlText(value)
    expect(raw).not.toMatch(/[<]|]]>/)
    expect(decodeXmlText(raw)).toBe(value)
  })

  it('escapes attributes for either quote, whitespace included', () => {
    const value = `tab\there "double" 'single' <&>\nline\r`
    for (const quote of ['"', "'"] as const) {
      const raw = escapeXmlAttribute(value, quote)
      expect(raw.includes(quote)).toBe(false)
      expect(decodeXmlText(raw, true)).toBe(value)
      const doc = parsed(`<r a=${quote}${raw}${quote}/>`)
      expect(getAttribute(root(doc), 'a')?.value).toBe(value)
    }
  })

  it('knows which characters XML cannot hold at all', () => {
    expect(hasNonXmlCharacters('plain text, tabs\tand\nnewlines 😀')).toBe(
      false,
    )
    expect(hasNonXmlCharacters('bell\u0007')).toBe(true)
    expect(hasNonXmlCharacters('nul\u0000')).toBe(true)
    expect(hasNonXmlCharacters('\uFFFE')).toBe(true)
    expect(hasNonXmlCharacters('lone \uD800 surrogate')).toBe(true)
    expect(hasNonXmlCharacters('trailing high \uD83D')).toBe(true)
  })
})

describe('what parseXml refuses (returns null, never throws)', () => {
  const refused: Record<string, string> = {
    doctype: '<!DOCTYPE r><r/>',
    entityDeclaration:
      '<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><r>&b;</r>',
    externalEntity:
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>',
    doctypeInsideContent: '<r><!DOCTYPE r></r>',
    elementDeclaration: '<r><!ELEMENT r ANY></r>',
    undeclaredEntity: '<r>&nbsp;</r>',
    bareAmpersand: '<r>fish & chips</r>',
    bareAmpersandInAttribute: '<r a="fish & chips"/>',
    ltInAttribute: '<r a="a<b"/>',
    unterminatedTag: '<r><a>',
    unterminatedStartTag: '<r a="1"',
    unterminatedAttribute: '<r a="1/>',
    unterminatedComment: '<r><!-- never closed </r>',
    unterminatedCdata: '<r><![CDATA[ never closed </r>',
    unterminatedPi: '<?xpacket begin="" <r/>',
    mismatchedClose: '<r><a></b></r>',
    strayClose: '</r>',
    duplicateAttribute: '<r a="1" a="2"/>',
    missingSpaceBetweenAttributes: '<r a="1"b="2"/>',
    unquotedAttribute: '<r a=1/>',
    attributeWithoutValue: '<r checked/>',
    badName: '<1r/>',
    cdataOutsideRoot: '<![CDATA[x]]><r/>',
    piWithoutSpace: '<?pi"data"?><r/>',
    badCharRef: '<r>&#1;</r>',
  }

  it.each(Object.entries(refused))('%s', (_, input) => {
    expect(() => parseXml(input)).not.toThrow()
    expect(parseXml(input)).toBeNull()
  })

  it('refuses nesting deeper than the bound, without recursion', () => {
    const ok = '<a>'.repeat(XML_MAX_DEPTH) + '</a>'.repeat(XML_MAX_DEPTH)
    expect(parseXml(ok)).not.toBeNull()
    const deep =
      '<a>'.repeat(XML_MAX_DEPTH + 1) + '</a>'.repeat(XML_MAX_DEPTH + 1)
    expect(parseXml(deep)).toBeNull()
    const hostile = '<a>'.repeat(200_000)
    expect(() => parseXml(hostile)).not.toThrow()
    expect(parseXml(hostile)).toBeNull()
    expect(parseXml('<a><b><c/></b></a>', { maxDepth: 2 })).toBeNull()
  })

  it('refuses a huge attribute count', () => {
    const attrs = Array.from({ length: 60_000 }, (_, i) => ` a${i}="x"`).join(
      '',
    )
    expect(parseXml(`<r${attrs}/>`)).toBeNull()
    expect(parseXml('<r a="1" b="2" c="3"/>', { maxNodes: 3 })).toBeNull()
    expect(parseXml('<r a="1" b="2"/>', { maxNodes: 3 })).not.toBeNull()
  })

  it('refuses a huge node count and an over-long input', () => {
    expect(parseXml(`<r>${'<a/>'.repeat(60_000)}</r>`)).toBeNull()
    expect(parseXml('<r>0123456789</r>', { maxLength: 10 })).toBeNull()
  })

  it('does not throw on a non-string', () => {
    expect(parseXml(undefined as unknown as string)).toBeNull()
    expect(parseXml(42 as unknown as string)).toBeNull()
  })

  it('never throws on truncations or corruptions of a real document', () => {
    const input = CORPUS['xpacket'] ?? ''
    for (let end = 0; end <= input.length; end++) {
      const doc = parseXml(input.slice(0, end))
      if (doc) expect(serializeXml(doc)).toBe(input.slice(0, end))
    }
    const random = prng(3331)
    const alphabet = '<>/="\'&;!?[]-# \nax:'
    for (let round = 0; round < 3000; round++) {
      const chars = [...input]
      const edits = 1 + Math.floor(random() * 4)
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(random() * chars.length)
        const ch = alphabet[Math.floor(random() * alphabet.length)] ?? '<'
        chars.splice(at, random() < 0.5 ? 1 : 0, ch)
      }
      const mutated = chars.join('')
      let doc: XmlDocument | null = null
      expect(() => {
        doc = parseXml(mutated)
      }).not.toThrow()
      if (doc) expect(serializeXml(doc)).toBe(mutated)
    }
  })
})

describe('namespaces', () => {
  const input =
    '<a:root xmlns:a="urn:a" xmlns="urn:default" xmlns:s="urn:shadowed-outer">' +
    '<child a:attr="1" plain="2"/>' +
    '<s:inner xmlns:s="urn:shadowed-inner"><s:leaf/></s:inner>' +
    '<undeclared:x/>' +
    '<reset xmlns=""><bare/></reset>' +
    '</a:root>'
  const doc = parsed(input)

  it('resolves a prefix through ancestor declarations', () => {
    const child = find(doc, 'child')
    expect(resolvePrefix(child, 'a')).toBe('urn:a')
    expect(elementNamespace(root(doc))).toBe('urn:a')
    expect(elementNamespace(child)).toBe('urn:default')
    expect(resolvePrefix(child, 'xml')).toBe(XML_NAMESPACE)
  })

  it('lets a nearer declaration shadow a farther one', () => {
    expect(elementNamespace(find(doc, 's:leaf'))).toBe('urn:shadowed-inner')
    expect(
      prefixForNamespace(find(doc, 's:leaf'), 'urn:shadowed-outer'),
    ).toBeNull()
    expect(prefixForNamespace(find(doc, 'child'), 'urn:shadowed-outer')).toBe(
      's',
    )
  })

  it('never puts an unprefixed attribute in the default namespace', () => {
    const child = find(doc, 'child')
    const [prefixed, plain] = child.attributes
    expect(prefixed && attributeNamespace(child, prefixed)).toBe('urn:a')
    expect(plain && attributeNamespace(child, plain)).toBeNull()
  })

  it('returns null for an undeclared prefix and an undeclared default', () => {
    expect(elementNamespace(find(doc, 'undeclared:x'))).toBeNull()
    expect(elementNamespace(find(doc, 'bare'))).toBeNull()
  })

  it('splits qualified names', () => {
    expect(splitQName('dc:title')).toEqual({ prefix: 'dc', local: 'title' })
    expect(splitQName('title')).toEqual({ prefix: '', local: 'title' })
  })
})

describe('mutation keeps raw and value in step', () => {
  it('updates an attribute in place, keeping its quote and whitespace', () => {
    const doc = parsed(`<r\n  a='1'\n  b="2"/>`)
    const r = root(doc)
    setAttribute(r, 'a', `it's <new>`)
    expect(serializeXml(doc)).toBe(`<r\n  a='it&apos;s &lt;new&gt;'\n  b="2"/>`)
    setAttribute(r, 'c', 'three', { leading: '\n  ', index: 1 })
    removeAttribute(r, 'b')
    expect(serializeXml(doc)).toBe(
      `<r\n  a='it&apos;s &lt;new&gt;'\n  c="three"/>`,
    )
    expect(getAttribute(root(parsed(serializeXml(doc))), 'a')?.value).toBe(
      `it's <new>`,
    )
  })

  it('opens a self-closed element when it gains content', () => {
    const doc = parsed('<r><a/></r>')
    const a = find(doc, 'a')
    setTextContent(a, 'x & y')
    expect(serializeXml(doc)).toBe('<r><a>x &amp; y</a></r>')
    setTextContent(a, '')
    expect(serializeXml(doc)).toBe('<r><a></a></r>')
  })

  it('builds, inserts and removes elements with parent links', () => {
    const doc = parsed('<r>\r\n</r>')
    const r = root(doc)
    const made = createElement(
      'n:item',
      [['xml:lang', 'x-default']],
      [createText('a < b')],
    )
    insertChildren(r, 0, [createWhitespace('\r\n  '), made])
    expect(made.parent).toBe(r)
    expect(serializeXml(doc)).toBe(
      '<r>\r\n  <n:item xml:lang="x-default">a &lt; b</n:item>\r\n</r>',
    )
    expect(removeChild(r, made)).toBe(true)
    expect(made.parent).toBeNull()
    expect(removeChild(r, made)).toBe(false)
  })

  it('writes indentation verbatim and drops anything that is not whitespace', () => {
    expect(createWhitespace('\r\n\t ').raw).toBe('\r\n\t ')
    expect(createWhitespace('\r\n\t ').value).toBe('\n\t ')
    expect(createWhitespace(' x ').raw).toBe('  ')
  })

  it('serializes an edited document that parses back to the same values', () => {
    const doc = parsed(CORPUS['xpacket'] ?? '')
    setTextContent(find(doc, 'dc:format'), 'image/png & <more>')
    const again = parsed(serializeXml(doc))
    expect(textContent(find(again, 'dc:format'))).toBe('image/png & <more>')
  })
})
