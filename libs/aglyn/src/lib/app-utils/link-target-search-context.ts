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
 * The link-target search seam (AGL-3119): how a link picker finds ENTRIES.
 *
 * Screens, collection listings and feeds are a handful of targets the
 * console already holds in `ScreenLinkContext`, so a picker filters them in
 * memory. Entries are different in kind: a blog can hold thousands, and
 * reading them all into a dropdown is exactly the read bill a lookup exists
 * to avoid. So a picker asks for the few entries that match what the author
 * typed, when they type it, and names a stored entry reference with one
 * keyed read.
 *
 * The picker lives in libraries that cannot know how the data is read — the
 * designer and the markdown editor — and the console is what can. This
 * context is the contract between them. Its default offers nothing, so every
 * surface without a provider (the tenant, a marketplace README, an isolated
 * spec) keeps working with the targets it has.
 *
 * Same placement rationale as `screen-link-context.ts`: in @aglyn/aglyn
 * without a `'use client'` banner, so the designer, the markdown editor and
 * the console share one context instance; `createContext` at module scope
 * keeps it out of the `@aglyn/aglyn/server` barrel.
 */

import { createContext, useContext, useEffect, useState } from 'react'
import {
  screenLinkTargetLabel,
  unavailableScreenLabel,
} from './screen-link-context'
import { ScreenLinkContext } from './screen-link-context-value'
import {
  formatCollectionLinkValue,
  formatEntryLinkValue,
  parseEntryLinkValue,
  parseScreenLinkValue,
  screenRoutesAnswerFor,
} from './screen-link-value'

/** An entry's publication state, as its document stores it. */
export type LinkTargetEntryStatus = 'draft' | 'published' | 'scheduled'

/** One entry a search found — see {@link LinkTargetSearchContextValue}. */
export interface LinkTargetOption {
  /** The stored reference, `entry:<collectionId>/<entryId>`. */
  value: string
  /** One line naming it — see {@link entryLinkTargetLabel}. */
  label: string
  /** The entry's own title: what a link to it says when nothing else does. */
  title: string
  /** The name of the collection it belongs to. */
  collectionName?: string
  status: LinkTargetEntryStatus
}

export interface LinkTargetSearchOptions {
  /** Aborted when the author has typed on: the answer is no longer wanted. */
  signal?: AbortSignal
}

export interface LinkTargetSearchContextValue {
  /**
   * Whether anything here can search. False only on the default, where the
   * pickers offer no Entries group at all rather than an empty one.
   */
  available: boolean
  /**
   * The entries matching what the author typed, a few per collection. An
   * empty query asks for the most recently edited ones instead, so a picker
   * opened before anything is typed still offers something.
   *
   * Rejects with an `AbortError` once `signal` aborts.
   */
  searchEntries: (
    query: string,
    options?: LinkTargetSearchOptions,
  ) => Promise<LinkTargetOption[]>
  /**
   * The label for one stored entry reference — the {@link LinkTargetOption}
   * label a search would give it — or `undefined` when no such entry exists.
   * A failed read rejects, because a network error is not evidence that an
   * entry is gone.
   */
  describeTarget: (value: string) => Promise<string | undefined>
}

/** The default: no provider mounted, so no entry can be searched or named. */
export const NO_LINK_TARGET_SEARCH: LinkTargetSearchContextValue =
  Object.freeze({
    available: false,
    searchEntries: () => Promise.resolve([]),
    describeTarget: () => Promise.resolve(undefined),
  })

/**
 * Provided by the console around every surface that edits links — each
 * besigner and the content entry editor — and absent everywhere else.
 */
export const LinkTargetSearchContext =
  createContext<LinkTargetSearchContextValue>(NO_LINK_TARGET_SEARCH)
LinkTargetSearchContext.displayName = 'LinkTargetSearchContext'

/**
 * How long a picker waits after the last keystroke before it searches: long
 * enough that typing a word is one search, short enough to feel live.
 */
export const LINK_TARGET_SEARCH_DEBOUNCE_MS = 250

/** A stored status as one of the three the entries table offers. */
export function normalizeLinkTargetEntryStatus(
  value: unknown,
): LinkTargetEntryStatus {
  return value === 'published' || value === 'scheduled' ? value : 'draft'
}

/**
 * The one line a picker shows for an entry: its title and address, the
 * collection it belongs to, and whether it is live — `Hello (/blog/hello) —
 * Blog entry · draft`. The same shape as a listing's label, so a closed picker
 * says what KIND of target it holds, and the status is there because a link
 * to a draft goes nowhere until the draft is published.
 */
export function entryLinkTargetLabel(entry: {
  title?: string | null
  path?: string | null
  collectionName?: string | null
  status: LinkTargetEntryStatus
}): string {
  const name = entry.title?.trim() || 'Untitled entry'
  const address = entry.path ? ` (${entry.path})` : ''
  const owner = entry.collectionName?.trim()
    ? `${entry.collectionName.trim()} entry`
    : 'entry'
  return `${name}${address} — ${owner} · ${entry.status}`
}

