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
  applyArtifactUpdate,
  planArtifactUpdate,
  summarizeSchemaChange,
} from './marketplace-merge'

const node = (id: string, title: string, childIds: string[] = []) => ({
  id,
  type: 'Text',
  props: { title },
  childIds,
})

describe('planArtifactUpdate (AGL-1018)', () => {
  it('takes a publisher change to a field the user never touched', () => {
    const base = { rootId: 'r', nodes: { r: node('r', 'Hello') } }
    const plan = planArtifactUpdate(base, base, {
      rootId: 'r',
      nodes: { r: node('r', 'Hello there') },
    })
    expect(plan.safe.map((change) => change.path)).toEqual([
      'nodes.r.props.title',
    ])
    expect(plan.conflicts).toHaveLength(0)
  })

  it('keeps a user edit the publisher left alone', () => {
    const base = { nodes: { r: node('r', 'Hello') } }
    const plan = planArtifactUpdate(
      base,
      { nodes: { r: node('r', 'Bienvenue') } },
      base,
    )
    expect(plan.kept.map((change) => change.path)).toEqual([
      'nodes.r.props.title',
    ])
    expect(plan.safe).toHaveLength(0)
  })

  it('reports a field both sides changed as a conflict', () => {
    const plan = planArtifactUpdate(
      { nodes: { r: node('r', 'Hello') } },
      { nodes: { r: node('r', 'Bienvenue') } },
      { nodes: { r: node('r', 'Hello there') } },
    )
    expect(plan.conflicts.map((change) => change.path)).toEqual([
      'nodes.r.props.title',
    ])
  })

  it('is not a conflict when both sides made the SAME change', () => {
    const plan = planArtifactUpdate(
      { nodes: { r: node('r', 'Helo') } },
      { nodes: { r: node('r', 'Hello') } },
      { nodes: { r: node('r', 'Hello') } },
    )
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.safe).toHaveLength(0)
  })

  /**
   * The structural half: a node map is compared by id, so an edit here and an
   * edit there are two independent changes. A textual or whole-tree diff would
   * make this one conflict over `nodes` and force the user to choose between
   * their work and the publisher's.
   */
  it('diffs a node tree by node id, so edits to different nodes are independent', () => {
    const base = {
      nodes: { a: node('a', 'A', ['b']), b: node('b', 'B') },
    }
    const plan = planArtifactUpdate(
      base,
      { nodes: { a: node('a', 'A', ['b']), b: node('b', 'Mine') } },
      { nodes: { a: node('a', 'Theirs', ['b']), b: node('b', 'B') } },
    )
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.safe.map((change) => change.path)).toEqual(['nodes.a.props.title'])
    expect(plan.kept.map((change) => change.path)).toEqual(['nodes.b.props.title'])
  })

  it('marks an added node as added and a removed one as removed', () => {
    const base = { nodes: { a: node('a', 'A') } }
    const plan = planArtifactUpdate(base, base, {
      nodes: { b: node('b', 'B') },
    })
    expect(plan.safe).toEqual([
      expect.objectContaining({ path: 'nodes.a', removed: true }),
      expect.objectContaining({ path: 'nodes.b', added: true }),
    ])
  })

  it('treats an array as one value, so an insert is not a change per position', () => {
    const base = { nodes: { a: node('a', 'A', ['b', 'c']) } }
    const plan = planArtifactUpdate(base, base, {
      nodes: { a: node('a', 'A', ['b', 'x', 'c']) },
    })
    expect(plan.safe.map((change) => change.path)).toEqual(['nodes.a.childIds'])
  })

  it('reports identical content as nothing to take', () => {
    const base = { nodes: { a: node('a', 'A') } }
    const plan = planArtifactUpdate(base, base, structuredClone(base))
    expect(plan.identical).toBe(true)
    expect(plan.safe).toHaveLength(0)
  })
})

