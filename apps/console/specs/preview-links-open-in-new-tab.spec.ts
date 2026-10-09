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
 * PREVIEW AND VIEW LINKS OPEN IN A NEW TAB (AGL-3660).
 *
 * "Links like preview and view should always open in new tab." The
 * Components list's eye-icon Preview opened the canvas render in the list's
 * own tab, and so did Layouts, Templates and Forms — the reader lost their
 * place in the list to glance at one row. The behaviour now lives in one
 * spelling (`@aglyn/shared-ui-jsx/utils/new-tab`, `AppLink newTab`, the quick
 * action's `newTab`, a menu item's `external`) and this file is what keeps
 * the next list from wiring its Preview the old way.
 *
 * It reads SOURCE, because the regression it guards against is an attribute
 * that is not there, and no rendered test of the lists that exist can see the
 * list that does not yet. Four shapes are checked, across the console and
 * every plugin:
 *
 * 1. A `ListRowActions` quick action that is a preview or view (eye /
 *    open-in-new icon, or a Preview / View / Visit / Open live label) and
 *    navigates with `to:` carries `newTab: true`. (`href:` is always a new
 *    tab; `onClick` alone is a dialog that renders in place, and is fine.)
 * 2. A row-menu item that is a preview or view and carries `href:` also
 *    carries `external: true`.
 * 3. A JSX control whose label is Preview / View / Visit… or whose icon is
 *    the eye, and that has an `href`, says `newTab`, `target="_blank"` or
 *    spreads `newTabLinkProps`.
 * 4. No `router.push` / `router.replace` / `location.assign` /
 *    `location.href =` goes to a preview route.
 *
 * Not in scope, deliberately: a row's NAME opening its editor or detail page
 * (that is in-app navigation, not a glance), and a dialog that renders a
 * preview in place.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')
const ROOTS = [join(REPO, 'apps', 'console'), join(REPO, 'libs', 'plugins')]

const posix = (path: string) => relative(REPO, path).split(sep).join('/')

function sourcesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'native' ||
      entry.name.startsWith('.')
    ) {
      continue
    }
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourcesUnder(path))
      continue
    }
    if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.includes('.spec.') &&
      !entry.name.includes('.test.') &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(path)
    }
  }
  return found
}

/** Icons that SAY "look at this" or "this opens elsewhere". */
const PREVIEW_ICON = /\b(mdiEyeOutline|mdiEye|ICON_VARIANT_VISIBILITY_SHOWN|mdiOpenInNew|ICON_VARIANT_NEW_TAB)\b/

/** Labels that are a preview or a view of something, not an editor. */
const PREVIEW_LABEL =
  /^(Preview|Open preview|Open design preview|Preview on site|View|View [a-z ]*(site|page|member|account|organization|message|live)|View on site|View live|View your site|Visit|Visit site|Visit live site|Visit live page|Open live page|Live)$/

/** Given the index of an `{`, the index just past its matching `}`. */
function closeBrace(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return source.length
}

/** The object literal around `index`: the nearest unmatched `{` before it. */
function enclosingObject(source: string, index: number): [number, number] {
  let depth = 0
  for (let i = index; i >= 0; i--) {
    const ch = source[i]
    if (ch === '}') depth++
    else if (ch === '{') {
      if (depth === 0) return [i, closeBrace(source, i)]
      depth--
    }
  }
  return [0, source.length]
}

const lineOf = (source: string, index: number) =>
  source.slice(0, index).split('\n').length

