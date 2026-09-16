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

import {
  AI_INVENTORY_KINDS,
  AI_INVENTORY_KIND_HEADINGS,
  AI_SITE_INVENTORY_LISTED_PER_KIND,
  aiInventoryHaystack,
  aiInventoryLine,
  aiInventoryRows,
  type AiInventoryKind,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import type { AiTool } from '../providers/contract'

/**
 * "More on request" (AGL-2937): the strict tool a generation calls to find
 * the records its prompt did not list.
 *
 * The site inventory is the one VOLATILE part of a generation prompt — it is
 * different for every site, so it can never sit inside a cached prefix, and
 * every character of it is billed at full input rate on every attempt and on
 * every re-ask. That puts a hard ceiling on how much of a large site a prompt
 * can afford to carry, and doctrine rule 7 puts a floor under it: a plan that
 * cannot see a component reuses nothing and creates a duplicate.
 *
 * So the prompt lists the first `AI_SITE_INVENTORY_LISTED_PER_KIND` records of
 * each kind and says that more exist, and this tool answers for the rest, out
 * of the wider window the reader holds in memory. The answer costs tokens only
 * on the requests that ask for it, where the rows would otherwise have cost
 * them on every request that did not.
 *
 * ## Why it is offered on every request
 *
 * A tool list renders AHEAD of the system blocks and is part of what a cache
 * entry is keyed on, so a tool offered only to the sites big enough to need it
 * would split the platform's one cached prefix in two. It is therefore offered
 * on every request that carries an inventory block at all, whatever the site's
 * size, and its schema names no record: `runtime/ai-prompt-cache.spec.ts` holds
 * it to that.
 *
 * ## Why it is answered from memory
 *
 * The reader has already read the window, under the org-and-host scope check
 * `readSiteInventory` makes before it reads anything. Answering from that
 * window rather than from Firestore means a lookup cannot reach a record the
 * request was not already entitled to, needs no second scope check to be
 * correct, and adds no read to a job step's budget.
 */

export const AI_INVENTORY_LOOKUP_TOOL_NAME = 'look_up_site_inventory'

/** Records one answer lists. Past this the model narrows its query. */
export const AI_INVENTORY_LOOKUP_MAX_ROWS = 25

/** The longest answer one lookup returns; it rides uncached, like the block. */
export const AI_INVENTORY_LOOKUP_MAX_CHARS = 2_000

/**
 * Lookups one generation answers before it must answer with its own tool.
 * Each is a model call the caller pays for, so the bound is small: two is
 * enough to check a kind and then narrow once.
 */
export const AI_INVENTORY_LOOKUP_MAX_ROUNDS = 2

/** What one lookup asked for, once its input has been read. */
export interface AiInventoryLookupQuery {
  kind: AiInventoryKind
  /** The text to match; `null` asks for the records the prompt did not list. */
  query: string | null
}

/**
 * The strict tool. Its schema names a kind and a search text and nothing of
 * the site, so it is byte-identical for every workspace and every request.
 */
export function aiInventoryLookupTool(): AiTool {
  return {
    name: AI_INVENTORY_LOOKUP_TOOL_NAME,
    description:
      'Find records of this site that the inventory above did not list. Search one kind at a ' +
      'time by any word of a record: its id, its name, a prop, a field or a slug. Pass null as ' +
      'the query to list the records of that kind the inventory left out. Use this before you ' +
      'create anything the site may already have.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...AI_INVENTORY_KINDS],
          description: 'The kind of record to search.',
        },
        query: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description:
            'The text to match against a record, or null for the records that were not listed.',
        },
      },
      required: ['kind', 'query'],
      additionalProperties: false,
    },
  }
}

/** A tool call's input as a query, or `null` when it named no kind of this site. */
export function readAiInventoryLookup(
  input: Record<string, unknown>,
): AiInventoryLookupQuery | null {
  const kind = input['kind']
  if (typeof kind !== 'string' || !(AI_INVENTORY_KINDS as readonly string[]).includes(kind)) {
    return null
  }
  const raw = input['query']
  const query = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  return { kind: kind as AiInventoryKind, query: query || null }
}

/** The lines an answer lists, capped by count and then by characters. */
function listed(lines: readonly string[]): { rendered: string[]; cut: boolean } {
  const rendered: string[] = []
  let used = 0
  for (const line of lines.slice(0, AI_INVENTORY_LOOKUP_MAX_ROWS)) {
    if (used + line.length + 3 > AI_INVENTORY_LOOKUP_MAX_CHARS) {
      return { rendered, cut: true }
    }
    rendered.push(line)
    used += line.length + 3
  }
  return { rendered, cut: lines.length > rendered.length }
}

/**
 * One lookup, answered out of the inventory the request was built from.
 *
 * The answer is plain text in the same `id · name · …` shape the prompt's own
 * block uses, so a record found here reads exactly like a record that was
 * listed, and a plan refers to either by id the same way. It says how many
 * records were searched, so "nothing matched" is told apart from "nothing is
 * there" — the distinction rule 7 turns on.
 */
export function answerAiInventoryLookup(
  inventory: AiSiteInventory | null,
  input: Record<string, unknown>,
): string {
  if (!inventory) {
    return 'No site inventory was read for this request, so there is nothing to look up.'
  }
  const asked = readAiInventoryLookup(input)
  if (!asked) {
    return `That is not a kind of record this site has. The kinds are: ${AI_INVENTORY_KINDS.join(', ')}.`
  }
  const rows = aiInventoryRows(inventory, asked.kind)
  const needle = asked.query ? asked.query.toLowerCase() : null
  const matches = needle
    ? rows.filter((row) => aiInventoryHaystack(asked.kind, row).includes(needle))
    : rows.slice(AI_SITE_INVENTORY_LISTED_PER_KIND)
  // "None match" and "there are none" are different answers, and rule 7 turns
  // on the difference, so every answer says what it searched.
  const held = `this site's ${rows.length} ${asked.kind}`
  if (!matches.length) {
    const more = inventory.truncated.includes(asked.kind)
      ? ' More exist than were read, so this is not proof there is none.'
      : ''
    return needle
      ? `None of ${held} matches "${asked.query}".${more}`
      : `Every one of ${held} was listed above.${more}`
  }
  const { rendered, cut } = listed(matches.map((row) => aiInventoryLine(asked.kind, row)))
  const head = needle
    ? `${matches.length} of ${held} match "${asked.query}".`
    : `${matches.length} of ${held} were not listed above.`
  return [
    head,
    `${AI_INVENTORY_KIND_HEADINGS[asked.kind]}:`,
    ...rendered.map((line) => `- ${line}`),
    ...(cut ? ['More match than are listed here. Narrow the query to see the rest.'] : []),
  ].join('\n')
}
