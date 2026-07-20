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
 * Changelog entries (AGL-614). A typed, hand-authored list — the marketing
 * site has no CMS or MDX pipeline, so this mirrors the pricing page's
 * data-driven pattern. Newest first; the pages sort by `date` defensively.
 */

export interface ChangelogImage {
  src: string
  alt: string
  width: number
  height: number
}

export interface ChangelogSection {
  heading?: string
  body: string[]
  image?: ChangelogImage
}

export interface ChangelogEntry {
  /** URL slug, e.g. `/changelog/rest-api`. */
  slug: string
  /** ISO date `YYYY-MM-DD`. */
  date: string
  title: string
  /** One- or two-sentence lead shown on the index and entry. */
  summary: string
  sections: ChangelogSection[]
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    slug: 'rest-api',
    date: '2026-07-20',
    title: 'The Aglyn REST API',
    summary:
      'Programmatic access to your organization’s data, authenticated with API keys you create in the console.',
    sections: [
      {
        body: [
          'You can now read and write your Aglyn data over a REST API. Manage ' +
            'datasets and records with full create, read, update, and delete; ' +
            'read your contacts, sites, and form submissions; and drive ' +
            'integrations from your own systems.',
        ],
      },
      {
        heading: 'API keys, built for integrations',
        body: [
          'Create scoped keys under Organization → Settings → API keys. Each ' +
            'key is shown once, stored only as a hash, and limited to exactly ' +
            'the scopes you grant it. Revoke a key the moment it’s no longer ' +
            'needed.',
          'The API supports cursor pagination, per-key rate limits, idempotent ' +
            'writes, and a consistent error format. It’s included on the ' +
            'Business plan — full reference at docs.aglyn.com/api.',
        ],
      },
    ],
  },
  {
    slug: 'help-in-the-console',
    date: '2026-07-19',
    title: 'Help, right where you’re working',
    summary:
      'Contextual help arrived across the console, and the docs site grew an API reference, Learn, and Help areas.',
    sections: [
      {
        body: [
          'A small “?” now sits beside features throughout the console — page ' +
            'titles, cards, form fields, and the Besigner’s style and ' +
            'attribute panels. Hover for a one-line explanation, or click ' +
            'through to the exact spot in the docs.',
        ],
      },
      {
        heading: 'A bigger documentation site',
        body: [
          'The docs got a refreshed welcome page, click-to-enlarge images, a ' +
            'dedicated API reference, guided Learn paths, and a Help center — ' +
            'plus a Documentation link in your account menu.',
        ],
      },
    ],
  },
  {
    slug: 'menus-and-navigation',
    date: '2026-07-18',
    title: 'Design menus and navigation in the Besigner',
    summary:
      'Dropdown menus, hover mega menus, and slide-in drawers — authored entirely on the canvas.',
    sections: [
      {
        body: [
          'Build a dropdown menu, a full-width mega menu, or a slide-in drawer ' +
            'directly in the Besigner. Menus click-toggle out of the box, and ' +
            'hover behavior is authored as an editable interaction with grace ' +
            'delays and outside-click dismissal.',
        ],
        image: {
          src: '/_static/images/designer/website-designer-preview-collage.png',
          alt: 'The Aglyn website designer canvas with element categories, attributes, and a live preview',
          width: 1950,
          height: 1473,
        },
      },
    ],
  },
]

/** Entries sorted newest-first by date. */
export function changelogEntries(): ChangelogEntry[] {
  return [...CHANGELOG_ENTRIES].sort((a, b) => b.date.localeCompare(a.date))
}

export function changelogEntry(slug: string): ChangelogEntry | undefined {
  return CHANGELOG_ENTRIES.find((entry) => entry.slug === slug)
}

/** Long-form date for display, e.g. "July 20, 2026". */
export function formatChangelogDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
