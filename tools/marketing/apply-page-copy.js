/**
 * Pour a `copy-<page>.json` into a freshly-pasted copy of the
 * /product/besigner skeleton, in the besigner's own page context.
 *
 * Paste this whole file into `javascript_tool` with COPY set to the page's
 * parsed JSON. It writes through `canvas.updateNodeProps`, which is undoable
 * and — unlike typing into the Attributes panel — cannot race the panel's
 * re-render and write into the previously selected element.
 *
 * SAFETY: it asserts the slot count of every section before writing anything.
 * A positional shift is the failure mode that matters here, because the result
 * still looks entirely plausible in a screenshot: every heading is a heading,
 * just one slot out. On any mismatch it writes NOTHING and returns the diff.
 */

const applyPageCopy = (COPY, { dryRun = true } = {}) => {
  const c = window.AglynModule.canvas
  const ROOT = window.AglynModule.CANVAS_ROOT_ELEMENT_ID
  const plain = (o) => {
    const r = {}
    for (const k in o) r[k] = o[k]
    return r
  }

  /** Text-bearing nodes of one section, in document order. */
  const textNodes = (node, acc = []) => {
    if (!node) return acc
    const p = plain(node.props || {})
    if (typeof p.children === 'string' && p.children.trim()) acc.push(node)
    for (const kid of node.nodes ?? []) textNodes(c.getNode(kid), acc)
    return acc
  }

  // Section kinds drift between extractions ("deep-dive" / "deepdive" /
  // "Deep-dive · canvas"), so match on the squashed form rather than on an
  // exact string.
  const norm = (k) => {
    const s = String(k ?? '').toLowerCase().replace(/[^a-z]/g, '')
    return { exploretheplatform: 'explore', deepdivecanvas: 'deepdive' }[s] ?? s
  }

  /** Section intro: some extractions call it `subheading`, some `body[0]`. */
  const intro = (s) => s.body?.[0] ?? s.subheading ?? null

  // The contract, from product-page-skeleton.md. `slots` is what a correct
  // paste of the skeleton must contain; `flatten` turns one section of the
  // copy JSON into exactly that many strings, in the same order.
  //
  // A `null` in the flattened array means "this slot is INVARIANT across the
  // product pages — keep whatever the skeleton already has". The Early-access
  // chip ("Now in early access") is the case that matters: it is identical on
  // every page, so the extractions describe it in `notes` rather than giving
  // it a field. Blanking a node because the copy JSON happened not to name it
  // would be the worst possible reading of a missing value.
  const CONTRACT = [
    {
      kind: 'hero',
      slots: 5,
      flatten: (s) => [s.eyebrow, s.heading, intro(s), ...s.actions.map((a) => a.label)],
    },
    { kind: 'statement', slots: 1, flatten: (s) => [intro(s) ?? s.heading] },
    {
      kind: 'capabilities',
      slots: 14,
      flatten: (s) => [s.eyebrow, s.heading, ...s.items.flatMap((i) => [i.title, i.body])],
    },
    {
      kind: 'deepdive',
      slots: 9,
      flatten: (s) => [
        s.eyebrow,
        s.heading,
        intro(s),
        ...s.items.flatMap((i) => [i.title, i.body]),
      ],
    },
    {
      kind: 'howitworks',
      slots: 11,
      flatten: (s) => [
        s.eyebrow,
        s.heading,
        ...s.items.flatMap((i) => [i.meta, i.title, i.body]),
      ],
    },
    {
      kind: 'explore',
      slots: 17,
      flatten: (s) => [
        s.eyebrow,
        s.heading,
        intro(s),
        ...s.items.flatMap((i) => [i.title, i.body]),
      ],
    },
    {
      kind: 'earlyaccess',
      slots: 13,
      flatten: (s) => [
        s.eyebrow ?? null,
        s.heading,
        intro(s),
        ...s.actions.map((a) => a.label),
        ...s.items.flatMap((i) => [i.meta, i.title]),
      ],
    },
    {
      kind: 'cta',
      slots: 4,
      flatten: (s) => [s.heading, intro(s), ...s.actions.map((a) => a.label)],
    },
  ]

  const root = c.getNode(ROOT)
  const sections = (root.nodes ?? []).map((id) => c.getNode(id))

  // The nav and footer are the LAYOUT's, not the page's — a screen document
  // contains neither. Some extractions record them as sections anyway, which
  // is what made two pages look like they had a different shape.
  const CHROME = new Set(['navbar', 'nav', 'footer', 'sitenav', 'sitefooter'])
  const copySections = COPY.sections.filter((s) => !CHROME.has(norm(s.kind)))

  // --- verify before touching anything -------------------------------------
  const problems = []
  if (sections.length !== CONTRACT.length) {
    problems.push(`section count ${sections.length}, expected ${CONTRACT.length}`)
  }
  if (copySections.length !== CONTRACT.length) {
    problems.push(
      `copy has ${copySections.length} page sections, expected ${CONTRACT.length}` +
        ` (${COPY.sections.length - copySections.length} chrome entries ignored)`,
    )
  }

  const plan = []
  if (!problems.length) {
    CONTRACT.forEach((spec, i) => {
      const nodes = textNodes(sections[i])
      const copySection =
        copySections.find((cs) => norm(cs.kind) === spec.kind) ?? copySections[i]
      if (norm(copySection?.kind) !== spec.kind) {
        problems.push(`[${i}] ${spec.kind}: copy section ${i} is "${copySection?.kind}" — order does not match the skeleton`)
        return
      }
      let values
      try {
        // null = keep the skeleton's existing text for that slot.
        values = spec.flatten(copySection).map((v) => (v == null ? null : String(v)))
      } catch (err) {
        problems.push(`[${i}] ${spec.kind}: copy shape — ${err.message}`)
        return
      }
      if (nodes.length !== spec.slots) {
        problems.push(`[${i}] ${spec.kind}: canvas has ${nodes.length} text slots, contract says ${spec.slots}`)
      }
      if (values.length !== spec.slots) {
        problems.push(`[${i}] ${spec.kind}: copy yields ${values.length} strings, contract says ${spec.slots}`)
      }
      const blanks = values
        .map((v, k) => (v !== null && !v.trim() ? k : -1))
        .filter((k) => k >= 0)
      if (blanks.length) {
        problems.push(`[${i}] ${spec.kind}: empty string at slot(s) ${blanks} — refusing to blank a node`)
      }
      plan.push({ i, kind: spec.kind, nodes, values })
    })
  }

  if (problems.length) return { wrote: 0, problems }
  if (dryRun) {
    return {
      wrote: 0,
      dryRun: true,
      preview: plan.map((p) => ({
        section: p.kind,
        pairs: p.nodes.map((n, k) => [
          String(plain(n.props).children).slice(0, 40),
          p.values[k] === null ? '(keep)' : p.values[k].slice(0, 40),
        ]),
      })),
    }
  }

  // --- write ---------------------------------------------------------------
  c.saveHistory()
  let wrote = 0
  for (const p of plan) {
    p.nodes.forEach((node, k) => {
      if (p.values[k] === null) return // invariant slot — keep the skeleton's
      // SPREAD THE EXISTING PROPS. `updateNodeProps` REPLACES the prop bag, it
      // does not merge into it. Passing `{ children }` alone strips everything
      // else the node carries — and on this skeleton that is `component: 'h1'`
      // on all seven headings plus `variant: 'body1'` on the hero body.
      //
      // Losing `component` is the heading-variant trap from the other side: a
      // Typography with neither `component` nor `variant` renders as a <p>,
      // while the node-level `sx.fontSize` keeps painting it at 72px. So the
      // page still SCREENSHOTS correctly and every heading has quietly stopped
      // being a heading. Caught only by reading props back off a real canvas —
      // the stub harness's `updateNodeProps` is a no-op, so it cannot see this.
      c.updateNodeProps(node, { ...plain(node.props), children: p.values[k] })
      wrote += 1
    })
  }
  return { wrote, sections: plan.length }
}
