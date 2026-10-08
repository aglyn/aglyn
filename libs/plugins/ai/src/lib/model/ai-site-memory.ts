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
 * What Aglyn AI remembers about a site (AGL-3661): short preferences
 * distilled from the edits its owner applied, read into every later AI job
 * for the site, and shown — and clearable — on Setup → Business profile.
 *
 * ── Rules, not a model ────────────────────────────────────────────────────
 *
 * Each preference is recognized by a fixed rule over what the owner asked for
 * and what the applied edit did. No model call: memory has to cost nothing on
 * Free, and a rule says exactly why a line was remembered, so an owner who
 * sees it can recognize the edit it came from. A rule fires only on an edit
 * the owner APPLIED, never on one they were merely shown.
 *
 * ── One per group ─────────────────────────────────────────────────────────
 *
 * A preference belongs to a group, and a group holds one at a time: an owner
 * who asked for a casual tone and later for a formal one prefers the formal
 * one now, so the casual line is forgotten rather than contradicted.
 *
 * Stored at `hosts/{hostId}/aiMemory/{id}`, one document per preference, so
 * clearing one is one client delete (see the rules).
 */

/** The host subcollection the preferences live in. */
export const AI_SITE_MEMORY_SUBCOLLECTION = 'aiMemory'

/** At most this many are kept per site; the oldest unrepeated go first. */
export const AI_SITE_MEMORY_MAX = 12

/** At most this many are told to a model. */
export const AI_SITE_MEMORY_LISTED = 6

/** A preference a rule recognized in one applied edit. */
export interface AiSitePreferenceMatch {
  /** Stable per preference: the document id. */
  id: string
  /** Preferences in one group replace each other. */
  group: string
  /** What a model and the owner read. */
  text: string
}

/** A stored preference. */
export interface AiSitePreference extends AiSitePreferenceMatch {
  /** How many applied edits it was recognized in. */
  count: number
  lastSeenAtMs: number
  /** What it was learned from; only applied Assist edits today. */
  source: 'assist-edit'
}

/** What an applied edit tells the rules. */
export interface AiAppliedEditSignal {
  /** What the owner asked the assistant, in their words. */
  question: string
  /** The applied operations counted by word (`set`, `remove`, `insert`, …). */
  opCounts: Readonly<Record<string, number>>
}

interface PreferenceRule extends AiSitePreferenceMatch {
  test: (question: string, ops: Readonly<Record<string, number>>) => boolean
}

const has = (pattern: RegExp) => (question: string) => pattern.test(question)

/** A section kind an owner removes, by the words they ask for it with. */
const REMOVABLE_SECTIONS: ReadonlyArray<{ id: string; words: string; label: string }> = [
  { id: 'testimonials', words: 'testimonials?|reviews?|quotes?', label: 'testimonial and review sections' },
  { id: 'faq', words: 'faqs?|questions section', label: 'FAQ sections' },
  { id: 'pricing', words: 'pric(?:es|ing)|plans section', label: 'pricing sections' },
  { id: 'stats', words: 'stats?|statistics|numbers section|counters?', label: 'stats and number sections' },
  { id: 'logos', words: 'logos?|partners?|clients section|trusted by', label: 'logo and partner strips' },
  { id: 'newsletter', words: 'newsletter|sign-?up section|subscribe', label: 'newsletter sign-up sections' },
  { id: 'team', words: 'team section|our team|staff section', label: 'team sections' },
  { id: 'gallery', words: 'gallery|galleries', label: 'gallery sections' },
]

const REMOVE_VERBS = '(?:remove|delete|drop|get rid of|take out|cut|lose|hide)'

const RULES: readonly PreferenceRule[] = [
  {
    id: 'tone-casual',
    group: 'tone',
    text: 'Prefers a casual, friendly tone',
    test: has(/\b(casual|friendl(?:y|ier)|relaxed|less formal|warmer|conversational|chill)\b/i),
  },
  {
    id: 'tone-formal',
    group: 'tone',
    text: 'Prefers a formal, professional tone',
    test: has(/\b(more (?:formal|professional|serious)|less casual|formal tone|professional tone)\b/i),
  },
  {
    id: 'copy-short',
    group: 'length',
    text: 'Prefers short, concise copy',
    test: has(/\b(shorter|concise|less (?:text|copy|wordy)|trim|tighten|too long|fewer words|brief(?:er)?)\b/i),
  },
  {
    id: 'copy-detailed',
    group: 'length',
    text: 'Prefers detailed copy',
    test: has(/\b(more detail(?:ed)?|longer|expand|elaborate|too short|say more)\b/i),
  },
  {
    id: 'no-emoji',
    group: 'emoji',
    text: 'Does not want emoji in copy',
    test: has(/\b(no|remove|without|drop|delete) (?:the )?emojis?\b/i),
  },
  ...REMOVABLE_SECTIONS.map(
    (section): PreferenceRule => ({
      id: `removes-${section.id}`,
      group: `removes-${section.id}`,
      text: `Removes ${section.label}`,
      test: (question, ops) =>
        (ops['remove'] ?? 0) > 0 &&
        new RegExp(`\\b${REMOVE_VERBS}\\b[^.?!]{0,40}\\b(?:${section.words})\\b`, 'i').test(question),
    }),
  ),
]

/**
 * The preferences one applied edit shows (AGL-3661): each rule that fires, at
 * most one per group — the first, as the rules are ordered.
 */
export function aiPreferencesFromEdit(signal: AiAppliedEditSignal): AiSitePreferenceMatch[] {
  const question = (signal.question ?? '').slice(0, 2_000)
  if (!question.trim()) return []
  const ops = signal.opCounts ?? {}
  const applied = Object.values(ops).some((count) => count > 0)
  if (!applied) return []
  const seen = new Set<string>()
  const matches: AiSitePreferenceMatch[] = []
  for (const rule of RULES) {
    if (seen.has(rule.group) || !rule.test(question, ops)) continue
    seen.add(rule.group)
    matches.push({ id: rule.id, group: rule.group, text: rule.text })
  }
  return matches
}

/**
 * The preferences a model is told, strongest first: the most often repeated,
 * then the most recent. Capped at {@link AI_SITE_MEMORY_LISTED}.
 */
export function aiListedPreferences(preferences: readonly AiSitePreference[]): string[] {
  return [...preferences]
    .sort((a, b) => b.count - a.count || b.lastSeenAtMs - a.lastSeenAtMs)
    .slice(0, AI_SITE_MEMORY_LISTED)
    .map((preference) => preference.text)
}

/** A stored row as a preference; `null` for one this version cannot read. */
export function aiSitePreferenceOf(id: string, raw: Record<string, unknown> | undefined): AiSitePreference | null {
  const text = typeof raw?.['text'] === 'string' ? raw['text'].trim().slice(0, 120) : ''
  if (!text) return null
  const count = Number(raw?.['count'])
  const last = Number(raw?.['lastSeenAtMs'])
  return {
    id,
    group: typeof raw?.['group'] === 'string' ? raw['group'] : id,
    text,
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
    lastSeenAtMs: Number.isFinite(last) ? last : 0,
    source: 'assist-edit',
  }
}
