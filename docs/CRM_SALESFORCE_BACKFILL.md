# CRM one-record backfill (AGL-3235)

The move to the Salesforce object model (P-AGL-136): a person is **one
record** — a lead until somebody qualifies them, a contact after. Before
AGL-3232 a lead-routed form or a booking wrote a lead *and* a contact at stage
Lead, and the CRM's imports filed unqualified people as contacts, so the corpus
holds contacts that are leads in a contact's clothes. One script moves it:
`tools/scripts/backfill-crm-salesforce-model.mjs`. Its decisions live in
`tools/scripts/lib/one-record-backfill.mjs` and are pinned by
`tools/scripts/lib/one-record-backfill.test.mjs`
(`npm run test:one-record-backfill`).

| Contact | Verdict | What happens |
| --- | --- | --- |
| Nothing behind it but a capture — no member account, no order, no newsletter opt-in, no deal, no stage past Lead on any facet | **duplicate of a lead** | Folded onto the lead of every site that captured the person or enrolled them in a sequence — created where the site holds none — then archived to `orgs/{orgId}/crmBackfillArchive/{contactId}` and deleted with its address-index row. Its sequence enrollments re-target the lead; its activities and tasks gain the lead and drop the contact. |
| A member, a buyer, a subscriber, somebody with a deal or a stage past Lead | **relationship** | Kept. An open lead any site holds for the address is closed as **Qualified**, converted onto the contact (`convertedBy: 'backfill'`); the lead's enrollments, activities and tasks follow to the contact. |
| A lead already converted onto *another* contact | left, reported as `converted-elsewhere` | Two contacts for one address is the merge tool's case, not this script's. |
| No usable address | left, reported as `no-email` | Nothing can key it. |

**A fold copies before it deletes.** A value the lead already holds wins — it
is the record the rep has been working — a value it lacks is taken from the
contact (name, phone, title, company text, address, tags, notes, owner), tags
are the union, and the marketing basis is carried where the lead has none.
Never invented, never dropped, never cleared. Companies whose people changed
are recounted from what remains.

**Dry run by default.** `--apply` writes. `--org=<orgId>` limits a run to one
org. `--no-archive` skips the archive copy and is not recommended.

## Running it

From the root checkout, whose `.env` carries the service account. The project
is named on the command line because the key file does not carry it:

```sh
# 1. Report everything, write nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-salesforce-model.mjs --org=<orgId>

# 2. Write.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-salesforce-model.mjs --org=<orgId> --apply

# 3. Prove it is done: the same dry run plans nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-salesforce-model.mjs --org=<orgId>
```

`FIRESTORE_EMULATOR_HOST` skips the credential for a local proof.

### What a run prints

```
preconditions: OK — the capture writer, the enrollment model and the conversion hand-off are in the tree
project aglyn-main via service account … — DRY RUN

org <orgId>: 15 contact(s), 2 site(s), 4 enrollment(s)
  michele.shaw@example.com  lead — would fold onto <hostId>: fill company, tags; 1 enrollment(s), 2 activity(ies), 0 task(s) follow; would delete the contact (archived first)
  dnjug10@example.com  contact (member account, stage subscriber) — would close its open lead on <hostId> onto the contact
  would move 6 duplicate contact(s) (0 lead(s) created, 6 filled in); 9 relationship(s) kept, 1 open lead(s) closed onto them; 7 record(s) follow

Dry run: 6 duplicate contact(s) folded across 1 org(s) (0 lead(s) created); 1 open lead(s) closed onto their contact; 7 record(s) followed; 6 company count(s) fixed.
  Re-run with --apply to write.
```

A clean second run reports `would move 0 duplicate contact(s)` and `0 open
lead(s) closed`.

## ⛔ Before `--apply` on production

- **The code must be promoted first.** The preconditions read the checkout,
  not the deployment: run it from a checkout at or after the promotion that
  carries AGL-3232 through AGL-3234, and only once that promotion is live. A
  deployment still writing a contact beside every lead would rebuild the
  duplicates as fast as this removes them, and a sequence runtime that knows
  only contacts would stop every re-pointed enrollment.
- **Coordinate with whoever is running Sequences.** The script re-points
  live enrollments. Run it between sends — never while the send job is inside
  its window on an enrollment it will move — and confirm afterwards on the
  Enrollments tab that each re-pointed enrollment kept its step and its due
  time (the script writes neither).
- **It is Zach's call.** Nothing here runs without his yes on the org named.

## Reversing a fold

The deleted contact is whole under `crmBackfillArchive`, with `leadKey`. To
restore one: convert the lead from the console, which creates the contact
from what the lead now holds; the archive copy is there for anything the
fold could not carry (custom fields, files).
