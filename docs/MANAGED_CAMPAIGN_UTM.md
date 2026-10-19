# The Managed campaign and its per-event UTM labels

Aglyn's own marketing, not a product feature: how the `/managed` landing page
on aglyn.com, its form and its campaign fit together, and how the QR codes we
hand out at events and on doorsteps are labeled so every lead says where it
came from (AGL-3960).

## What exists

| Thing | Where | Id |
| -- | -- | -- |
| Landing page `/managed` | `hosts/DXnRbPH4CQ/screens/…`, Landing Pages group, visibility PUBLIC | `qnuMY13VsS`, first version `COCDoTk7vn`, live version `W4VceCRSjF` |
| Form "Managed" | `hosts/DXnRbPH4CQ/forms/…` | `chjqg6-XOD`, first version `cRbJ2BWB3Q` |
| Campaign "Managed · Events and door to door" | `orgs/jWmGooWE3L/emailCampaigns/…`, label `managed-2026-10` | `h3Gg7rSecF` |

All three were written on 2026-10-19 by
`tools/scripts/publish-managed-landing-page.mjs` (dry run by default). The
page's live version since is the work of
`tools/scripts/republish-managed-landing-page.mjs` (AGL-3998), also a dry run
by default.

The page and the form are both filed under the campaign, so a visit to the
page counts toward the campaign's reach and a submission is credited to it
even when the link carried no label at all.

The page sells Managed (a plan plus Site Care, one price) to people who want
to read about it rather than have a site built on the spot. It states no
price (AGL-3998): prices are published on `/pricing`, so a price change owes
this page nothing.

## The link on a QR code

| Where it is handed out | Link |
| -- | -- |
| An event | `https://aglyn.com/managed?utm_source=event&utm_medium=qr&utm_campaign=<track>-<yyyy-mm-dd>` |
| Door to door | `https://aglyn.com/managed?utm_source=door&utm_medium=qr&utm_campaign=<town>` |
| Anything else (a card with no event on it) | `https://aglyn.com/managed?utm_source=print&utm_medium=qr&utm_campaign=managed-2026-10` |

A label is lowercase words joined by hyphens: `cota-mx-2026-10-25`,
`round-rock`. Never a person's name, an address or an email; the parser drops
an email-shaped value, and nothing else stops the rest.

**The event goes in `utm_campaign`, not `utm_content`.** The platform keeps
exactly three labels, `utm_source`, `utm_medium` and `utm_campaign`
(`libs/aglyn/src/lib/app-utils/utm-attribution.ts`, `utm-touch.ts`);
`utm_content` and `utm_term` are dropped on purpose. A link that put the event
in `utm_content` would land with no trace of which event it was.

## Add each event's label to the campaign before the QR goes out

In the console: Marketing → Campaigns → "Managed · Events and door to door" →
Edit → **utm_campaign labels**, and add the new label beside the ones already
there.

This is not optional. A label no campaign declares is a "bare" label, and on
the visit that ends in a submission the page's own campaign touch wins over a
bare label (`pickCampaignTouch` in
`libs/plugins/marketing/src/lib/server/campaign-conversion-attribution.ts`).
The submission is still credited to the campaign, but through the page, and
the record keeps none of the three labels, so the event is lost. A declared
label wins, and the record keeps `source`, `medium` and `campaign`.

One campaign answers to at most 20 labels (`CAMPAIGN_UTM_LABELS_MAX`). When a
month's events and towns pass that, start the next month's campaign
(`managed-2026-11`) the same way, file the page and the form under it too, and
point new QR codes at its labels.

## Where a submission lands

- the Inbox, with the form's alert to the site's notification recipients;
- the person as a contact in the CRM;
- `hosts/DXnRbPH4CQ/campaignAttributions/form:{submissionId}` (and
  `contact:…` and `lead:…`) with `campaignId`,
  `source`, `medium` and `campaign` when the link carried a declared label.

Following up is the sales routine's job: a lead from this form joins the
"One job" sequence that fits it, as every other inbound lead does.

## Lead routing is on

Lead routing for the form is on in production, so a submission also makes a
lead, and its attribution is written under `lead:…` as well.

`/api/health/funnel` grades an exact count of live lead forms against
`AGLYN_FUNNEL_MIN_LEAD_FORMS` on the `aglyn-tenant` Vercel project, so the
sixteenth form and that number had to move together. What was done on
2026-10-19:

1. At 06:03Z, `AGLYN_FUNNEL_MIN_LEAD_FORMS` on `aglyn-tenant` was raised from
   15 to 16.
2. Lead routing was turned on for the form `chjqg6-XOD`.
3. Production was redeployed (commit `8fb356b`) so the new number took effect.
4. `https://aglyn.com/api/health/funnel` then read `leadForms` 16 of 16, with
   no faults.

The next lead form that goes live owes the same pair of changes: raise the
number to match and redeploy, then read the health check until it shows the
new count with no faults.
