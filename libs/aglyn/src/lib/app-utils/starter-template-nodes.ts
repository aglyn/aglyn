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

import { CANVAS_ROOT_ELEMENT_ID } from '../foundation/constants/canvas'
import type { NodeInteraction } from './node-interactions'

/**
 * What a starter site is, and the kit its pages are built with (AGL-687,
 * AGL-3080).
 *
 * A starter is a bundle of page templates the template gallery offers and
 * the seed route copies into a site's library on first use. The platform's
 * own starters live in `starter-templates.ts`; a plugin whose elements a
 * starter is built around declares its own, built with this same kit, and
 * the manifest generator compiles them into
 * `plugin-starter-templates.generated.ts`.
 *
 * Leaf imports only, for the reason `starter-templates.ts` states: this is
 * read from the console's client gallery, its seed route and a plugin's
 * server alike, so it imports a canvas constant and nothing that drags in
 * either barrel.
 *
 * PERSISTED IDENTIFIERS: `StarterTemplate.id`, `StarterTemplateScreen.key`
 * and every node id a starter builds appear in stored documents (seeded
 * template doc ids are derived from the first two). They must never be
 * renamed.
 */
export interface StarterTemplateScreen {
  /**
   * Stable, starter-local key. Part of the seeded document id, so it is a
   * persisted identifier — never rename one.
   */
  key: string
  displayName: string
  description?: string
  /**
   * Routing-map slug. `SCREEN_ROOT_PATH` (`'/'`) asks for the site root — the
   * home page — and anything else is a single path segment.
   *
   * It used to be `''` that meant home, which no normalizer agreed with: both
   * the apply path and the seed below read an empty string as "no address
   * authored" and derived one from the display name, so the shop starters'
   * home page was published at `/home` and the site 404'd at its own URL
   * (AGL-1575).
   */
  slug: string
  seo?: { title?: string; description?: string }
  /** Flat node map including the canvas root. */
  nodes: Record<string, any>
}

export interface StarterTemplate {
  id: string
  displayName: string
  description: string
  category: string
  screens: StarterTemplateScreen[]
}

/** A materialized starter template document, keyed by its deterministic id. */

export type StarterNodeSpec = {
  id: string
  componentId: string
  /** Bundle owning the component; defaults to 'mui' (AGL-300). */
  pluginId?: string
  props?: Record<string, unknown>
  /**
   * Node-level styles — a SIBLING of props, never `props.sx` (AGL-1346).
   *
   * Both records render (`Leaf` composes `(sx, props.sx, node.sx)`, later
   * wins), but the Styles panel edits `node.sx`. A starter that seeded its
   * styling into `props.sx` handed the author a document full of values
   * the panel could show but no click could change or clear.
   */
  sx?: Record<string, unknown>
  /**
   * What the element does when a visitor acts on it, stored on the node as
   * the interactions editor stores it (AGL-2867) — a button that scrolls to
   * a section of its own page, for one.
   */
  interactions?: NodeInteraction[]
  children?: StarterNodeSpec[]
}

/** Builds the flat, persisted node map from a nested spec. */
export function buildStarterNodes(children: StarterNodeSpec[]): Record<string, any> {
  const map: Record<string, any> = {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      nodes: children.map((child) => child.id),
    },
  }
  const walk = (spec: StarterNodeSpec, parentId: string) => {
    map[spec.id] = {
      $id: spec.id,
      componentId: spec.componentId,
      pluginId: spec.pluginId ?? 'mui',
      parentId,
      props: spec.props ?? {},
      ...(spec.sx ? { sx: spec.sx } : {}),
      ...(spec.interactions?.length ? { interactions: spec.interactions } : {}),
      nodes: (spec.children ?? []).map((child) => child.id),
    }
    for (const child of spec.children ?? []) walk(child, spec.id)
  }
  for (const child of children) walk(child, CANVAS_ROOT_ELEMENT_ID)
  return map
}

/** One line of a starter's copy: a `muiTypography` of the given variant. */
export const starterText = (
  id: string,
  variant: string,
  children: string,
  extra?: Record<string, unknown>,
): StarterNodeSpec => ({
  id,
  componentId: 'muiTypography',
  props: { variant, children, ...extra },
})

/**
 * The stock widths a starter band may be (AGL-1932, AGL-1298).
 *
 * Three cases, and only three, because the standard has three. There is no
 * pixel case: `1328` is a CONTENT width, not a breakpoint, and the ban on
 * bespoke numbers is the half of AGL-1298 these templates used to violate
 * four times over.
 */
export type StarterSectionWidth = 'md' | 'lg' | 'xl'

/**
 * One page band: a `Container` at a stock width, carrying the band's own
 * vertical rhythm (AGL-1932).
 *
 * The layout standard (AGL-1298): every section is a Container. Full-bleed is
 * the Container's own full-width attribute, never the absence of a Container,
 * and anything else is one of three stock widths. A template that seeds no
 * Container hands every customer a site that starts outside the standard.
 *
 * How the three widths are chosen here, stated so the next audit does not
 * have to guess:
 *
 * - `xl` — a marketing band: hero, feature row, product grid, gallery. The
 *   default width, and what an unremarkable page should be.
 * - `lg` — the deliberate middle case: wide but text-led and interactive.
 *   Cart and account are the honest instances, not decoration.
 * - `md` — long-form prose and narrow form columns, on READING grounds: at
 *   `xl` a paragraph runs 110–120 characters a line. This is the case the
 *   `Prose Container` preset exists for.
 *
 * Horizontal padding is the Container's own gutters, so bands no longer carry
 * horizontal padding at all. Only the vertical rhythm rides here, which is
 * rhythm rather than width.
 *
 * Written as the two longhands rather than MUI's `py` (AGL-2207/2208): the
 * Styles panel's Padding control is named for the four sides, so a band
 * seeded with `py` handed the customer a document whose padding the panel
 * showed as empty and no click could clear.
 */
export const starterSection = (
  id: string,
  maxWidth: StarterSectionWidth,
  verticalPadding: number,
  children: StarterNodeSpec[],
): StarterNodeSpec => ({
  id,
  componentId: 'muiContainer',
  props: { maxWidth },
  sx: { paddingTop: verticalPadding, paddingBottom: verticalPadding },
  children,
})

/**
 * The hero band a starter page opens with: a headline, a tagline and a call
 * to action, centered in an `xl` band. Its node ids are `prefix` plus fixed
 * names, so a starter's prefix keeps them its own.
 */
export const starterHeroSection = (
  prefix: string,
  headline: string,
  tagline: string,
): StarterNodeSpec =>
  // The Container is a NEW node (`…heroSection`); `…hero` keeps its id and
  // stays the Stack. Node ids here are persisted identifiers, so bands are
  // wrapped rather than re-pointed.
  starterSection(`${prefix}heroSection`, 'xl', 10, [
    {
      id: `${prefix}hero`,
      componentId: 'muiStack',
      props: { spacing: 2 },
      sx: { alignItems: 'center' },
      children: [
        starterText(`${prefix}heroTitle`, 'h2', headline, { align: 'center' }),
        starterText(`${prefix}heroSub`, 'h6', tagline, { align: 'center' }),
        {
          id: `${prefix}heroCta`,
          componentId: 'muiButton',
          props: {
            variant: 'contained',
            size: 'large',
            children: 'Get in touch',
          },
        },
      ],
    },
  ])
