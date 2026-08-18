<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# This file is not the Privacy Policy

**The Privacy Policy lives at <https://aglyn.com/legal/privacy>.** That page is
the only authoritative text. Nothing in this repository is.

Until 2026-08-18 this file held a three-sentence stub dated June 14, 2021. It
was never the published policy, nothing imported it and nothing linked to it —
but a top-level `PRIVACY_POLICY.md` in an Apache-licensed repository reads as
authoritative to anyone who finds it, which is precisely the problem. It is
replaced by this pointer rather than deleted, because a deleted file at an
obvious path gets helpfully re-created by the next person who notices it is
missing (AGL-1978).

## Where the real documents are

| Document | Authority | Repo copy |
| --- | --- | --- |
| Privacy Policy | <https://aglyn.com/legal/privacy> | snapshot only, `apps/console/constants/legal/{version}/privacy.txt` |
| Terms of Service | <https://aglyn.com/legal/terms> | snapshot only, `apps/console/constants/legal/{version}/terms.txt` |
| DPA, Cookie Policy, Subprocessors | the live pages | **none** — the page is the only authority |

## Why the repo copy is a snapshot and not a source

Legal text here is **publication-first**: it is authored and published as
besigner content on `aglyn.com`, and only then re-captured into
`apps/console/constants/legal/{version}/*.txt` so the console can pin exactly
which words a person accepted. The capture is mechanical and is never
hand-written — `apps/console/constants/legal-documents.ts` explains why that
ordering is not a preference. Editing a snapshot to say something the page does
not say produces a clickwrap record that misrepresents what was agreed to.

So: if the text is wrong, fix the **page**, publish, and re-capture. Do not
edit a snapshot, and do not write policy in a Markdown file at the repo root.

## Related

- `docs/DATA_RETENTION.md` — what we keep, for how long, and the mechanism
  enforcing each period, reconciled against the published pages.
- `docs/PRIVACY_REQUESTS.md` — how a person exercises a right, and every place
  to look when answering one.
- Privacy contact: the address given in the published policy.
