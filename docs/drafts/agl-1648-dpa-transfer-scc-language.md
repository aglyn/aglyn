# AGL-1648 (a) — DPA international transfers / SCCs: what is live, and the residual clause text

**Status: the headline gap is CLOSED.** This draft is not a rewrite. It records what
`aglyn.com/legal/dpa` actually says today, and proposes the *four* residual clause edits
that are still owed.

**Do not publish from this file.** The Google Doc `Platform Docs/Legal/DATA_PROCESSING_ADDENDUM.md.gdoc`
is the source of truth. The order is: agree the wording here → edit the Doc → publish the
besigner page → re-run `npm run check:legal-drift -- dpa`.

---

## 1. Measured current state

Read once from live on **2026-08-24** through a real browser (a `curl` sweep gets HTTP 429
from the Vercel firewall — do not retry it).

* `https://aglyn.com/legal/dpa` — **Last updated: August 18, 2026**
* `https://aglyn.com/legal/subprocessors` — **Last updated: August 18, 2026**

Both are **six days newer** than the AGL-1648 comment thread, and both moved. The benchmark
finding that opened this issue — *"the DPA's transfer clause fails at the exact point Aglyn
committed to global service"* — no longer describes the published document.

### What §13 now carries, verbatim from live

| Sub-clause | Substance |
| --- | --- |
| **13.1** | SCCs named by instrument — *Implementing Decision (EU) 2021/914*. Module Two (C→P) and Module Three (P→P) both selected, with the trigger for each. Customer = exporter, Aglyn = importer. |
| **13.2(a)** | Clause 7 docking clause **included**. |
| **13.2(b)** | Clause 9 **Option 2** (general written authorisation); notice period + objection mechanism cross-referenced to §7 and the Subprocessors page. |
| **13.2(c)** | Clause 11(a) optional independent dispute-resolution body **excluded**. |
| **13.2(d)** | Clause 13 / Annex I.C competent supervisory authority → Annex A. |
| **13.2(e)** | Clause 17 governing law **Ireland**; Clause 18 forum **Ireland**. |
| **13.2(f)** | Annex I → Annex A; Annex II → Annex B; **Annex III = the then-current Subprocessors page, incorporated by reference**. SCCs control on conflict. |
| **13.3** | UK IDTA to the EU SCCs, **version B1.0**; Tables 1–3 completed by the DPA + annexes; Table 4 = either party may end, per its §19. |
| **13.4** | Swiss FDPIC adaptations — GDPR read as the FADP, FDPIC is the authority, Swiss data subjects enforce in Switzerland. |
| **Annex A** | SCC Annex I / IDTA Tables 1–3. Parties, roles, description of transfer, frequency (continuous), retention (→ §11), transfers to sub-processors (→ §7 + the list). Data-importer contact: **privacy@aglyn.com**. |
| **Annex B** | SCC Annex II / IDTA Table 3. Ten concrete TOMs, prefaced by an explicit *"Aglyn holds no third-party security certifications (e.g., SOC 2, ISO 27001) and does not represent otherwise."* |

This is a properly completed transfer clause. The one blank the SCC template makes
mandatory — **Clause 9(a) Option 2's "[Specify time period]"** — is now filled, at §7.2:
**thirty (30) days**. On 2026-08-14 it was not, and that was the sharpest defect in the set.

---

## 2. The four residual edits

Ordered by exposure. Each is stated as *find this / replace with this*, so it can go
straight into the Doc.

### R1 — Annex A.A names no Art. 27 representative *(blocked on AGL-1619 — decision, not drafting)*

SCC Annex I.A requires each party's identity **"and, where applicable, of its/their data
protection officer and/or representative in the European Union."** Aglyn is a Texas LLC
with no EU establishment. If Art. 3(2) GDPR reaches Aglyn directly — which the Option A
global-scope decision assumes it does — an Art. 27 representative is mandatory, and Annex I.A
is where the SCCs expect it named.

Today Annex A.A ends at *"Contact: privacy@aglyn.com. Role: processor."* Nothing follows.

**This cannot be drafted around.** It needs the appointment (AGL-1619), not a clause. But
the clause is one line once the appointment exists, and it should be pre-agreed so the
publish is a paste:

> *Data importer:* Aglyn LLC, a Texas limited liability company, United States. Contact:
> privacy@aglyn.com. Role: processor. **EU representative (GDPR Art. 27): [NAME], [ADDRESS],
> [EMAIL]. UK representative (UK GDPR Art. 27): [NAME], [ADDRESS], [EMAIL].**

**If AGL-1619 will not close before 2026-09-01,** the honest interim is a disclosure, not
silence. Add to Annex A.A:

> Aglyn has not appointed a representative under Article 27 of the GDPR or the UK GDPR.
> Aglyn will appoint one and update this Annex if and when Article 27 applies to its
> processing.

That sentence is worse commercially and better legally than an empty field: an EEA
enterprise buyer's DPIA reviewer will find the absence either way, and finding it disclosed
is a different conversation from finding it hidden.