const labelOf = (block: string) =>
  /\blabel:\s*['"`]([^'"`]+)['"`]/.exec(block)?.[1]

/** Rule 1: quick actions. */
function quickActionViolations(source: string): number[] {
  const out: number[] = []
  for (const match of source.matchAll(/\bquick(?:=\{\{|:\s*\{)/g)) {
    const open = (match.index ?? 0) + match[0].length - 1
    const block = source.slice(open, closeBrace(source, open))
    const label = labelOf(block)
    const previewish =
      PREVIEW_ICON.test(block) || (label != null && PREVIEW_LABEL.test(label))
    if (!previewish) continue
    if (/\bto:/.test(block) && !/\bnewTab:\s*true\b/.test(block)) {
      out.push(lineOf(source, open))
    }
  }
  return out
}

/** Rule 2: overflow-menu items. */
function menuItemViolations(source: string): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const match of source.matchAll(/\blabel:\s*['"`]([^'"`]+)['"`]/g)) {
    const [start, end] = enclosingObject(source, match.index ?? 0)
    if (seen.has(start)) continue
    seen.add(start)
    // A quick action is rule 1's, and `href` there is always a new tab.
    if (/\bquick(?:=\{|:\s*)$/.test(source.slice(Math.max(0, start - 8), start))) {
      continue
    }
    const block = source.slice(start, end)
    if (!/\bhref:/.test(block)) continue
    const previewish =
      PREVIEW_LABEL.test(match[1]) ||
      /\b(mdiEyeOutline|ICON_VARIANT_VISIBILITY_SHOWN)\b/.test(block)
    if (previewish && !/\bexternal:\s*true\b/.test(block)) {
      out.push(lineOf(source, start))
    }
  }
  return out
}

/** The opening tag that ends at `gt` (the index of its `>`). */
function openingTagBefore(source: string, gt: number): string | null {
  let depth = 0
  for (let i = gt - 1; i >= 0; i--) {
    const ch = source[i]
    if (ch === '}') depth++
    else if (ch === '{') depth--
    else if (ch === '<' && depth === 0 && /[A-Za-z]/.test(source[i + 1] ?? '')) {
      return source.slice(i, gt + 1)
    }
  }
  return null
}

/** Given the `<` of an opening tag, the index of its closing `>`. */
function openingTagEnd(source: string, lt: number): number {
  let depth = 0
  for (let i = lt + 1; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return i
  }
  return source.length
}

/**
 * The opening tag whose ATTRIBUTES hold `index` — skipping the icon element
 * itself, so `startIcon={<MdiIcon path={mdiEyeOutline.path} />}` answers
 * with the button that carries it.
 */
function tagAround(source: string, index: number): string | null {
  for (let i = index; i >= Math.max(0, index - 4000); i--) {
    if (source[i] !== '<') continue
    const name = /^<([A-Za-z][\w.]*)/.exec(source.slice(i, i + 64))?.[1]
    if (!name) continue
    const end = openingTagEnd(source, i)
    if (end < index) return null
    if (/Icon$/.test(name)) continue
    return source.slice(i, end + 1)
  }
  return null
}

const NEW_TAB_ATTR = /\bnewTab\b|target=\{?\s*['"]_blank['"]|\.\.\.newTabLinkProps\b/

/** Rule 3: JSX controls labelled or iconed as a preview / view. */
function jsxViolations(source: string): number[] {
  const out: number[] = []
  // `>{'Preview'}<` and `>Preview<`, allowing whitespace around the text.
  const text = />\s*(?:\{\s*['"]([^'"{}]+)['"]\s*\}|([A-Z][A-Za-z ]+?))\s*</g
  for (const match of source.matchAll(text)) {
    const label = (match[1] ?? match[2] ?? '').trim()
    if (!PREVIEW_LABEL.test(label)) continue
    const tag = openingTagBefore(source, match.index ?? 0)
    if (!tag || !/\bhref=/.test(tag)) continue
    if (!NEW_TAB_ATTR.test(tag)) out.push(lineOf(source, match.index ?? 0))
  }
  // An eye icon on a linked control, whatever its text says.
  for (const match of source.matchAll(/\b(mdiEyeOutline|ICON_VARIANT_VISIBILITY_SHOWN)\b/g)) {
    const tag = tagAround(source, match.index ?? 0)
    if (!tag) continue
    if (/\bhref=/.test(tag) && !NEW_TAB_ATTR.test(tag)) {
      out.push(lineOf(source, match.index ?? 0))
    }
  }
  return out
}

/** Rule 4: a handler that takes the console's own tab to a preview. */
function sameTabNavigationViolations(source: string): number[] {
  const out: number[] = []
  const nav =
    /(?:\brouter\.(?:push|replace)|\blocation\.assign)\(([^)]*)\)|\blocation\.href\s*=\s*([^\n;]+)/g
  for (const match of source.matchAll(nav)) {
    const target = match[1] ?? match[2] ?? ''
    if (/PREVIEW|[pP]review/.test(target)) out.push(lineOf(source, match.index ?? 0))
  }
  return out
}

function violations(source: string): number[] {
  return [
    ...quickActionViolations(source),
    ...menuItemViolations(source),
    ...jsxViolations(source),
    ...sameTabNavigationViolations(source),
  ].sort((a, b) => a - b)
}

describe('the sweep can see a same-tab preview', () => {
  // Premise guards: a pattern that matches nothing would pass every case
  // below against an empty set.
  it.each([
    [
      'an eye-icon quick action on an in-app route',
      `<ListRowActions quick={{ icon: mdiEyeOutline.path, label: 'Preview', to: buildRoute(Route.LAYOUT_PREVIEW, ids) }} items={[]} />`,
    ],
    [
      'a View quick action on an in-app route',
      `<ListRowActions quick={{ icon: mdiAccount.path, label: 'View member', to: memberHref(uid) }} items={[]} />`,
    ],
    [
      'a Preview menu item with a same-tab href',
      `const items = [{ key: 'preview', label: 'Open preview', href: previewHref(id) }]`,
    ],
    [
      'an eye-icon menu item with a same-tab href',
      `const items = [{ key: 'x', label: 'Peek', icon: <MdiIcon path={mdiEyeOutline.path} />, href: h }]`,
    ],
    [
      'a Preview link button',
      `<AppLink componentVariant="button" href={buildRoute(Route.SCREEN_PREVIEW, ids)}>{'Preview'}</AppLink>`,
    ],
    [
      'a Visit site anchor',
      `<Button href={liveUrl} variant="outlined">\n  Visit site\n</Button>`,
    ],
    [
      'an eye-icon link button',
      `<AppLink href={h} startIcon={<MdiIcon path={mdiEyeOutline.path} />}>{'Look'}</AppLink>`,
    ],
    [
      'a router.push to a preview route',
      `onClick={() => router.push(buildRoute(Route.COMPONENT_PREVIEW, ids))}`,
    ],
    ['a location.href to a preview', `window.location.href = previewUrl`],
  ])('%s', (_name, source) => {
    expect(violations(source)).not.toEqual([])
  })

  it.each([
    [
      'a quick action with newTab',
      `<ListRowActions quick={{ icon: mdiEyeOutline.path, label: 'Preview', newTab: true, to: r }} items={[]} />`,
    ],
    [
      'an external quick action',
      `<ListRowActions quick={{ icon: mdiOpenInNew.path, label: 'Open live page', href: liveUrl }} items={[]} />`,
    ],
    [
      'a dialog preview that renders in place',
      `<ListRowActions quick={{ icon: mdiEyeOutline.path, label: 'View message', onClick: () => setMessage(row) }} items={[]} />`,
    ],
    [
      'an external menu item',
      `const items = [{ key: 'preview', label: 'Open preview', href: h, external: true }]`,
    ],
    [
      'an in-app detail item',
      `const items = [{ key: 'details', label: 'View details', icon: <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} />, href: h }]`,
    ],
    [
      'a newTab link button',
      `<AppLink componentVariant="button" href={h} newTab>{'Preview'}</AppLink>`,
    ],
    [
      'a spread of newTabLinkProps',
      `<Button href={h} {...newTabLinkProps}>{'Visit live site'}</Button>`,
    ],
    [
      'a target=_blank anchor',
      `<Link href={h} target="_blank" rel="noreferrer">{'View'}</Link>`,
    ],
    ['a dialog Preview button', `<Button onClick={() => void openPreview()}>{'Preview'}</Button>`],
    ['a router.push to a detail page', `router.push(buildRoute(Route.ADMIN_SITE_DETAIL, ids))`],
  ])('and lets %s through', (_name, source) => {
    expect(violations(source)).toEqual([])
  })
})

describe('console and plugins: every preview / view link opens a new tab', () => {
  const files = ROOTS.flatMap(sourcesUnder).map((path) => ({
    path: posix(path),
    source: readFileSync(path, 'utf8'),
  }))

  it('reads the sources it means to sweep', () => {
    expect(files.length).toBeGreaterThan(1000)
    // The lists that started this (AGL-3660) are in the set, so a moved
    // directory cannot quietly empty the sweep.
    const paths = new Set(files.map(({ path }) => path))
    expect(paths).toContain('apps/console/components/host-components-card.component.tsx')
    expect(paths).toContain('libs/plugins/forms/src/lib/components/host-forms-card.component.tsx')
  })

  it('finds no same-tab preview or view action', () => {
    const offenders = files.flatMap(({ path, source }) =>
      violations(source).map((line) => `${path}:${line}`),
    )
    expect(offenders).toEqual([])
  })
})