describe('applyArtifactUpdate (AGL-1018)', () => {
  const base = {
    rootId: 'r',
    nodes: { r: node('r', 'Hello', ['a']), a: node('a', 'A') },
  }
  const current = {
    rootId: 'r',
    nodes: { r: node('r', 'Bienvenue', ['a']), a: node('a', 'A') },
  }
  const incoming = {
    rootId: 'r',
    nodes: { r: node('r', 'Hello there', ['a']), a: node('a', 'Améliorée') },
  }

  it('takes safe changes and leaves conflicts at the workspace value', () => {
    const plan = planArtifactUpdate(base, current, incoming)
    const result = applyArtifactUpdate(plan, current)
    expect(result.content).toMatchObject({
      nodes: {
        // Safe: the user never touched node `a`.
        a: { props: { title: 'Améliorée' } },
        // Conflict: theirs wins by default, and nothing said otherwise.
        r: { props: { title: 'Bienvenue' } },
      },
    })
    expect(result.skipped).toEqual(['nodes.r.props.title'])
  })

  it('takes a conflict only when it was explicitly chosen', () => {
    const plan = planArtifactUpdate(base, current, incoming)
    const result = applyArtifactUpdate(plan, current, {
      takePaths: ['nodes.r.props.title'],
    })
    expect(result.content).toMatchObject({
      nodes: { r: { props: { title: 'Hello there' } } },
    })
    expect(result.skipped).toEqual([])
  })

  /**
   * Merging patches the COPY, not the incoming version: a node the user added
   * has no counterpart upstream, and rebuilding from the publisher's content
   * would delete it without ever calling it a change.
   */
  it('preserves content the user added that upstream knows nothing about', () => {
    const mine = {
      ...current,
      nodes: { ...current.nodes, mine: node('mine', 'Mine') },
    }
    const plan = planArtifactUpdate(base, mine, incoming)
    const result = applyArtifactUpdate(plan, mine)
    expect((result.content as any).nodes.mine).toBeDefined()
  })

  it('applies a publisher removal as a delete, not an undefined field', () => {
    const plan = planArtifactUpdate(base, base, {
      rootId: 'r',
      nodes: { r: node('r', 'Hello', ['a']) },
    })
    const result = applyArtifactUpdate(plan, base)
    expect(Object.keys((result.content as any).nodes)).toEqual(['r'])
  })
})

describe('summarizeSchemaChange (AGL-1018)', () => {
  const schema = (fields: Record<string, { type: string }>) => ({
    order: Object.keys(fields),
    fields,
  })

  it('calls an added field additive', () => {
    const summary = summarizeSchemaChange(
      schema({ a: { type: 'text' } }),
      schema({ a: { type: 'text' }, b: { type: 'number' } }),
    )
    expect(summary.added).toEqual(['b'])
    expect(summary.additiveOnly).toBe(true)
  })

  it('refuses to call a removed field additive', () => {
    const summary = summarizeSchemaChange(
      schema({ a: { type: 'text' }, b: { type: 'number' } }),
      schema({ a: { type: 'text' } }),
    )
    expect(summary.removed).toEqual(['b'])
    expect(summary.additiveOnly).toBe(false)
  })

  it('treats a retype as destructive — existing values may not survive', () => {
    const summary = summarizeSchemaChange(
      schema({ a: { type: 'text' } }),
      schema({ a: { type: 'number' } }),
    )
    expect(summary.retyped).toEqual(['a'])
    expect(summary.additiveOnly).toBe(false)
  })

  it('separates a cosmetic field edit from a retype', () => {
    const summary = summarizeSchemaChange(
      { order: ['a'], fields: { a: { type: 'text', label: 'A' } as never } },
      { order: ['a'], fields: { a: { type: 'text', label: 'Name' } as never } },
    )
    expect(summary.edited).toEqual(['a'])
    expect(summary.additiveOnly).toBe(true)
  })
})