### R2 — §7.2 and Annex A give two different data-protection contacts

Live §7.2 routes the **SCC Clause 9 objection** to `support@aglyn.com`. Live Annex A names
the **data importer contact** as `privacy@aglyn.com`. Both mailboxes exist and deliver
(AGL-1911, verified by Workspace group configuration on 2026-08-19 — *not* by test send,
which cannot fail here; see `docs/EMAIL_SETUP.md`). So this is not a dead-mailbox problem.
It is a *routing* problem: a contract that offers two addresses for data-protection
correspondence will receive objections at both, and only one is inside the SCC annex a
regulator reads.

Two acceptable resolutions. **Pick one; do not ship both.**

* **(i) Consolidate on `privacy@`** — the annex contact becomes the single route.
  In §7.2 and on the Subprocessors page, replace `support@aglyn.com` with
  `privacy@aglyn.com`. Cleanest for the SCCs. Costs one besigner edit on each page.
* **(ii) Keep `support@` and make Annex A say so.** Append to Annex A.A:
  > Sub-processor objections under Section 7.2 may be sent to support@aglyn.com; all other
  > data-protection correspondence should be sent to privacy@aglyn.com.

**Recommendation: (i).** `support@aglyn.com` is the runtime value of
`NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL`, which a self-host operator reconfigures — so the DPA
currently hard-codes into a contract an address whose meaning is deployment-dependent.
`privacy@` is not configurable and is already the annex contact.

### R3 — the objection has no stated consequence

Live §7.2 ends: *"…and Aglyn will work with Customer in good faith to address the objection."*

Good faith is not a remedy. Every DPA this was benchmarked against gives the customer a
**termination right** for the affected service if the objection cannot be resolved, and an
EEA buyer's counsel will ask for it. Its absence is the single most likely redline on the
document.

**Append to §7.2:**

> If Aglyn is unable to make available an alternative arrangement that avoids the objected-to
> Sub-processor within a reasonable period, Customer may, as its sole and exclusive remedy,
> terminate the affected portion of the Services on written notice and receive a pro-rata
> refund of any fees prepaid for the terminated portion covering the period after
> termination. Customer's objection must be raised within the thirty (30) day period
> described above.

This is deliberately narrow — *affected portion*, *sole and exclusive remedy*, pro-rata
refund only, and time-boxed to the notice window — so it cannot be used as a general exit.
It costs nothing today because the whole subprocessor list is infrastructure a customer
cannot realistically object to piecemeal.

### R4 — Annex A.C states a rule where the SCCs expect a named authority

Live Annex A.C reproduces the Clause 13(a) selection rule rather than naming an authority.
That is defensible for Module Two where the *Customer* is the exporter and Aglyn cannot
know in advance which member state that is — and it is the honest answer. Leave it, **with
one addition** that closes the Art. 3(2) branch the current wording does not reach:

**Replace Annex A.C with:**

> **C. Competent supervisory authority.** The supervisory authority of the EU member state in
> which the data exporter is established. Where the data exporter is not established in an EU
> member state but has appointed a representative under Article 27 GDPR, the competent
> authority is that of the member state in which the representative is established. Where the
> data exporter is not established in an EU member state and has not appointed such a
> representative, the competent authority is that of the member state in which the data
> subjects whose personal data is transferred are located.

Three branches instead of two, matching Clause 13(a)'s three indents. Lowest priority in
this list.

---

## 3. What must NOT change

* **Do not weaken Annex B's certification sentence.** *"Aglyn holds no third-party security
  certifications (e.g., SOC 2, ISO 27001) and does not represent otherwise"* is the single
  most valuable sentence in the DPA. It is what makes the rest of Annex B credible.
* **Do not narrow §13.2(f).** Annex III being the *then-current* published page is what makes
  the 30-day mechanism legally load-bearing. It is also why a stale Subprocessors page is a
  breach of the SCCs and not merely an out-of-date web page — see the companion draft.
* **Do not describe rollout.** Anthropic sits on the published list today while
  `ANTHROPIC_API_KEY` is (as far as the repo records) unset in production. That is correct:
  the disclosure tracks capability, and it is what the 30-day advance notice is *for*.

---

## 4. Decision needed from the account owner

| # | Decision | Blocked on |
| --- | --- | --- |
| R1 | Appoint the Art. 27 rep, **or** approve the interim disclosure sentence | AGL-1619 |
| R2 | `privacy@` or `support@` as the single objection route — recommend `privacy@` | the account owner |
| R3 | Approve the termination-on-objection remedy as drafted | the account owner |
| R4 | Approve the three-branch Annex A.C, or leave as-is | the account owner (low) |

R1–R3 are one Doc edit and one besigner publish between them. The DPA is **not**
clickwrapped in `apps/console/constants/legal/` (only Terms and Privacy are), so none of
these move a document hash or trigger re-consent.
