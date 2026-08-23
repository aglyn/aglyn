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

import type { StyleFieldGroup } from './style-field-groups'

/**
 * Searching the styles panel (AGL-2486, item 13).
 *
 * The panel is seven accordions deep — Colors, Sizing, Typography, Borders &
 * Shadows, Position & Overflow, Flexbox & Grid, Classes & custom CSS — plus
 * the box stylers, the alignment toggles and the visibility switches. Finding
 * one property means remembering which section its author put it in.
 *
 * The part that makes this useful rather than decorative is the SECOND index:
 * matching the CSS property name alone would only help someone who already
 * knows CSS, and they are not the people this product is for. So every field
 * also carries the words a non-developer reaches for — `rounded` finds Corner
 * Radius, `shadow` finds the box-shadow control, `see through` finds Opacity,
 * `bold` finds Font Weight — and both spellings of colour are indexed because
 * half of Aglyn's authors type the other one.
 *
 * Ranking is deliberately simple and deterministic: an exact or prefix hit on
 * what the field is CALLED outranks a hit on one of its aliases, which
 * outranks a substring anywhere. Every term of a multi-word query has to
 * match something, so `border color` narrows instead of widening.
 */

/** Something the panel can find: a field, a control, or a whole section. */
export interface StyleSearchEntry {
  /** Stable id — a style property name, or a section key. */
  name: string
  /** What the panel calls it on screen. */
  label: string
  /** The words an author might use for it instead. */
  keywords?: readonly string[]
}

/**
 * What authors call these things when they are not reading a CSS spec.
 *
 * Keyed by the panel's own field name so a field added later is findable by
 * its label and property name with no entry here at all — this list only ever
 * ADDS reach, it is never the thing that makes search work.
 */
export const STYLE_FIELD_KEYWORDS: Record<string, readonly string[]> = {
  // Colors
  color: ['colour', 'text colour', 'font colour', 'type colour', 'ink'],
  backgroundColor: [
    'colour',
    'fill',
    'background',
    'bg',
    'behind',
    'panel colour',
  ],
  backgroundImage: [
    'gradient',
    'fill',
    'background',
    'image',
    'fade',
    'ramp',
    'photo',
  ],
  // Sizing
  width: ['size', 'wide', 'how wide'],
  height: ['size', 'tall', 'how tall'],
  minWidth: ['size', 'narrowest', 'at least wide'],
  maxWidth: ['size', 'widest', 'cap width', 'no wider than'],
  minHeight: ['size', 'shortest', 'at least tall'],
  maxHeight: ['size', 'tallest', 'no taller than'],
  // Typography
  fontSize: ['text size', 'type size', 'bigger text', 'smaller text', 'scale'],
  fontWeight: ['bold', 'boldness', 'thickness', 'weight', 'light', 'heavy'],
  fontFamily: ['typeface', 'font', 'typography'],
  lineHeight: ['leading', 'line spacing', 'space between lines'],
  letterSpacing: ['tracking', 'kerning', 'space between letters'],
  textTransform: ['uppercase', 'caps', 'all caps', 'lowercase', 'capitalise'],
  textDecoration: ['underline', 'strikethrough', 'strike through', 'overline'],
  // Borders & shadows
  border: ['outline', 'stroke', 'edge', 'line', 'rule', 'frame'],
  borderColor: ['colour', 'outline colour', 'stroke colour', 'edge colour'],
  borderTop: ['line above', 'rule above', 'edge', 'divider'],
  borderRight: ['line right', 'edge', 'divider'],
  borderBottom: ['line below', 'rule below', 'underline bar', 'divider'],
  borderLeft: ['line left', 'accent rail', 'edge', 'divider'],
  borderRadius: [
    'rounded',
    'rounding',
    'round corners',
    'corner',
    'corners',
    'curve',
    'radius',
    'pill',
  ],
  outline: ['focus ring', 'ring', 'stroke'],
  boxShadow: ['shadow', 'drop shadow', 'elevation', 'depth', 'lift', 'glow'],
  // Position & overflow
  position: ['sticky', 'fixed', 'absolute', 'pin', 'float above'],
  top: ['offset', 'from the top'],
  right: ['offset', 'from the right'],
  bottom: ['offset', 'from the bottom'],
  left: ['offset', 'from the left'],
  zIndex: ['stacking', 'layer', 'on top', 'in front', 'behind', 'z order'],
  overflow: ['scroll', 'clip', 'cut off', 'hidden', 'spill'],
  opacity: [
    'transparency',
    'transparent',
    'see through',
    'fade',
    'alpha',
    'ghost',
  ],
  cursor: ['pointer', 'hand', 'mouse'],
  // Layout
  display: ['block', 'inline', 'flex', 'grid', 'hide', 'layout'],
  float: ['wrap text', 'align left', 'align right'],
  // Flexbox & grid
  gap: ['spacing', 'gutter', 'space between', 'breathing room'],
  rowGap: ['spacing', 'gutter', 'space between rows'],
  columnGap: ['spacing', 'gutter', 'space between columns'],
  gridTemplateColumns: ['columns', 'grid', 'tracks', 'how many columns'],
  gridTemplateRows: ['rows', 'grid', 'tracks'],
  gridAutoFlow: ['grid', 'flow', 'fill order'],
  gridColumn: ['span', 'columns', 'placement'],
  gridRow: ['span', 'rows', 'placement'],
  flexGrow: ['grow', 'fill space', 'stretch'],
  flexShrink: ['shrink', 'squeeze'],
  flexBasis: ['starting size', 'base size'],
  order: ['reorder', 'move first', 'move last', 'sequence'],
  flexDirection: ['row', 'column', 'direction', 'stack', 'side by side'],
  flexWrap: ['wrap', 'no wrap', 'onto a new line'],
  justifyContent: ['spacing', 'centre', 'center', 'spread', 'distribute'],
  alignItems: ['centre', 'center', 'middle', 'top', 'bottom', 'align'],
  alignContent: ['centre', 'center', 'distribute', 'align rows'],
  justifyItems: ['centre', 'center', 'align'],
  alignSelf: ['centre', 'center', 'this one only', 'align myself'],
  justifySelf: ['centre', 'center', 'this one only', 'align myself'],
}

