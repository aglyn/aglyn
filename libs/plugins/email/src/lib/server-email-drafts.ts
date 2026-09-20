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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { uniqueDuplicateName } from '@aglyn/aglyn/app-utils/duplicate-resource'
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import {
  NON_PAGE_SCREEN_MAX_PER_HOST,
  nonPageScreenIds,
  SCREEN_KIND_EMAIL,
  type BillableScreenSource,
} from '@aglyn/aglyn/app-utils/screen-route'
import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftCheck,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { hasSafeLinkScheme } from '@aglyn/shared-util-http/safe-url-scheme'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  emailPlainTextState,
  renderRecipientEmail,
} from '@aglyn/aglyn/app-utils/recipient-email-render'
import { emailDesignDocuments } from './model/email-design-document'

/**
 * AN EMAIL DESIGN ANOTHER PLUGIN ASKS FOR (AGL-2912).
 *
 * The draft writer this plugin registers for the `emailDesign` resource on the
 * core's resource-drafts seam. A plugin that produces an email — a generator
 * working from a brief, an importer bringing templates over — asks for the
 * writer by name and gets this plugin's rules, never a copy of them:
 *
 *  - THE DOCUMENTS are the pair `createEmailScreen` makes, built by the same
 *    function (`emailDesignDocuments`): a `kind: 'email'` screen and its first
 *    version. So the design lists on the Templates tab, opens in the besigner
 *    and is offered by the campaign composer like one a person made. The
 *    screen carries the subject and preheader a campaign built from it opens
 *    on, and the other lines worth trying beside them.
 *  - THE ROOM is the flat platform ceiling on non-page screens, met inside the
 *    transaction with the arithmetic `/api/hosts/resources` and the duplicate
 *    module use, and refused in their words.
 *  - THE ROLE is the resources route's: a member who may write the site's
 *    content.
 *  - THE CHECK renders the design through `renderRecipientEmail`, the function
 *    the send path and the composer's preview both call, so content that
 *    passes is content that would render in both.
 *
 * Nothing is sent, scheduled or routed. A design is inert until a campaign
 * names it, and the writer touches the two new documents and nothing else.
 */

type Firestore = FirebaseFirestore.Firestore

/** The resource name this writer is registered under. */
export const EMAIL_DESIGN_DRAFT_RESOURCE = 'emailDesign'

/** The id `plugins.config.json` registers this plugin under. */
const EMAIL_PLUGIN_ID = 'email'

/** A design's name when the caller asks for none, as the composer's create names one. */
export const EMAIL_DESIGN_DEFAULT_NAME = 'Untitled email'

/** The longest subject or preheader stored, the send route's header cap. */
export const EMAIL_DESIGN_HEADER_MAX_CHARS = 200

/** The most alternative subject lines or preheaders a design keeps. */
export const EMAIL_DESIGN_MAX_VARIANTS = 10

/** The resources route's refusal at the non-page ceiling. */
export const EMAIL_DESIGN_LIMIT_REFUSAL =
  'This site is at its limit of ' +
  `${NON_PAGE_SCREEN_MAX_PER_HOST} email and template screens — ` +
  'delete some to make room'

/** The resources route's refusal for a member who may not write the site. */
export const EMAIL_DESIGN_ROLE_REFUSAL = 'Editing requires the editor role'

/*
 * What the check renders against. No mail is sent and nothing is fetched: the
 * origin makes the renderer keep images and links it would drop without one,
 * and the recipient fills the merge tokens a real send would fill.
 */
const CHECK_SITE_BASE = 'https://example.com'
const CHECK_RECIPIENT = { email: 'reader@example.com', name: 'Sample Reader' }

/** One node of a design, as far as the writer reads it. */
export interface EmailDesignNode {
  componentId?: unknown
  props?: Record<string, unknown>
  nodes?: unknown
}

/**
 * What a caller sends as `content`: the node map rooted at the canvas root,
 * the subject and preheader, and the alternatives to them.
 */
