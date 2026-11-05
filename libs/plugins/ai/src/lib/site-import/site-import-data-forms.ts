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

/*==========================================
 * A FORM DEFINED IN DATA (AGL-4152).
 *
 * Plenty of site builders and widgets draw a form in the browser: the page
 * they serve has no `<form>`, only an empty box and the form's fields as data,
 * in a script block, a `data-*` attribute or a line of inline JavaScript. The
 * words a visitor would type into are then nowhere in the markup, and the page
 * comes in without its form.
 *
 * So on a page with no `<form>` of its own (a search box does not count), an
 * array of objects that each carry a `type` a form field has, a `title` or
 * `label` and a `required` is a form's fields, and it becomes a `SiteImportForm`
 * placed in the nearest element whose class says it is a form. No such element
 * and no form: an array like it with nowhere to go is some other thing's data.
 * The same array in two places is one form, and one that asks for a password
 * or a card is left out, as a `<form>` that does is.
 *
 * Nothing here runs anything a page wrote: `readLiteral` reads text as data,
 * and stops at the first thing that is not data.
 *=========================================*/

import type { SiteImportForm, SiteImportFormField } from './site-import-html'

/** The most of one script or attribute read for a form's fields. */
const MAX_SOURCE_CHARS = 1_000_000
/** The most arrays one source is tried at: a bundle holds thousands, and none of them is worth a slow read. */
const MAX_TRIES = 300
/** The most values one array read may hold. */
const MAX_VALUES = 20_000
const MAX_DEPTH = 12

/** A `type` as a form's field says it, lowered and its separators dropped, as the field it is. */
const FIELD_TYPES: ReadonlyMap<string, string> = new Map([
  ...['text', 'input', 'string', 'name', 'fullname', 'firstname', 'lastname', 'company', 'subject', 'address', 'singleline', 'shorttext', 'shortanswer', 'password', 'creditcard'].map((type): [string, string] => [type, 'text']),
  ...['email', 'emailaddress'].map((type): [string, string] => [type, 'email']),
  ...['tel', 'phone', 'telephone', 'phonenumber', 'mobile'].map((type): [string, string] => [type, 'tel']),
  ...['url', 'website'].map((type): [string, string] => [type, 'url']),
  ...['number', 'numeric', 'integer'].map((type): [string, string] => [type, 'number']),
  ...['date', 'datepicker'].map((type): [string, string] => [type, 'date']),
  ...['time', 'timepicker'].map((type): [string, string] => [type, 'time']),
  ...['textarea', 'message', 'multiline', 'longtext', 'longanswer', 'paragraph', 'comment', 'comments'].map((type): [string, string] => [type, 'textarea']),
  ...['select', 'dropdown'].map((type): [string, string] => [type, 'select']),
  ...['radio', 'radios', 'radiogroup', 'singlechoice'].map((type): [string, string] => [type, 'radio']),
  ...['checkbox', 'checkboxes', 'checkboxgroup', 'multiplechoice', 'consent'].map((type): [string, string] => [type, 'checkbox']),
])
/** Types a form holds that ask nothing a visitor reads as a question. */
const NO_QUESTION = /^(?:hidden|captcha|recaptcha|honeypot|submit|button|reset|section|heading|divider|html|separator|spacer|pagebreak)$/
const FILE_TYPES = /^(?:file|fileupload|upload|attachment|image)$/
const REFUSED_FIELD = /password|passcode|credit.?card|card.?(?:num|cvc|cvv|exp)|cc.?(?:num|number|exp|csc|cvv|cvc)|cvc|cvv|iban|routing|payment/i

type Fields = Array<Record<string, unknown>>

/*------------------------------------------
 * Reading text as data
 *-----------------------------------------*/

const FAILED = Symbol('not data')

/**
 * The array or object a text holds at `start`, and where it ends: JSON, and
 * the looser literal a person writes by hand (bare keys, single quotes, a
 * trailing comma, a comment). `null` at the first thing that is no literal.
 */
