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
 * ESLint rule: taking a value out of a loading-aware hook without taking its
 * readiness flag too.
 *
 * Four separate incidents, one shape — a hook handing out a resolved-looking
 * value before it has resolved:
 *
 *   - AGL-1047 `useScopeTokens`  — reports `orgWide: true` while loading, so a
 *     scoped collaborator's first render sent an UNFILTERED list that the
 *     AGL-1041 rules deny per document. Recovered on the next render, which is
 *     what made it easy to miss: the page looked right and logged a denial
 *     every mount.
 *   - AGL-1061 `useOrgDataScope` — `orgId` was null while the `hostIndex`
 *     lookup was in flight, indistinguishable from "this host has no org",
 *     which sent callers down a host-path fallback. See below for why this
 *     hook is nonetheless not in the list.
 *   - AGL-1064 `useOrgPlan`      — `org` is undefined during the window, and
 *     `checkQuota(undefined, …)` does not mean "unknown", it resolves the FREE
 *     tier. A paying customer clicking Add inside that window was told their
 *     plan does not include what they bought.
 *   - AGL-1380 `useCurrentOrg`  — the same defect as `useOrgPlan` on the hook
 *     the whole console reads. Swept by hand TWICE before it was listed here:
 *     nine render sites in `854dc2c66`, then nine DIFFERENT handler sites in
 *     `bc321c2ec`, found only by reading every call site again. A Pro site
 *     told "AI assist requires a Pro plan"; a languages save silently
 *     dropped; a backup gate that blocked EXPORT as well as restore. The
 *     third sweep was the default outcome, which is what AGL-1422 stopped.
 *
 * Each was fixed by adding a readiness flag beside the value. Nothing stops
 * the tenth call site from destructuring the value and ignoring the flag,
 * which is what this rule is for.
 *
 * ## It reports at the DECLARATION
 *
 * One report per hook CALL, not per use of the value. That matters for the
 * failure mode a broad rule usually has (AGL-1245): a caller that genuinely
 * only needs the value for display cannot half-satisfy this and cannot
 * scatter suppressions through a file — it writes ONE
 * `eslint-disable-next-line` at the destructuring, next to the reason. The
 * exemption is therefore as reviewable as the guard.
 *
 * ## Why `useOrgDataScope` is NOT in the list
 *
 * It was, for one draft. AGL-1061 is on the incident list above, so it looks
 * like it belongs — but the hazard there was specifically that a null `orgId`
 * sent callers down the `['hosts', hostId]` FALLBACK, and AGL-1050 deleted
 * that fallback. What is left cannot be used wrongly: `scope` is
 * `['orgs', id] | null`, so the null must be handled, and every caller now
 * reads a null `orgId` as "do nothing", which is the correct response to both
 * "still loading" and "no org". Listing it produced two findings, both false.
 *
 * A rule that fires on correct code teaches people to satisfy it mechanically
 * — destructure `ready`, never consult it — which is worse than no rule. Put
 * it back only if a caller starts rendering a settled-empty state ("this host
 * has no organization") from `orgId`, where the loading window would flash the
 * wrong answer.
 *
 * ## Honest limits
 *
 * It cannot see whether a destructured flag is actually consulted, and it
 * cannot know about a FIFTH hook invented with the same defect — that one
 * needs {@link GUARDED_HOOKS} updated by hand. It catches the copy-paste
 * regression, which is the one that has actually happened.
 */

/**
 * Hook name → the readiness flag, and the value keys that are meaningless
 * without it. Add an entry when a hook grows a loading state — and only the
 * keys whose loading value is a plausible-looking LIE, not every key.
 */
const GUARDED_HOOKS = {
  // `orgWide: true` and the org-wide token list while loading — the exact
  // shape that sends an unfiltered list into rules that deny it (AGL-1047).
  useScopeTokens: { flag: 'loaded', unsafe: ['tokens', 'orgWide'] },
  // `org: undefined` is not "unknown" to `checkQuota`/`checkEntitlement`, it
  // is the FREE tier (AGL-1064).
  useOrgPlan: { flag: 'ready', unsafe: ['org'] },
  // Same lie as `useScopeTokens`, on the navigation side (AGL-1032):
  // `orgWide` reads true until the memberships load — deliberately, since
  // the alternative blanks the console for every owner on a cold load — so a
  // caller hiding org UI on it without `ready` hides nothing at all.
  useOrgReach: { flag: 'ready', unsafe: ['orgWide'] },
  // The console's entitlement source (AGL-1422). Same lie as `useOrgPlan`
  // and by far the widest blast radius: `org: undefined` covers both "in
  // flight" and "the read is failing", and `plan-entitlements.ts` resolves
  // an undefined org to the FREE tier rather than to "unknown". So an
  // unguarded caller answers an entitlement question before it has been
  // asked, and answers it NO — a paying org told the feature it bought is
  // not on its plan, a quota'd action refused, a save dropped. The class
  // was swept by hand TWICE (854dc2c66, then a different nine sites in
  // bc321c2ec) before it was worth teaching to the rule.
  //
  // `orgId` is deliberately NOT unsafe: an undefined `orgId` means "no org
  // in scope", which every caller already has to handle, and it carries no
  // tier of its own.
  useCurrentOrg: { flag: 'ready', unsafe: ['org'] },
}

/** The static key a destructuring property reads, or null if computed. */
function keyOf(property) {
  if (property.type !== 'Property' || property.computed) return null
  const key = property.key
  if (key.type === 'Identifier') return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'require the readiness flag when destructuring a value from a ' +
        'loading-aware hook',
    },
    schema: [],
    messages: {
      unguarded:
        "`{{hook}}().{{value}}` is not trustworthy until `{{flag}}` is true — " +
        'destructure `{{flag}}` and gate on it. Rendering or writing from ' +
        '`{{value}}` during the loading window is AGL-1047/1061/1064/1380. ' +
        'If this caller only DISPLAYS the value and never gates on it, ' +
        'disable this line and say why.',
    },
  },

  create(context) {
    return {
      VariableDeclarator(node) {
        const init = node.init
        if (!init || init.type !== 'CallExpression') return
        const callee = init.callee
        if (callee.type !== 'Identifier') return
        const guard = GUARDED_HOOKS[callee.name]
        if (!guard) return
        if (node.id.type !== 'ObjectPattern') return

        const properties = node.id.properties
        // `...rest` puts the flag within reach; the rule cannot tell whether
        // it is used, and guessing would be a false positive.
        if (properties.some((property) => property.type === 'RestElement')) {
          return
        }

        const keys = properties.map(keyOf)
        // A computed key could be the flag. Bail rather than misreport.
        if (keys.some((key) => key === null)) return
        if (keys.includes(guard.flag)) return

        const taken = guard.unsafe.find((key) => keys.includes(key))
        if (!taken) return

        context.report({
          node: node.id,
          messageId: 'unguarded',
          data: { hook: callee.name, value: taken, flag: guard.flag },
        })
      },
    }
  },
}