export interface EmailDesignDraftContent {
  nodes: Record<string, EmailDesignNode>
  subject: string
  preheader: string
  subjectVariants: string[]
  preheaderVariants: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A header value on one line: controls and runs of space folded to one space. */
function headerLine(value: unknown): string {
  return String(value ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim()
}

/** Alternatives as the design keeps them: on one line, unique, non-empty, bounded. */
function variantsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const lines: string[] = []
  for (const raw of value) {
    const line = headerLine(raw)
    const key = line.toLowerCase()
    if (!line || seen.has(key)) continue
    seen.add(key)
    lines.push(line)
  }
  return lines.slice(0, EMAIL_DESIGN_MAX_VARIANTS)
}

/** The ids reachable from the canvas root, or the structural problem that stops the walk. */
function reachableIds(nodes: Record<string, EmailDesignNode>): { ids: Set<string>; problems: string[] } {
  const ids = new Set<string>()
  const problems = new Set<string>()
  const stack = [CANVAS_ROOT_ELEMENT_ID]
  while (stack.length) {
    const id = stack.pop() as string
    if (ids.has(id)) {
      problems.add('A block is placed in the design more than once')
      continue
    }
    const node = nodes[id]
    if (!isRecord(node)) {
      problems.add('The design lists a block it does not hold')
      continue
    }
    ids.add(id)
    for (const child of Array.isArray(node.nodes) ? node.nodes : []) {
      if (typeof child === 'string') stack.push(child)
    }
  }
  return { ids, problems: [...problems] }
}

export type EmailDesignContentRead =
  | { ok: true; value: EmailDesignDraftContent; reachable: Set<string> }
  | { ok: false; problems: string[] }

/** The content as the writer stores it, or every problem that stops it. */
export function readEmailDesignContent(content: Readonly<Record<string, unknown>>): EmailDesignContentRead {
  const nodes = content['nodes']
  if (!isRecord(nodes) || !Object.keys(nodes).length) {
    return { ok: false, problems: ['The design has no blocks'] }
  }
  const map = nodes as Record<string, EmailDesignNode>
  if (!isRecord(map[CANVAS_ROOT_ELEMENT_ID])) {
    return { ok: false, problems: ['The design has no root to render from'] }
  }
  const { ids, problems } = reachableIds(map)
  const stranded = Object.keys(map).filter((id) => !ids.has(id)).length
  if (stranded) {
    problems.push(
      `${stranded} ${stranded === 1 ? 'block is' : 'blocks are'} not placed in the design, so ${
        stranded === 1 ? 'it' : 'they'
      } would not be sent`,
    )
  }
  const value: EmailDesignDraftContent = {
    nodes: map,
    subject: headerLine(content['subject']),
    preheader: headerLine(content['preheader']),
    subjectVariants: variantsOf(content['subjectVariants']),
    preheaderVariants: variantsOf(content['preheaderVariants']),
  }
  const long = (lines: string[]) => lines.some((line) => line.length > EMAIL_DESIGN_HEADER_MAX_CHARS)
  if (long([value.subject, ...value.subjectVariants])) {
    problems.push(`A subject line is longer than ${EMAIL_DESIGN_HEADER_MAX_CHARS} characters`)
  }
  if (long([value.preheader, ...value.preheaderVariants])) {
    problems.push(`A preheader is longer than ${EMAIL_DESIGN_HEADER_MAX_CHARS} characters`)
  }
  return problems.length ? { ok: false, problems } : { ok: true, value, reachable: ids }
}

/** Why a link on a block would not open from an inbox, or `null`. */
function linkProblem(label: string, raw: unknown, required: boolean): string | null {
  const written = String(raw ?? '').trim()
  if (/\{\{\s*contact\./.test(written)) {
    return `${label} puts the reader's own details in its link, which is never filled`
  }
  const href = written
    .replace(/\{\{\s*site\.url\s*\}\}/g, CHECK_SITE_BASE)
    .replace(/\{\{\s*unsubscribeUrl\s*\}\}/g, `${CHECK_SITE_BASE}/preferences`)
  if (!href || href === '#') return required ? `${label} links nowhere` : null
  if (href.startsWith('/') && !href.startsWith('//')) {
    return `${label} links to a path with no site in front of it, which an inbox cannot open`
  }
  return hasSafeLinkScheme(href) ? null : `${label} links to something that is not a web address`
}

/**
 * Whether content renders as an email: well-formed, every link one an inbox
 * can open, and a message once rendered through the send path's own renderer.
 */
export function checkEmailDesignContent(
  content: Readonly<Record<string, unknown>>,
  context: { hostId: string },
): PluginDraftCheck {
  const read = readEmailDesignContent(content)
  if (read.ok === false) return read
  const { value, reachable } = read
  const problems: string[] = []
  for (const id of reachable) {
    const node = value.nodes[id]
    if (node.componentId === 'emailButton') {
      const problem = linkProblem('A button', node.props?.['href'], true)
      if (problem) problems.push(problem)
    }
    if (node.componentId === 'emailImage') {
      const problem = linkProblem('An image', node.props?.['href'], false)
      if (problem) problems.push(problem)
    }
  }
  const rendered = renderRecipientEmail({
    subject: value.subject,
    preheader: value.preheader,
    content: {
      mode: 'design',
      template: { nodes: value.nodes, subject: value.subject, preheader: value.preheader },
    },
    recipient: CHECK_RECIPIENT,
    siteBase: CHECK_SITE_BASE,
    hostId: context.hostId,
  })
  if (!rendered.messageText.trim()) {
    problems.push('The design renders no message: it needs at least one block of text')
  }
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  return {
    ok: true,
    facts: {
      htmlBytes: new TextEncoder().encode(rendered.html).length,
      messageText: rendered.messageText,
      blocks: reachable.size,
      // No part is written by hand, so the text a campaign sends is the design's own.
      plainText: emailPlainTextState({}),
    },
  }
}

interface ScreenRow extends BillableScreenSource {
  name: string
}

async function readScreenRows(
  hostRef: FirebaseFirestore.DocumentReference,
  read: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>,
): Promise<ScreenRow[]> {
  const snapshot = await read(hostRef.collection('screens').select('displayName', 'kind', 'deletedAt'))
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    kind: doc.get('kind'),
    deletedAt: doc.get('deletedAt'),
    name: String(doc.get('displayName') ?? ''),
  }))
}