function readLiteral(text: string, start: number): { value: unknown; end: number } | null {
  let at = start
  let values = 0
  const space = () => {
    for (;;) {
      const char = text[at]
      if (char === ' ' || char === '\n' || char === '\t' || char === '\r') at += 1
      else if (char === '/' && text[at + 1] === '/') at = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at)
      else if (char === '/' && text[at + 1] === '*') at = text.indexOf('*/', at) < 0 ? text.length : text.indexOf('*/', at) + 2
      else return
    }
  }
  const string = (quote: string): string | typeof FAILED => {
    let out = ''
    at += 1
    while (at < text.length) {
      const char = text[at] as string
      if (char === quote) {
        at += 1
        return out
      }
      if (char === '\n') return FAILED
      if (char === '\\') {
        const next = text[at + 1]
        if (next === 'u' && /^[0-9a-f]{4}$/i.test(text.slice(at + 2, at + 6))) {
          out += String.fromCharCode(parseInt(text.slice(at + 2, at + 6), 16))
          at += 6
          continue
        }
        out += next === 'n' ? '\n' : next === 't' ? ' ' : next === 'r' ? '' : (next ?? '')
        at += 2
        continue
      }
      out += char
      at += 1
    }
    return FAILED
  }
  const value = (depth: number): unknown => {
    values += 1
    if (values > MAX_VALUES || depth > MAX_DEPTH) return FAILED
    space()
    const char = text[at]
    if (char === '"' || char === "'") return string(char)
    if (char === '[') {
      at += 1
      const list: unknown[] = []
      for (;;) {
        space()
        if (text[at] === ']') {
          at += 1
          return list
        }
        const item = value(depth + 1)
        if (item === FAILED) return FAILED
        list.push(item)
        space()
        if (text[at] === ',') at += 1
        else if (text[at] !== ']') return FAILED
      }
    }
    if (char === '{') {
      at += 1
      const object: Record<string, unknown> = {}
      for (;;) {
        space()
        if (text[at] === '}') {
          at += 1
          return object
        }
        const quote = text[at]
        let key: string | typeof FAILED
        if (quote === '"' || quote === "'") key = string(quote)
        else {
          const bare = /^[A-Za-z_$][\w$]*/.exec(text.slice(at, at + 64))
          key = bare ? bare[0] : FAILED
          if (bare) at += bare[0].length
        }
        if (key === FAILED) return FAILED
        space()
        if (text[at] !== ':') return FAILED
        at += 1
        const item = value(depth + 1)
        if (item === FAILED) return FAILED
        if (key !== '__proto__') object[key as string] = item
        space()
        if (text[at] === ',') at += 1
        else if (text[at] !== '}') return FAILED
      }
    }
    const word = /^(?:true|false|null|undefined|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(text.slice(at, at + 40))
    if (!word) return FAILED
    at += word[0].length
    if (/^(?:true|false)$/i.test(word[0])) return word[0].toLowerCase() === 'true'
    if (/^(?:null|undefined)$/i.test(word[0])) return null
    return Number(word[0])
  }
  const read = value(0)
  return read === FAILED ? null : { value: read, end: at }
}

/*------------------------------------------
 * Which arrays are a form's fields
 *-----------------------------------------*/

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const typeKey = (value: unknown) => (typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]+/g, '') : '')
const labelOf = (entry: Record<string, unknown>) => (typeof entry['title'] === 'string' ? entry['title'] : typeof entry['label'] === 'string' ? entry['label'] : '')
const isField = (entry: Record<string, unknown>) => typeKey(entry['type']) !== '' && labelOf(entry).trim() !== '' && 'required' in entry
const asksQuestion = (entry: Record<string, unknown>) => FIELD_TYPES.has(typeKey(entry['type']))

/** Whether an array is a form's fields: objects, most of them fields, at least half of what is typed a kind of question a form asks. */
function isFieldArray(value: unknown): value is Fields {
  if (!Array.isArray(value) || !value.length || !value.every(isObject)) return false
  const fields = (value as Fields).filter(isField)
  if (fields.length * 2 < value.length) return false
  return fields.filter(asksQuestion).length * 2 >= fields.length && fields.some(asksQuestion)
}

/** The arrays a value read holds that are a form's fields, outermost first. */
function fieldArraysIn(value: unknown, depth = 0): Fields[] {
  if (depth > MAX_DEPTH) return []
  if (isFieldArray(value)) return [value]
  if (Array.isArray(value)) return value.flatMap((item) => fieldArraysIn(item, depth + 1))
  if (isObject(value)) return Object.values(value).flatMap((item) => fieldArraysIn(item, depth + 1))
  return []
}

