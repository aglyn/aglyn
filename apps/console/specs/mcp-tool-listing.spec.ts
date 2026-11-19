/**
 * @jest-environment node
 *
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
 * THE TOOL LIST IS A PUBLIC LISTING (AGL-4225).
 *
 * Connector directories show each tool's title, description and hints to the
 * people deciding whether to connect, and a model chooses tools by them. The
 * Claude directory's scan of the first submission asked for `annotations.title`
 * on all 70 tools and a docs link on every tool that takes a body. This holds
 * the whole list, built from the real document, to what such a listing needs.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { describeApiV1Resources } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { buildCustomerApiOpenApi } from '../utils/api-v1-openapi'
import { buildMcpTools, MCP_BODY_ARGUMENT, type McpTool } from '../utils/mcp-tools'

const DOCS = 'https://docs.example.com/api'
const DOCS_DIR = join(__dirname, '../../docs/api')

let tools: McpTool[]

beforeAll(async () => {
  await registerPluginServerDeclarations()
  tools = buildMcpTools(
    buildCustomerApiOpenApi(
      { origin: 'https://app.example.com', documentationUrl: DOCS, brandName: PLATFORM_BRAND_NAME },
      await describeApiV1Resources(),
    ),
  )
})

/** The description without its docs line. */
const prose = (tool: McpTool) => tool.description.split('\n\nDocs: ')[0]