/** Sections and controls that are not schema fields but must still be found. */
export const STYLE_SECTION_ENTRIES: Record<string, StyleSearchEntry> = {
  box: {
    name: 'box',
    label: 'Margin & padding',
    keywords: [
      'margin',
      'padding',
      'spacing',
      'space',
      'inset',
      'gutter',
      'inner space',
      'outer space',
      'room',
      'indent',
    ],
  },
  textAlign: {
    name: 'textAlign',
    label: 'Text Alignment',
    keywords: [
      'align',
      'alignment',
      'centre',
      'center',
      'left',
      'right',
      'justify',
      'ragged',
    ],
  },
  visibility: {
    name: 'visibility',
    label: 'Visibility',
    keywords: [
      'hide',
      'hidden',
      'show',
      'responsive',
      'mobile',
      'tablet',
      'desktop',
      'hide on mobile',
      'device',
      'breakpoint',
    ],
  },
  classes: {
    name: 'classes',
    label: 'Classes & custom CSS',
    keywords: [
      'class',
      'classes',
      'css',
      'custom css',
      'sx',
      'raw css',
      'stylesheet',
      'advanced',
    ],
  },
}

/** Normalizes a label or query for matching: lowercase, single-spaced. */
function normalize(text: unknown): string {
  return `${text ?? ''}`
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `borderRadius` → `border radius`, so a two-word query hits a camel name. */
function humanizeName(name: string): string {
  return normalize(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
}

/** Score of one query TERM against one haystack, 0 when it does not match. */
function scoreTerm(haystack: string, term: string, weight: number): number {
  if (!haystack || !term) return 0
  if (haystack === term) return weight * 4
  if (haystack.startsWith(term)) return weight * 3
  // A hit at a word boundary ("radius" in "corner radius") is a real name
  // match; one mid-word ("us" in "radius") is barely evidence of anything.
  if (haystack.includes(` ${term}`)) return weight * 2
  if (haystack.includes(term)) return weight
  return 0
}

/**
 * How well one entry answers a query, or 0 when it does not.
 *
 * Every term must land somewhere — `border color` must not return every
 * border field AND every colour field — and the entry's own name and label
 * are weighted far above its aliases, so searching `color` puts Text Color
 * ahead of Border (which merely lists "edge colour" among its words).
 */
export function scoreStyleEntry(
  entry: StyleSearchEntry,
  query: string,
): number {
  const terms = normalize(query).split(' ').filter(Boolean)
  if (!terms.length) return 0
  const label = normalize(entry.label)
  const name = humanizeName(entry.name)
  // The same two with their separators gone, because `zindex`, `zIndex` and
  // `z-index` are one word to the person typing them and three to a matcher
  // that only ever sees `z index`.
  const compact = [label, name].map((text) => text.replace(/ /g, ''))
  const keywords = (
    entry.keywords ??
    STYLE_FIELD_KEYWORDS[entry.name] ??
    []
  ).map(normalize)
  let total = 0
  for (const term of terms) {
    const best = Math.max(
      scoreTerm(label, term, 10),
      scoreTerm(name, term, 8),
      ...compact.map((text) => scoreTerm(text, term, 7)),
      ...keywords.map((keyword) => scoreTerm(keyword, term, 3)),
    )
    // One unmatched term disqualifies the entry: a query is a conjunction.
    if (best <= 0) return 0
    total += best
  }
  return total
}

/** Whether an entry answers the query (an empty query matches everything). */
export function matchesStyleQuery(
  entry: StyleSearchEntry,
  query: string,
): boolean {
  if (!normalize(query)) return true
  return scoreStyleEntry(entry, query) > 0
}

/** The search entry for one schema field of a style group. */
export function styleFieldEntry(field: {
  name: string
  label?: unknown
  keywords?: readonly string[]
}): StyleSearchEntry {
  return {
    name: field.name,
    label: `${field.label ?? field.name}`,
    keywords: field.keywords ?? STYLE_FIELD_KEYWORDS[field.name],
  }
}

/**
 * A group holding only the fields that answer the query, best match first,
 * or `undefined` when none of them do — which is what lets the panel drop
 * the whole accordion instead of showing an empty one.
 *
 * An empty query returns the group unchanged, by identity, so the ordinary
 * (not-searching) render allocates nothing and the field order authors have
 * learned is untouched.
 */
export function filterStyleGroup(
  group: StyleFieldGroup,
  query: string,
): StyleFieldGroup | undefined {
  if (!normalize(query)) return group
  const ranked = group.fields
    .map((field) => ({
      field,
      score: scoreStyleEntry(styleFieldEntry(field as any), query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
  if (!ranked.length) return undefined
  return { ...group, fields: ranked.map((entry) => entry.field) }
}
