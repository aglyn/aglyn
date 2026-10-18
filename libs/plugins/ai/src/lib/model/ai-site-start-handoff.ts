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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { aiSiteStartAnswersFromInputs, type AiSiteStartAnswers } from './ai-site-start'

/**
 * START AGAIN AFTER THE EMPTY SITE WAS REMOVED (AGL-3936).
 *
 * A guided start cancelled or failed before it built anything, and left for
 * an hour, has its empty site removed by the AI jobs beat. Its job is kept,
 * with its answers, and "Start again" then opens Create site — there is no
 * site left to start on — with those answers filled in. The answers travel
 * in this tab's session storage for the few seconds between the click and
 * Create site's start drawing; nothing leaves the browser, and an answer
 * older than {@link AI_SITE_START_HANDOFF_MS} is not used.
 */

/** What the job's own page and the AI jobs drawer say about a removed site. */
export const AI_SITE_REMOVED_HEADING = 'This site was removed'
export const AI_SITE_REMOVED_COPY =
  'Nothing was built before this start stopped, so the empty site was removed. Start again to create a site with the same answers.'
export const AI_SITE_REMOVED_ROW_COPY = 'Nothing was built, so the empty site was removed.'
export const AI_SITE_START_AGAIN_LABEL = 'Start again'

/** How long the answers wait for Create site to open. */
export const AI_SITE_START_HANDOFF_MS = 10 * 60_000

const KEY = 'aglyn:ai-site-start:answers'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** Create site on the workspace's Sites page: `/{org}/hosts?create=site`. */
export function aiCreateSiteHref(orgSlug: string): string | null {
  return orgSlug ? `${buildRoute(Route.HOST_LIST, { orgSlug })}?create=site` : null
}

/** Keeps a start's answers (its job's `siteInputs`) for Create site to open on. */
export function stashAiSiteStartAnswers(inputs: Readonly<Record<string, unknown>> | null | undefined, now = Date.now()): void {
  if (!inputs) return
  try {
    storage()?.setItem(KEY, JSON.stringify({ inputs, at: now }))
  } catch {
    // Create site opens on its blank questions instead.
  }
}

/**
 * The answers a removed start left for Create site, or `null`. Read, not
 * taken: Create site may draw its start more than once while it opens; the
 * answers are dropped once a start is planned ({@link clearAiSiteStartAnswers}).
 */
export function readAiSiteStartAnswers(options: { freeTaste?: boolean } = {}, now = Date.now()): AiSiteStartAnswers | null {
  try {
    const raw = storage()?.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { inputs?: Record<string, unknown>; at?: number }
    if (typeof parsed.at !== 'number' || now - parsed.at > AI_SITE_START_HANDOFF_MS) {
      storage()?.removeItem(KEY)
      return null
    }
    return aiSiteStartAnswersFromInputs(parsed.inputs ?? null, options)
  } catch {
    return null
  }
}

/** Drops the answers once a start has been planned with them. */
export function clearAiSiteStartAnswers(): void {
  try {
    storage()?.removeItem(KEY)
  } catch {
    // Nothing to drop.
  }
}