/** Docusaurus's heading slug: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) =>
  heading
    .replace(/\{#([^}]+)\}\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/[`/]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-')

function anchorsOf(file: string): Set<string> {
  const anchors = new Set<string>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = /^#{2,4}\s+(.*)$/.exec(line)
    if (!heading) continue
    const explicit = /\{#([^}]+)\}\s*$/.exec(heading[1])
    anchors.add(explicit ? explicit[1] : slug(heading[1]))
  }
  return anchors
}

describe('the tool list as a public listing (AGL-4225)', () => {
  it('titles every tool twice, alike: top-level `title` and `annotations.title`', () => {
    for (const tool of tools) {
      expect(tool.title).toBeTruthy()
      expect(tool.annotations.title).toBe(tool.title)
    }
  })

  it('gives every tool a distinct title in sentence case', () => {
    const titles = tools.map((tool) => tool.title)
    expect(new Set(titles).size).toBe(titles.length)
    for (const title of titles) {
      expect(title[0]).toBe(title[0].toUpperCase())
      // After the first word, only names stay capitalised.
      const capitalised = title.split(' ').slice(1).filter((word) => /^[A-Z]/.test(word))
      expect({ title, capitalised: capitalised.filter((word) => !['API'].includes(word)) }).toEqual({
        title,
        capitalised: [],
      })
    }
  })

  it('states all four hints as booleans on every tool', () => {
    for (const tool of tools) {
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
        expect({ tool: tool.name, hint, type: typeof tool.annotations[hint] }).toEqual({
          tool: tool.name,
          hint,
          type: 'boolean',
        })
      }
    }
  })

  it('marks the hints a directory scan found missing, each for a reason the handler shows (AGL-4235)', () => {
    const hints = (name: string) => (tools.find((tool) => tool.name === name) as McpTool).annotations
    // Adding an address the site already holds updates that lead.
    expect(hints('createLead')).toMatchObject({ destructiveHint: true, openWorldHint: true })
    // Unless `private` is true, an upload gets a public link anyone can open.
    for (const name of ['uploadOrgMedia', 'uploadSiteMedia']) {
      expect({ name, ...hints(name) }).toMatchObject({ name, openWorldHint: true, destructiveHint: false })
      expect(prose(tools.find((tool) => tool.name === name) as McpTool)).toContain(
        'Unless `private` is true, the file gets a public link that anyone can open.',
      )
    }
  })

  it('counts 40 tools that only read and 41 that write', () => {
    const reads = tools.filter((tool) => tool.annotations.readOnlyHint).length
    expect({ reads, writes: tools.length - reads }).toEqual({ reads: 40, writes: 41 })
  })

  it('describes every tool in at least a full sentence of its own', () => {
    for (const tool of tools) {
      const text = prose(tool)
      expect({ tool: tool.name, ok: text.length >= 30 && /[.]$/.test(text) }).toEqual({ tool: tool.name, ok: true })
      // The title is shown beside the description, so the description does
      // not open by repeating it.
      expect(text.startsWith(tool.title)).toBe(false)
    }
  })

  it('links every tool to a docs page that exists, on the configured docs origin', () => {
    for (const tool of tools) {
      const link = /\n\nDocs: (\S+)$/.exec(tool.description)?.[1]
      expect({ tool: tool.name, link: Boolean(link) }).toEqual({ tool: tool.name, link: true })
      expect(link?.startsWith(`${DOCS}`)).toBe(true)
      const [page, anchor] = (link as string).slice(DOCS.length).split('#')
      const file = page ? join(DOCS_DIR, `${page.replace(/^\//, '')}.md`) : join(DOCS_DIR, 'overview.md')
      expect({ tool: tool.name, file, exists: existsSync(file) }).toEqual({ tool: tool.name, file, exists: true })
      if (anchor) expect({ tool: tool.name, anchor, found: anchorsOf(file).has(anchor) }).toEqual({ tool: tool.name, anchor, found: true })
    }
  })

  it('carries no implementation narrative, instructions or hidden text', () => {
    const banned = [
      /deliberately/i,
      /on the page/i,
      /narrows on/i,
      /sized to the work/i,
      /minting/i,
      /worse than not advertising/i,
      /is billed/i,
      /introspect/i,
      /\bignore (all |any )?(previous|prior)/i,
      /\byou must\b/i,
      /<!--|<\/?[a-z]+[^>]*>/i,
      /[\u200B-\u200F\u2060-\u2064\uFEFF]/,
    ]
    for (const tool of tools) {
      for (const pattern of banned) {
        expect({ tool: tool.name, pattern: String(pattern), hit: pattern.test(tool.description) || pattern.test(tool.title) }).toEqual({
          tool: tool.name,
          pattern: String(pattern),
          hit: false,
        })
      }
    }
  })

  it('describes every argument, and every member of every body', () => {
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>
      for (const [name, schema] of Object.entries(properties)) {
        expect({ tool: tool.name, name, described: Boolean(schema.description) }).toEqual({ tool: tool.name, name, described: true })
        if (name !== MCP_BODY_ARGUMENT) continue
        for (const [member, field] of Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)) {
          expect({ tool: tool.name, member, described: Boolean(field.description) }).toEqual({ tool: tool.name, member, described: true })
        }
      }
    }
  })

  it('marks what a create needs as required, and a lead’s site on every lead tool', () => {
    const required = (name: string) => {
      const tool = tools.find((candidate) => candidate.name === name) as McpTool
      const schema = tool.inputSchema as { required?: string[]; properties: Record<string, { required?: string[] }> }
      return { top: schema.required ?? [], body: schema.properties[MCP_BODY_ARGUMENT]?.required ?? [] }
    }
    expect(required('createCompany')).toEqual({ top: ['body'], body: ['name'] })
    expect(required('createTask')).toEqual({ top: ['body'], body: ['title'] })
    expect(required('createDeal')).toEqual({ top: ['body'], body: ['title'] })
    expect(required('createDataset')).toEqual({ top: ['body'], body: ['name', 'fields'] })
    expect(required('createEmailTemplate')).toEqual({ top: ['body'], body: ['name', 'body'] })
    expect(required('createLead').body.sort()).toEqual(['email', 'siteId'])
    // An update needs none of those: it changes only what it is sent.
    expect(required('updateCompany').body).toEqual([])
    for (const name of ['listLeads', 'getLead', 'updateLead', 'convertLead']) {
      expect(required(name).top).toContain('siteId')
    }
    // The conversion's body is optional; its company and deal are described.
    expect(required('convertLead').top).not.toContain(MCP_BODY_ARGUMENT)
  })
})