function roleRefusal(host: FirebaseFirestore.DocumentSnapshot, uid: string): PluginDraftRefusal | null {
  const role = (host.get('memberRoles') ?? {})[uid]
  return hostRoleCanWrite(role) ? null : { status: 403, error: EMAIL_DESIGN_ROLE_REFUSAL }
}

function roomRefusal(rows: ScreenRow[], host: FirebaseFirestore.DocumentSnapshot): PluginDraftRefusal | null {
  const used = nonPageScreenIds(rows, host.get('screens') as never).size
  return used >= NON_PAGE_SCREEN_MAX_PER_HOST ? { status: 403, error: EMAIL_DESIGN_LIMIT_REFUSAL } : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function recordOf(screen: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  const versionId = screen.get('versionId')
  return {
    id: screen.id,
    name: String(screen.get('displayName') ?? ''),
    versionId: typeof versionId === 'string' && versionId ? versionId : null,
    facts: {
      subject: String(screen.get('emailSubject') ?? ''),
      preheader: String(screen.get('emailPreheader') ?? ''),
      subjectVariants: strings(screen.get('emailSubjectVariants')),
      preheaderVariants: strings(screen.get('emailPreheaderVariants')),
    },
  }
}

/** The subject, preheader and alternatives as the screen document stores them. */
function copyFields(value: EmailDesignDraftContent): Record<string, unknown> {
  return {
    ...(value.subject ? { emailSubject: value.subject } : {}),
    ...(value.preheader ? { emailPreheader: value.preheader } : {}),
    ...(value.subjectVariants.length ? { emailSubjectVariants: value.subjectVariants } : {}),
    ...(value.preheaderVariants.length ? { emailPreheaderVariants: value.preheaderVariants } : {}),
  }
}

export interface EmailDesignDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
  /** Mints the first version's id. */
  mintId?: () => string
}

export function createEmailDesignDraftWriter(
  deps: EmailDesignDraftWriterDeps = {},
): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  const mintId = deps.mintId ?? createResourceUid
  return {
    refusal: async (context) => {
      const hostRef = firestore().collection('hosts').doc(context.hostId)
      const host = await hostRef.get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      return (
        roleRefusal(host, context.uid) ??
        roomRefusal(await readScreenRows(hostRef, (query) => query.get()), host)
      )
    },

    check: checkEmailDesignContent,

    read: async ({ hostId, id }) => {
      const screen = await firestore().collection('hosts').doc(hostId).collection('screens').doc(id).get()
      return screen.exists && screen.get('kind') === SCREEN_KIND_EMAIL ? recordOf(screen) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      const read = readEmailDesignContent(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const packed = encodeStoredNodes(read.value.nodes)
      if (!packed) return { ok: false, status: 400, error: 'The design has no blocks' }
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const screenRef = hostRef.collection('screens').doc(request.id)
      const versionId = mintId()
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const [host, existing, rows] = await Promise.all([
          tx.get(hostRef),
          tx.get(screenRef),
          readScreenRows(hostRef, (query) => tx.get(query)),
        ])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        if (existing.exists) {
          return existing.get('kind') === SCREEN_KIND_EMAIL
            ? { ok: true, replayed: true, ...recordOf(existing) }
            : { ok: false, status: 409, error: 'That id already names a screen that is not an email design' }
        }
        const refusal = roleRefusal(host, request.uid) ?? roomRefusal(rows, host)
        if (refusal) return { ok: false, ...refusal }
        const name = uniqueDuplicateName(
          headerLine(request.name) || EMAIL_DESIGN_DEFAULT_NAME,
          rows.filter((row) => row.deletedAt == null).map((row) => row.name),
        )
        const { screen, version } = emailDesignDocuments({
          screenId: request.id,
          versionId,
          displayName: name,
          nodes: read.value.nodes,
        })
        const stamps = { createdAt: request.now, updatedAt: request.now, createdBy: request.uid }
        const copy = copyFields(read.value)
        tx.create(screenRef, { ...screen, nameLower: nameSearchKey(name), ...copy, ...stamps })
        tx.create(screenRef.collection('versions').doc(versionId), {
          ...version,
          nodes: Buffer.from(packed),
          hostId: request.hostId,
          ...stamps,
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name,
          versionId,
          facts: {
            subject: read.value.subject,
            preheader: read.value.preheader,
            subjectVariants: read.value.subjectVariants,
            preheaderVariants: read.value.preheaderVariants,
          },
        }
      })
    },
  }
}

export const emailDesignDraftWriter = createEmailDesignDraftWriter()

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerEmailDesignDraftWriter(): void {
  registerPluginResourceDraftWriter(EMAIL_DESIGN_DRAFT_RESOURCE, emailDesignDraftWriter, {
    pluginId: EMAIL_PLUGIN_ID,
  })
}
