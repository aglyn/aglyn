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
 * The compose-time half of the drop/render agreement (AGL-1389).
 *
 * A guard that only inspects a component function misses this entirely, and
 * the miss is not hypothetical: `reusableInstance` renders `{children}` — it
 * looks perfect — and destroyed every node dropped into it anyway, because
 * {@link composeReusableComponentNodes} REPLACES the instance's child list
 * with the grafted definition subtree before any renderer sees the tree
 * (`nodes: [prefixId(definition.rootId)]`). Reading the component alone would
 * have cleared it.
 *
 * So the child a node holds is checked where every render surface gets its
 * tree from: after compose. Pure data in, pure data out — no React, no
 * providers, no canvas singleton, and therefore no exemptions.
 */

import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import type { AglynNodeSchema, NodeId } from '../foundation'
import { composeLayoutAndScreenNodes } from './compose-layout-nodes'
import {
  composeReusableComponentNodes,
  type ReusableComponentTree,
} from './compose-reusable-components'

const SUBJECT_ID = 'child-contract-subject'
const SENTINEL_ID = 'child-contract-sentinel'
const DEFINITION_ID = 'child-contract-definition'

type Nodes = Record<NodeId, AglynNodeSchema>

/**
 * A minimal screen: root → one node of `componentId` → one sentinel child.
 *
 * `props.refId` is set on every subject, not only on instances: it is what
 * makes the reusable graft actually fire, and a probe that quietly skipped
 * the expansion would report "children survive" about a code path it never
 * entered.
 */
function probeScreen(componentId: string): Nodes {
  return {
    [NODE_ROOT_ID]: {
      $id: NODE_ROOT_ID,
      parentId: null,
      componentId: 'div',
      nodes: [SUBJECT_ID],
    },
    [SUBJECT_ID]: {
      $id: SUBJECT_ID,
      parentId: NODE_ROOT_ID,
      componentId,
      props: { refId: DEFINITION_ID },
      nodes: [SENTINEL_ID],
    },
    [SENTINEL_ID]: {
      $id: SENTINEL_ID,
      parentId: SUBJECT_ID,
      componentId: 'muiTypography',
      props: { children: 'sentinel' },
      nodes: [],
    },
  } as unknown as Nodes
}

/** A one-node definition for the graft to resolve `refId` against. */
function probeDefinition(): ReusableComponentTree {
  return {
    rootId: 'def-root',
    nodes: {
      'def-root': {
        $id: 'def-root',
        parentId: null,
        componentId: 'muiStack',
        nodes: [],
      },
    } as unknown as ReusableComponentTree['nodes'],
  }
}

/** A layout whose slot the screen's top-level nodes are grafted into. */
function probeLayout(): Nodes {
  return {
    [NODE_ROOT_ID]: {
      $id: NODE_ROOT_ID,
      parentId: null,
      componentId: 'div',
      nodes: ['slot'],
    },
    slot: {
      $id: 'slot',
      parentId: NODE_ROOT_ID,
      componentId: 'layoutSlot',
      nodes: [],
    },
  } as unknown as Nodes
}

/** Whether the sentinel is still in the map AND still the subject's child. */
function sentinelSurvives(composed: Nodes): boolean {
  if (!composed?.[SENTINEL_ID]) return false
  const children = composed[SUBJECT_ID]?.nodes
  return Array.isArray(children) && (children as NodeId[]).includes(SENTINEL_ID)
}

/**
 * Every component id whose children a compose pass destroys, as
 * reviewer-facing lines (empty = the contract holds).
 *
 * Call it with the ids the editor accepts a drop into
 * (`listAcceptingComponentIds`), which is exactly the set for which "the
 * author put a node here" must survive to a render surface. Ids the editor
 * already refuses are not probed — a component that cannot receive a drop is
 * free to rewrite its own child list, which is what `reusableInstance` and
 * `layoutSlot` do for a living.
 */
export function auditComposeChildSurvival(
  acceptingComponentIds: readonly string[],
): string[] {
  const problems: string[] = []
  for (const componentId of acceptingComponentIds) {
    if (!componentId) continue

    const grafted = composeReusableComponentNodes(probeScreen(componentId), {
      [DEFINITION_ID]: probeDefinition(),
    }) as Nodes
    if (!sentinelSurvives(grafted)) {
      problems.push(
        `${componentId} accepts a drop, but composeReusableComponentNodes ` +
          'destroys the node dropped into it — the author would see it in ' +
          'the hierarchy and the published page would not have it. Declare ' +
          'flags.dropping: FEATURE_FLAG.DISABLED, or stop rewriting its ' +
          'child list (AGL-1389)',
      )
    }

    const laidOut = composeLayoutAndScreenNodes(
      probeLayout(),
      probeScreen(componentId),
    ) as Nodes
    if (!sentinelSurvives(laidOut)) {
      problems.push(
        `${componentId} accepts a drop, but composeLayoutAndScreenNodes ` +
          'destroys the node dropped into it — the author would see it in ' +
          'the hierarchy and the published page would not have it. Declare ' +
          'flags.dropping: FEATURE_FLAG.DISABLED, or stop rewriting its ' +
          'child list (AGL-1389)',
      )
    }
  }
  return problems.sort()
}
