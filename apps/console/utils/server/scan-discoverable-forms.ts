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
 * Finding the forms a site already has (`docs/specs/reusable-forms.md` §2d).
 *
 * Every form on the platform predates the form entity: it is a `Form` subtree
 * an author drew on a screen, in a layout, or inside a reusable component
 * definition. Adoption is what turns one into a `forms/{formId}` document, and
 * this is the half that finds them and works out what history each can claim.
 *
 * ## The corpus is the *Used by* scan's, and so is the posture
 *
 * Screens, layouts and component definitions, with published node trees
 * decoded — exactly what `readUsageCandidates` already reads for
 * `scanComponentUsage`. ⚠️ It is EXPENSIVE, and it must stay idle until a
 * reader asks: the same scan behind the *Used by* card was measured at
 * several hundred document reads on one real site, and the standing rule
 * against unrequested reads on mount is what keeps it behind a button.
 *
 * ## Why a path, and not just a caption
 *
 * The backfill matches a historical submission on the PAIR `(formName, path)`,
 * because a caption is a display string two pages may legitimately share and
 * `path` is the only thing recorded that tells them apart. So discovery has to
 * answer where each form actually RENDERED, which is not a property of the
 * node — a form in a layout renders on every screen using that layout, and one
 * in a component definition renders wherever that component is placed.
 *
 * That is why the path resolution below goes through the same deep helpers the
 * usage scan uses rather than reading the node's own document: a form in a
 * shared layout would otherwise claim no paths at all and match nothing.
 */

import { discoverFormNodes, type DiscoveredFormNode } from '@aglyn/aglyn/server'
import {
  screenIdsUsingComponentDeep,
  screenIdsUsingLayoutDeep,
  type UsageCandidate,
} from './scan-artifact-usage'

/** One adoptable form, with everything an adoption needs to mint it. */
export interface DiscoverableForm extends DiscoveredFormNode {
  /**
   * Every live page path this form renders on, deduped and sorted.
   *
   * This becomes `legacyMatch.paths`. An EMPTY list is meaningful and is not
   * an error: a form on an unrouted screen, or in a component nothing places,
   * renders nowhere — so it has no history to claim and the backfill will
   * match nothing to it. That is the correct, conservative answer.
   */
  paths: string[]
}

/** The routing map on the host document: screen id → route path. */
export type ScreenRoutes = Record<string, unknown>

/**
 * Where a form found in `source` renders.
 *
 * Deleted screens are excluded by the caller's candidate list, not here — a
 * scan that had to know about soft deletes in two places would disagree with
 * itself in one of them.
 */
function pathsForSource(
  source: { kind: DiscoveredFormNode['sourceKind']; id: string },
  candidates: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
  },
  routes: ScreenRoutes,
): string[] {
  const screenIds =
    source.kind === 'screen'
      ? [source.id]
      : source.kind === 'layout'
        ? screenIdsUsingLayoutDeep(
            source.id,
            candidates.screens,
            candidates.layouts,
          )
        : screenIdsUsingComponentDeep(source.id, candidates)
  const paths = new Set<string>()
  for (const screenId of screenIds) {
    const path = routes[screenId]
    // A screen with no route serves no page, so a form on it has no path to
    // claim. Skipped rather than recorded as an empty string, which would be a
    // path that every pathless submission matched.
    if (typeof path === 'string' && path) paths.add(path)
  }
  return [...paths].sort()
}

/**
 * Every `Form` node on a site, with the paths it renders on.
 *
 * Pure: the caller does the reading. That is what makes the path arithmetic —
 * the part with the layout and component fan-out, and the part a wrong answer
 * silently mis-files history through — testable without Firestore.
 *
 * Forms already bound to an entity are INCLUDED, carrying their `formId`. The
 * console needs to show them as already adopted; dropping them would render a
 * site that has adopted everything as a site with no forms.
 */
export function scanDiscoverableForms(
  candidates: {
    screens: UsageCandidate[]
    layouts: UsageCandidate[]
    components: UsageCandidate[]
  },
  routes: ScreenRoutes,
): DiscoverableForm[] {
  const found: DiscoverableForm[] = []
  const sources: Array<[DiscoveredFormNode['sourceKind'], UsageCandidate[]]> = [
    ['screen', candidates.screens],
    ['layout', candidates.layouts],
    ['component', candidates.components],
  ]
  for (const [kind, list] of sources) {
    for (const candidate of list) {
      if (candidate.deletedAt) continue
      const nodes = candidate.nodes as
        | Record<string, any>
        | null
        | undefined
      if (!nodes) continue
      const source = {
        kind,
        id: candidate.id,
        ...(candidate.displayName || candidate.name
          ? { name: String(candidate.displayName ?? candidate.name) }
          : {}),
      }
      for (const node of discoverFormNodes(nodes, source)) {
        found.push({
          ...node,
          paths: pathsForSource(source, candidates, routes),
        })
      }
    }
  }
  return found
}

/**
 * What an adoption would claim of the history that predates it.
 *
 * Split out from the scan because it is the value a `forms` document is
 * created WITH, and because it is the one the backfill reads back. Keeping it
 * beside the scan means the two cannot disagree about what a form claims.
 */
export function legacyMatchFor(form: DiscoverableForm): {
  formName: string
  paths: string[]
} {
  return { formName: form.formName, paths: form.paths }
}

/**
 * Which discovered forms would collide if both were adopted as they stand.
 *
 * Two forms claiming the same `(formName, path)` make every historical
 * submission on that pair ambiguous, so the backfill will stamp NONE of them.
 * That is the safe outcome, but it is a silent one — the author would adopt
 * two forms, run the migration, and be told only that N rows could not be
 * matched.
 *
 * Surfacing it at adoption time is the difference between "this history
 * cannot be split, and here is why" and an unexplained count. Renaming one
 * form before adopting resolves it.
 */
export function collidingClaims(
  forms: DiscoverableForm[],
): Array<{ formName: string; path: string; nodeIds: string[] }> {
  const byPair = new Map<string, string[]>()
  for (const form of forms) {
    for (const path of form.paths) {
      const key = `${form.formName}\u0000${path}`
      byPair.set(key, [...(byPair.get(key) ?? []), form.nodeId])
    }
  }
  return [...byPair.entries()]
    .filter(([, nodeIds]) => nodeIds.length > 1)
    .map(([key, nodeIds]) => {
      const [formName, path] = key.split('\u0000')
      return { formName: formName as string, path: path as string, nodeIds }
    })
}
