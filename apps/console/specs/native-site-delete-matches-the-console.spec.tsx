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
 * THE NATIVE DELETE SITE SCREEN SAYS WHAT THE CONSOLE'S CARD SAYS (AGL-4003).
 *
 * `core.site.delete` (libs/native/screens/site.screens.json) reads the same
 * `GET /api/hosts/delete` preview as the console's Delete site card and lists
 * the datasets that go with the site before it asks. This drives the card
 * through each state the preview can be in (datasets going, one going, none,
 * nothing listed, a plugin that could not answer) and reads the native
 * screen's blocks over the same answer, so every sentence, row and the
 * confirm match word for word.
 *
 * The native evaluator below covers the part of the spec grammar this screen
 * uses (docs/mobile/native-architecture.md §13); both renderers replay the
 * same forms from `template-cases.json` (`siteErase*`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockAuthorizedFetch = jest.fn()
const mockConfirm = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('../hooks/use-host', () => ({
  __esModule: true,
  useHost: () => ({ doc: { data: { displayName: 'Laurel Fork', memberRoles: { 'u-1': 'admin' } } } }),
}))
jest.mock('../hooks/use-org-scope', () => ({ __esModule: true, useOrgSlug: () => 'acme' }))
jest.mock('next/navigation', () => ({ __esModule: true, useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  CardDisplay: (props: { header: string; children: unknown }) => (
    <section aria-label={props.header}>{props.children as never}</section>
  ),
}))
jest.mock('../constants/docs-links', () => ({ __esModule: true, docsHelp: () => null }))
jest.mock('../constants/route-links', () => ({
  __esModule: true,
  buildRoute: () => '/acme/hosts',
  Route: { HOST_LIST: 'HOST_LIST' },
}))

import DeleteSiteCard, { type DeleteSitePreview } from '../components/delete-site-card.component'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
interface Block {
  type: string
  when?: string
  title?: string
  text?: string
  items?: string | Json[]
  primary?: string
  secondary?: Array<{ text: string; when?: string }>
}
interface Action {
  id: string
  label: string
  url: string
  promptTitle?: string
  submitLabel?: string
  confirm: Array<{ text: string; when?: string }>
  prompt: Array<{ key: string; label: string; mustMatch?: string }>
  body: Record<string, string>
  success: string
}
interface Screen {
  id: string
  load: Record<string, { url: string; optional?: boolean }>
  derive: Array<{ name: string; when: string }>
  blocks: Block[]
}

const repo = join(__dirname, '../../..')
const spec = (
  JSON.parse(readFileSync(join(repo, 'libs/native/screens/site.screens.json'), 'utf8')) as {
    screens: Screen[]
  }
).screens.find((entry) => entry.id === 'core.site.delete') as Screen
const deleteAction = (spec.blocks.find((block) => block.type === 'actions')?.items as unknown as Action[])[0]

// --- The subset of the native template grammar this screen uses. -----------------------------

function segments(path: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const character of path) {
    if (character === '[') depth += 1
    if (character === ']') depth -= 1
    if (character === '.' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += character
  }
  parts.push(current)
  return parts
}

function step(value: Json | undefined, key: string): Json | undefined {
  if (Array.isArray(value)) {
    if (key === 'length') return value.length
    return /^-?\d+$/.test(key) ? value[Number(key)] : undefined
  }
  return value && typeof value === 'object' ? value[key] : undefined
}

function lookup(path: string, root: Json, from: Json | undefined = root): Json | undefined {
  const parts = segments(path.trim())
  let current = from
  for (let at = 0; at < parts.length; at += 1) {
    const raw = parts[at] as string
    if (raw === '*') {
      if (!Array.isArray(current)) return undefined
      const rest = parts.slice(at + 1).join('.')
      return current
        .map((row) => (rest ? lookup(rest, root, row) : row))
        .filter((value) => value !== null && value !== undefined)
        .flatMap((value) => (Array.isArray(value) ? value : [value as Json]))
    }
    const open = raw.indexOf('[')
    const name = open >= 0 ? raw.slice(0, open) : raw
    if (name) current = step(current, name)
    for (const group of open >= 0 ? (raw.slice(open + 1, -1).split('][') as string[]) : []) {
      const rows = Array.isArray(current) ? current : []
      if (group.startsWith('?')) {
        current = rows.filter((row) => condition(group.slice(1), { ...(root as object), item: row }))
      } else {
        const [field, wanted] = group.split('=') as [string, string]
        const match = /^'.*'$/.test(wanted) ? wanted.slice(1, -1) : text(lookup(wanted, root))
        current = rows.find((row) => text(lookup(field, row)) === match)
      }
    }
  }
  return current
}

function text(value: Json | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  return String(value)
}

function truthy(value: Json | undefined): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(value)
}

