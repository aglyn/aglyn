# CRM picklists backfill (AGL-3511)

Since AGL-3510 every CRM picklist ships Salesforce's standard values, merged
into each organization's list on read (`app-utils/picklists`). Records store a
picklist's **label**, so the standard values arrive without a record being
touched. What they do not cover is the labels an organization already holds on
its records that are neither standard nor in its stored list: every select
would show those as *(not in the list)*. One script writes them down as the
organization's own values: `tools/scripts/backfill-crm-picklists.mjs`. Its
decisions live in the CRM plugin's `libs/plugins/crm/scripts/crm-picklists-backfill.mjs`
and are pinned by `libs/plugins/crm/scripts/crm-picklists-backfill.test.mjs`
(`npm run test:crm-picklists-backfill`).

**It writes list documents only** — `orgs/{orgId}/crmPicklists/{picklistId}` —
and never rewrites a record.

## Which picklists

The registry is read out of `libs/aglyn/src/lib/app-utils/crm.ts` at run time
(every `… as const satisfies CrmPicklistDefinition` object, with its standard
values, groups, meanings and targets), so the script backfills:

| Picklist | When | Labels read from |
| --- | --- | --- |
| **Lead source** (`leadSource`) | always | every lead's `leadSource`, every holder's `facets.{groupId}.leadSource` on a contact, every company's `accountSource` and every deal's `leadSource` |
| **Industry** (`industry`, AGL-3514) | only once the registry holds it; skipped otherwise | the field each of its targets names — a company's `industry` free text |

A definition whose standard values or targets cannot be read from `crm.ts` is
refused by name rather than planned: with no standard values, every label
would look like the organization's own. A semantic picklist — one whose values
carry a meaning, like Lead status — is never added to, because an added value
must name a meaning the backfill cannot know.

## What it decides, per list

| Case | What happens |
| --- | --- |
| A stored value whose id is a standard id (`web`, `trade-show`, `purchased-list`, `other`, …) | **Kept** as the standard value, overridden — its label, order, group and active flag as stored. No record changes: they already hold its label. |
| An org-added lead source with no group whose label starts **Outbound** | Filed under **Outbound**. |
| A stored value that is not standard but carries a standard value's label — "Website form", written down by hand before AGL-3519 made it built in | **Merged into the built-in value**: the entry takes the standard id (`website-form`), and the standard group when it has none, so it reads as that value overridden. Records hold the label, which does not change, so none is rewritten. A default that named it follows. |
| Any other org-added value | Left as it is. A group an admin set is never moved. |
| A label records hold that the list does not answer to — in any capitalization or spacing — standard values included | **Added** as the organization's own value, active, at the end of the list. A lead source starting **Outbound** is filed under Outbound, else no group. |
| An organization that never stored a list, whose records hold such a label | Written the list it reads today — every standard value in order — with the added values after, as the Fields page writes one on an organization's first edit. An organization whose records hold only standard labels is written nothing. |
| A list already at 200 values | The label is reported as not added. |

The default value is kept. A second run finds every held label in the list and
every Outbound value grouped, and plans nothing.

## The Aglyn organization

The plan the test pins for the Aglyn organization's lead sources:

```
leadSource:
    Website form → the built-in value (website-form)
    Outbound · Apollo → added, outbound
    Outbound · Instantly → added, outbound
    Outbound · self-published address → added, outbound
    Internal test → added, no group
```

"Website form" is one of Aglyn's own built-in values since AGL-3519; a stored
entry already under the id `website-form` is that value overridden and plans
nothing, and one under another id is merged into it as above. A vendor Aglyn
does not run — Apollo, Instantly — stays the org's own value. (An org-added
value already stored with no group reads `→ outbound` — regrouped — rather
than `→ added, outbound`.)

## Running it

**Not yet run anywhere. `--apply` needs Zach's yes.** From the root checkout,
whose `.env` carries the service account; the project is named on the command
line because the key file does not carry it:

```sh
# 1. Report everything, write nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-picklists.mjs --org=<orgId>

# 2. Write.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-picklists.mjs --org=<orgId> --apply
```

Without `--org` it runs every organization. Dry run by default.

## The contacts list's lead source filter

Separately from this script: the Contacts list filters by lead source through a
`leadSource` facet key (`facetKeys`, AGL-3511) that every contact writer stamps
from now on. A contact last written before that carries no such key and is not
found by the filter until it is next saved — or until
`backfill-crm-list-fields.mjs` restamps the list fields, which computes the new
key with the rest.