/** What {@link useLinkTargetEntrySearch} holds for a picker to draw. */
export interface LinkTargetEntrySearch {
  /** A provider is mounted, so the picker has an Entries group at all. */
  available: boolean
  /** The entries matching the current query, once its search settles. */
  entries: LinkTargetOption[]
  /** The current query's search is waiting out its debounce or in flight. */
  searching: boolean
  /** The current query's search failed, so `entries` being empty says nothing. */
  failed: boolean
}

interface SettledSearch {
  query: string
  search: LinkTargetSearchContextValue
  entries: LinkTargetOption[]
  failed: boolean
}

/**
 * Searches entries for what the author typed, while `active` — a picker
 * passes whether its list is open, so a closed picker reads nothing.
 *
 * Debounced by {@link LINK_TARGET_SEARCH_DEBOUNCE_MS}, and each new query
 * aborts the search before it: typing `hello` is one search, not five, and an
 * answer for `hel` that lands after the one for `hello` is dropped rather than
 * shown.
 */
export function useLinkTargetEntrySearch(
  query: string,
  active: boolean,
): LinkTargetEntrySearch {
  const search = useContext(LinkTargetSearchContext)
  const enabled = active && search.available
  const [settled, setSettled] = useState<SettledSearch | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      search.searchEntries(query, { signal: controller.signal }).then(
        (entries) => {
          if (controller.signal.aborted) return
          setSettled({ query, search, entries, failed: false })
        },
        () => {
          if (controller.signal.aborted) return
          setSettled({ query, search, entries: [], failed: true })
        },
      )
    }, LINK_TARGET_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, query, search])

  // Only an answer to THIS query from THIS provider counts: the previous
  // query's entries would be a wrong answer shown as a right one.
  const current =
    enabled && settled?.query === query && settled.search === search
      ? settled
      : null
  return {
    available: search.available,
    entries: current?.entries ?? [],
    searching: enabled && !current,
    failed: Boolean(current?.failed),
  }
}

/** What {@link useLinkTargetLabel} calls a stored target. */
export interface LinkTargetLabel {
  label: string
  /** Known to be gone: whatever holds the target has been asked and said so. */
  missing: boolean
  /** Still being looked up, so `label` is a stand-in. */
  pending: boolean
}

interface DescribedEntry {
  key: string
  search: LinkTargetSearchContextValue
  label: string | undefined
  failed: boolean
}

/**
 * A readable name for a stored link target: a routing-map key (a bare screen
 * id, `collection:`, `feed:`, `entry:`) or a `screen:` value. `undefined` for
 * nothing stored.
 *
 * Screens, listings and feeds are named from `ScreenLinkContext` exactly as
 * the pickers label them. An entry is named through the search seam, with a
 * stand-in naming its collection while that read is out — never its raw ids,
 * which say nothing to an author.
 */
export function useLinkTargetLabel(
  key: string | null | undefined,
): LinkTargetLabel | undefined {
  const { screens, labels } = useContext(ScreenLinkContext)
  const search = useContext(LinkTargetSearchContext)
  const raw = typeof key === 'string' ? key.trim() : ''
  const target = raw ? (parseScreenLinkValue(raw) ?? raw) : ''
  const entry = target ? parseEntryLinkValue(target) : undefined
  const entryKey = entry
    ? formatEntryLinkValue(entry.collectionId, entry.entryId)
    : undefined
  const [described, setDescribed] = useState<DescribedEntry | null>(null)

  useEffect(() => {
    if (!entryKey || !search.available) return undefined
    let live = true
    search.describeTarget(entryKey).then(
      (label) => {
        if (live) setDescribed({ key: entryKey, search, label, failed: false })
      },
      () => {
        if (live) {
          setDescribed({ key: entryKey, search, label: undefined, failed: true })
        }
      },
    )
    return () => {
      live = false
    }
  }, [entryKey, search])

  if (!target) return undefined
  if (entry && entryKey) {
    const collectionName =
      labels?.[formatCollectionLinkValue(entry.collectionId)]
    const standIn = collectionName ? `Entry in ${collectionName}` : 'Linked entry'
    if (!search.available) {
      return { label: standIn, missing: false, pending: false }
    }
    const answer =
      described?.key === entryKey && described.search === search
        ? described
        : null
    if (!answer) return { label: standIn, missing: false, pending: true }
    if (answer.label) return { label: answer.label, missing: false, pending: false }
    // A read that failed proves nothing about the entry, so it is named as
    // if the seam were absent rather than condemned.
    if (answer.failed) return { label: standIn, missing: false, pending: false }
    return {
      label: collectionName
        ? `⚠ Unavailable entry in ${collectionName} — deleted`
        : '⚠ Unavailable entry — deleted',
      missing: true,
      pending: false,
    }
  }
  const named = screenLinkTargetLabel(target, screens, labels)
  if (named) return { label: named, missing: false, pending: false }
  const known = screenRoutesAnswerFor(screens, target)
  return {
    label: unavailableScreenLabel(target, known),
    missing: known,
    pending: false,
  }
}