/** The field arrays a text holds, each with where it was found. */
function fieldArraysOfText(text: string): Array<{ fields: Fields; at: number; end: number }> {
  const source = text.length > MAX_SOURCE_CHARS ? text.slice(0, MAX_SOURCE_CHARS) : text
  if (!/\brequired\b/.test(source) || !/\btype\b/.test(source) || !/\b(?:title|label)\b/.test(source)) return []
  const found: Array<{ fields: Fields; at: number; end: number }> = []
  const opening = /\[\s*(?:\/\/[^\n]*\s*)?\{/g
  let tries = 0
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    tries += 1
    if (tries > MAX_TRIES) break
    const read = readLiteral(source, match.index)
    if (!read) continue
    for (const fields of fieldArraysIn(read.value)) found.push({ fields, at: match.index, end: read.end })
    opening.lastIndex = read.end
  }
  return found
}

/** The words on a form's button, where its data says them: an entry of its own, else the nearest key that names them. */
function submitWordsOf(fields: Fields, source: string, at: number, end: number, words: (raw: string) => string): string {
  const own = fields.find((entry) => /^(?:submit|button)$/.test(typeKey(entry['type'])))
  const label = own ? labelOf(own) || (typeof own['text'] === 'string' ? own['text'] : '') : ''
  if (label) return words(label).slice(0, 120)
  const around = 4_000
  const from = Math.max(0, at - around)
  const near = source.slice(from, end + around)
  let best = ''
  let distance = Infinity
  for (const match of near.matchAll(/["']?([A-Za-z_]*(?:submit|button)[A-Za-z_]*)["']?\s*:\s*(?:"([^"\\\n]{1,80})"|'([^'\\\n]{1,80})')/gi)) {
    if (!/^(?:submit)$|(?:submit|button)[a-z_]*(?:text|label|title|copy|words|value)$|(?:text|label)[a-z_]*(?:submit|button)$/i.test(match[1] as string)) continue
    const place = from + match.index
    const away = place < at ? at - place : place > end ? place - end : 0
    if (away < distance) {
      distance = away
      best = (match[2] ?? match[3]) as string
    }
  }
  return best ? words(best).slice(0, 120) : ''
}

/** A field's choices, as written: strings, or objects naming them. */
function optionsOf(entry: Record<string, unknown>, words: (raw: string) => string): string[] {
  const list = ['options', 'choices', 'values', 'items'].map((key) => entry[key]).find(Array.isArray) as unknown[] | undefined
  const out: string[] = []
  for (const option of list ?? []) {
    const raw = typeof option === 'string' ? option : isObject(option) ? [option['label'], option['title'], option['text'], option['name'], option['value']].find((value) => typeof value === 'string') : null
    const text = typeof raw === 'string' ? words(raw).slice(0, 200) : ''
    if (text) out.push(text)
  }
  return out
}

const slugOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** A field's name: what its data calls it, where that is a name a form can use, else its words. */
function nameOf(entry: Record<string, unknown>, label: string): string {
  const own = ['name', 'key', 'fieldName', 'field_name'].map((key) => entry[key]).find((value) => typeof value === 'string' && /^[A-Za-z][\w-]{0,62}$/.test(value))
  return typeof own === 'string' ? own : slugOf(label)
}

function isRequired(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === 'string' && /^(?:true|required|1)$/i.test(value))
}

/** A field array as the form it is; `null` where it asks for a password or a card. */
function formOf(fields: Fields, submit: string, words: (raw: string) => string, maxFields: number): SiteImportForm | null {
  const out: SiteImportFormField[] = []
  const leftOut: string[] = []
  const names = new Set<string>()
  for (const entry of fields) {
    if (REFUSED_FIELD.test(`${typeKey(entry['type'])} ${String(entry['name'] ?? '')} ${labelOf(entry)}`)) return null
    if (!isField(entry)) continue
    const type = typeKey(entry['type'])
    if (NO_QUESTION.test(type)) continue
    const label = words(labelOf(entry)).slice(0, 200)
    if (!label) continue
    if (FILE_TYPES.test(type)) {
      leftOut.push(label)
      continue
    }
    if (out.length >= maxFields) continue
    let name = nameOf(entry, label)
    for (let suffix = 2; names.has(name); suffix += 1) name = `${nameOf(entry, label)}-${suffix}`
    names.add(name)
    const kind = FIELD_TYPES.get(type) ?? 'text'
    const options = optionsOf(entry, words)
    const placeholder = typeof entry['placeholder'] === 'string' ? words(entry['placeholder']).slice(0, 200) : ''
    out.push({
      type: kind,
      name,
      label,
      ...(isRequired(entry['required']) ? { required: true as const } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...((kind === 'select' || kind === 'radio' || kind === 'checkbox') && options.length ? { options } : {}),
    })
  }
  if (!out.length) return null
  return { fields: out, ...(submit ? { submit } : {}), ...(leftOut.length ? { leftOut } : {}) }
}

/*------------------------------------------
 * The page
 *-----------------------------------------*/

/** A class's word that says it is a form, at a word's edge: `contact-form`, `form_block`, `contactForm`; never `transform` or `platform`. */
const FORM_HINT = /(?:^|[_-])forms?(?:$|[_-])|[a-z]Forms?(?:$|[_A-Z-])|^Forms?[A-Z]/
const NOT_THIS_FORM = /search/i
const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'aside', 'main', 'figure', 'fieldset'])
const CLASS_OF = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const HIDDEN_BODIES = /<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi

const blanked = (html: string) => html.replace(HIDDEN_BODIES, (body) => ' '.repeat(body.length))

/** Whether an opening tag is an element a form can be attached to. */
function isHint(tag: string, attributes: string): boolean {
  const name = tag.toLowerCase()
  if (!CONTAINER_TAGS.has(name) && !(name.includes('-') && /(?:^|-)forms?(?:$|-)/.test(name))) return false
  const match = CLASS_OF.exec(attributes)
  const classes = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').split(/\s+/).filter(Boolean)
  if (/\brole\s*=\s*["']?form\b/i.test(attributes)) return true
  if (name.includes('-')) return !NOT_THIS_FORM.test(name)
  return classes.some((word) => FORM_HINT.test(word) && !NOT_THIS_FORM.test(word))
}

export interface SiteImportDataFormsResult {
  /** The page, a marker at each form's place. */
  html: string
  kept: SiteImportForm[]
  /** Forms left out because they ask for a password or a card. */
  removed: number
}

/**
 * The forms a page holds as data, for a page with no `<form>` of its own but a
 * search box. `words` turns what the data says into what a visitor reads.
 */
export function siteImportDataForms(
  html: string,
  words: (raw: string) => string,
  limits: { forms: number; fieldsPerForm: number },
): SiteImportDataFormsResult {
  const none: SiteImportDataFormsResult = { html, kept: [], removed: 0 }
  if (!/\brequired\b/.test(html)) return none
  const shown = blanked(html)
  for (const form of shown.matchAll(/<form\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    if (!/search/i.test(form[0])) return none
  }
  const hints: Array<{ start: number; end: number }> = []
  const dataAttributes: Array<{ at: number; text: string }> = []
  for (const match of shown.matchAll(OPEN_TAG)) {
    const attributes = match[2] as string
    if (isHint(match[1] as string, attributes)) hints.push({ start: match.index, end: match.index + match[0].length })
    if (!/\bdata-[\w-]+\s*=/.test(attributes) || !/required/.test(attributes)) continue
    for (const value of attributes.matchAll(/\bdata-[\w-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const raw = value[1] ?? value[2] ?? ''
      if (/required/.test(raw)) dataAttributes.push({ at: match.index, text: decodeQuotes(raw) })
    }
  }
  if (!hints.length) return none
  const sources: Array<{ at: number; text: string }> = [...dataAttributes]
  for (const script of html.matchAll(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = script[1] as string
    if (/\bsrc\s*=/i.test(attributes)) continue
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase() ?? ''
    if (type && !/^(?:module|text\/javascript|application\/javascript|application\/json|text\/json|text\/plain|text\/x-[\w-]*json|application\/(?!ld\+)[\w.-]*\+json)$/.test(type)) continue
    sources.push({ at: script.index, text: script[2] as string })
  }
  sources.sort((a, b) => a.at - b.at)
  const kept: SiteImportForm[] = []
  const places: Array<{ end: number; index: number }> = []
  const seen = new Set<string>()
  let removed = 0
  for (const source of sources) {
    for (const found of fieldArraysOfText(source.text)) {
      if (kept.length >= limits.forms) break
      const submit = submitWordsOf(found.fields, source.text, found.at, found.end, words)
      const signature = JSON.stringify(found.fields.map((entry) => [typeKey(entry['type']), labelOf(entry)]))
      if (seen.has(signature)) continue
      seen.add(signature)
      const form = formOf(found.fields, submit, words, limits.fieldsPerForm)
      if (!form) {
        if (found.fields.some((entry) => REFUSED_FIELD.test(`${typeKey(entry['type'])} ${String(entry['name'] ?? '')} ${labelOf(entry)}`))) removed += 1
        continue
      }
      const before = hints.filter((hint) => hint.start <= source.at).pop()
      const after = hints.find((hint) => hint.start > source.at)
      const place = before && (!after || source.at - before.end <= after.start - source.at) ? before : after
      if (!place) continue
      places.push({ end: place.end, index: kept.length })
      kept.push(form)
    }
  }
  if (!kept.length) return { html, kept: [], removed }
  let out = html
  for (const place of [...places].sort((a, b) => b.end - a.end || b.index - a.index)) {
    out = `${out.slice(0, place.end)} <aglyn-form data-form="${place.index}"> ${out.slice(place.end)}`
  }
  return { html: out, kept, removed }
}

/** An attribute's value with the quotes a page had to escape to write JSON in it put back; the rest is left to `words`. */
function decodeQuotes(raw: string): string {
  return raw.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&#39;|&#x27;|&apos;/gi, "'").replace(/&amp;/gi, '&')
}