function render$(template: string, context: Json): string {
  return template.replace(/\{([^}]*)\}/g, (_, expression: string) => {
    const colon = expression.lastIndexOf(':')
    const quoted = (expression.slice(colon).match(/'/g) ?? []).length % 2 === 1
    const [path, format] = colon >= 0 && !quoted ? [expression.slice(0, colon), expression.slice(colon + 1)] : [expression, '']
    const value = lookup(path, context)
    if (format === 'title') return text(value).charAt(0).toUpperCase() + text(value).slice(1)
    if (format === 'count') return typeof value === 'number' ? value.toLocaleString('en-US') : String(Array.isArray(value) ? value.length : 0)
    return text(value)
  })
}

function clause(raw: string, context: Json): boolean {
  const body = raw.trim()
  if (!body.includes('==') && !body.includes('!=')) {
    for (const op of ['>=', '<=', '>', '<'] as const) {
      const at = body.indexOf(op)
      if (at < 0) continue
      const left = lookup(body.slice(0, at), context)
      const right = Number(body.slice(at + op.length).trim())
      if (typeof left !== 'number') return false
      return op === '>=' ? left >= right : op === '<=' ? left <= right : op === '>' ? left > right : left < right
    }
  }
  for (const op of ['!=', '=='] as const) {
    const at = body.indexOf(op)
    if (at < 0) continue
    const left = text(lookup(body.slice(0, at), context))
    let right = body.slice(at + 2).trim()
    if (/^'.*'$/.test(right)) right = right.slice(1, -1)
    const options = right.split(',').map((option) => option.trim())
    return op === '==' ? options.includes(left) : !options.includes(left)
  }
  if (body.startsWith('!')) return !truthy(lookup(body.slice(1), context))
  return truthy(lookup(body, context))
}

function condition(expression: string | undefined, context: Json): boolean {
  if (!expression?.trim()) return true
  return expression.split('||').some((either) => either.split('&&').every((part) => clause(part, context)))
}

/** The screen's context over a route answer (`undefined`: the optional load failed). */
function nativeContext(answer: DeleteSitePreview | undefined): Json {
  const context: { [key: string]: Json } = {
    site: { id: 'host-1', name: 'Laurel Fork' },
    data: { erase: (answer ?? null) as unknown as Json },
  }
  const flags: { [key: string]: Json } = {}
  for (const entry of spec.derive) flags[entry.name] = condition(entry.when, { ...context, is: flags })
  return { ...context, is: flags }
}

/** Every sentence the native screen shows over that answer, in order, and its rows as `name · count`. */
function nativeShows(answer: DeleteSitePreview | undefined): { sentences: string[]; rows: string[] } {
  const context = nativeContext(answer)
  const sentences: string[] = []
  const rows: string[] = []
  for (const block of spec.blocks.filter((entry) => condition(entry.when, context))) {
    if (block.type === 'notice') sentences.push(render$(block.text ?? '', context))
    if (block.type === 'list') {
      sentences.push(render$(block.title ?? '', context))
      for (const item of (lookup(block.items as string, context) as Json[]) ?? []) {
        const scope = { ...(context as object), item } as Json
        const secondary = (block.secondary ?? [])
          .filter((part) => condition(part.when, scope))
          .map((part) => render$(part.text, scope))
          .filter(Boolean)
          .join(' · ')
        rows.push(`${render$(block.primary ?? '', scope)} · ${secondary}`)
      }
    }
  }
  return { sentences, rows }
}

function nativeConfirm(answer: DeleteSitePreview | undefined): string {
  const context = nativeContext(answer)
  return deleteAction.confirm
    .filter((part) => condition(part.when, context))
    .map((part) => render$(part.text, context))
    .join('')
}

// --- The console's card over the same answers. --------------------------------------------------

const NOUNS = { noun: ['dataset', 'datasets'] as const, itemNoun: ['record', 'records'] as const }
const answer = (going: Array<{ id: string; name: string; items: number | null }>, staying: number): DeleteSitePreview => ({
  resources: [{ pluginId: 'data', preview: { ...NOUNS, going, staying } }],
})
const STATES: Array<[string, DeleteSitePreview | undefined]> = [
  [
    'several datasets go, one not counted, two stay',
    answer(
      [
        { id: 'ds-1', name: 'Gallery collections', items: 1234 },
        { id: 'ds-2', name: 'Photography packages', items: 0 },
        { id: 'ds-3', name: 'Leads', items: null },
      ],
      2,
    ),
  ],
  ['one dataset goes, one stays', answer([{ id: 'ds-1', name: 'Menu', items: 1 }], 1)],
  ['none go', answer([], 0)],
  ['the workspace has nothing to list', { resources: [] }],
  ['a plugin could not answer', { resources: [{ pluginId: 'data', preview: null }] }],
  ['the route did not answer (production before the GET ships)', undefined],
]

/** What the card shows over that answer: its sentences (description first) and its rows. */
async function cardShows(preview: DeleteSitePreview | undefined) {
  mockAuthorizedFetch.mockResolvedValue(
    preview
      ? { ok: true, json: async () => preview }
      : { ok: false, json: async () => ({ error: 'Method not allowed' }) },
  )
  const { container, unmount } = render(<DeleteSiteCard hostId="host-1" />)
  await waitFor(() => expect(screen.queryByText(/Checking which datasets go/)).toBeNull())
  const sentences = Array.from(container.querySelectorAll('p.MuiTypography-root, h6.MuiTypography-root'))
    .filter((node) => !node.closest('li'))
    .map((node) => node.textContent ?? '')
    .filter(Boolean)
  const rows = Array.from(container.querySelectorAll('li')).map((node) =>
    Array.from(node.querySelectorAll('.MuiListItemText-primary, .MuiListItemText-secondary'))
      .map((part) => part.textContent)
      .join(' · '),
  )
  fireEvent.change(screen.getByLabelText('Type "Laurel Fork" to confirm'), { target: { value: 'Laurel Fork' } })
  mockConfirm.mockRejectedValueOnce(new Error('kept'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete site' }))
  await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
  const confirm = mockConfirm.mock.calls[0]?.[0] as { title: string; description: string; confirmationText: string }
  unmount()
  return { sentences, rows, confirm }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the native Delete site screen matches the console card (AGL-4003)', () => {
  it('reads the preview from the route the card reads, and still opens when it cannot', () => {
    expect(spec.load['erase']).toEqual({ url: '/api/hosts/delete?hostId={site.id}', optional: true })
    expect(deleteAction.url).toBe('/api/hosts/delete')
    expect(deleteAction.body).toEqual({ hostId: '{site.id}' })
    const route = readFileSync(join(repo, 'apps/console/app/api/hosts/delete/route.ts'), 'utf8')
    expect(route).toContain('export { handler as POST, preview as GET }')
  })

  it.each(STATES)('says what the card says when %s', async (_, preview) => {
    const card = await cardShows(preview)
    const native = nativeShows(preview)
    expect(native.sentences).toEqual(card.sentences)
    expect(native.rows).toEqual(card.rows)
    expect(nativeConfirm(preview)).toBe(card.confirm.description)
  })

  it('asks the way the card asks', async () => {
    const card = await cardShows(answer([], 0))
    const context = nativeContext(answer([], 0))
    expect(render$(deleteAction.promptTitle ?? '', context)).toBe(card.confirm.title)
    expect(render$(deleteAction.submitLabel ?? '', context)).toBe(card.confirm.confirmationText)
    expect(deleteAction.label).toBe('Delete site')
    expect(render$(deleteAction.prompt[0]?.label ?? '', context)).toBe('Type "Laurel Fork" to confirm')
    expect(deleteAction.prompt[0]?.mustMatch).toBe('{site.name}')
  })

  it('lists the one plugin that shares resources with a site (extend the screen when another does)', () => {
    // The screen names the data plugin's group (`resources[pluginId='data']`); a second plugin registering a
    // site-resource eraser needs its own rows on core.site.delete, as the console card lists every group.
    const found: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (name === 'node_modules' || name.startsWith('.')) continue
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) {
          if (readFileSync(path, 'utf8').includes('registerPluginSiteResourceEraser(')) found.push(relative(repo, path))
        }
      }
    }
    walk(join(repo, 'libs/plugins'))
    expect(found).toEqual(['libs/plugins/data/src/lib/declarations.server.ts'])
    expect(JSON.stringify(spec)).toContain("resources[pluginId='data']")
  })
})
