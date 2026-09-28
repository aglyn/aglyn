---
sidebar_position: 4
title: Deliverability checks
description: "Why an email is not sent to a domain that takes no mail, when bulk mail waits behind a gateway refusing your sender, and how sender readiness reads SPF, DKIM and DMARC."
---

# Deliverability checks

Every email Aglyn sends is checked before it leaves — campaigns, workflow
emails, sequences, one-to-one CRM email, receipts, booking confirmations and
account email alike. The checks run on their own, for every organization;
there is nothing to switch on.

They ask two kinds of question:

- **Can this address receive mail at all?** A domain with no mail server
  bounces every message sent to it, and every bounce counts against the
  sender's reputation.
- **Is the recipient's mail gateway refusing this sender?** Some companies
  put a security gateway — Barracuda, Proofpoint, Mimecast — in front of
  their mail, and a gateway refuses a *sender* for everyone behind it. The
  next person at that company bounces the same way.

The answers come from public DNS and from what happened to earlier mail, and
they are shared: a recipient domain's mail servers are looked up once and
remembered for a week, so the first organization to write to a domain warms
the answer for everyone.

## Every send: a domain with no mail server {#no-mail-server}

Before any message is handed to the mail provider, each recipient's domain is
checked for a mail server (its MX record). A domain that publishes **no MX
record**, or the **null MX** record (`.`) that says "this domain takes no
mail", has nowhere to deliver to, so the message is **not sent**:

- the address is refused for that send, with the reason;
- the address is added to the [platform suppression list](./overview.md#platform-suppressions)
  with the reason **No mail server**, so later mail skips it too;
- only the address is listed, never the domain — a whole domain is never
  suppressed on the strength of one lookup.

This applies to **every** email, including account and transactional mail: a
message to a domain that cannot receive mail can only bounce.

A lookup that goes unanswered is treated as unknown, and **unknown sends**. A
"no mail server" answer stops mail only when two separate resolvers agree on
it, and an old "no mail server" answer is never reused to stop a send when a
fresh lookup cannot be made. A domain with no MX record but an address record
still receives mail at that address (the implicit MX), so it is sent to, with
a warning where a surface shows one.

## Bulk mail: the gateway hold {#gateway-hold}

What each gateway did with your mail is learned from outcomes. Every delivery
is credited to the gateway in front of the recipient, and a hard bounce that
reads as the gateway refusing the **sender** — not an unknown address —
counts as a refusal. Both the mail provider's bounce reports and a connected
mailbox's bounce messages feed it.

When a gateway has refused mail from a sending domain **twice in the last
thirty days and delivered none of it**, bulk mail from that sending domain to
anyone behind that gateway **waits**. Bulk mail means:

- email campaigns;
- workflow emails;
- sequences.

The hold is keyed by the **sending domain**, not by your organization or the
recipient: the gateway is judging the reputation of the domain in the `From:`
line. Mail from a different sending domain is not held, and a hold on a
shared sending domain is visible to Aglyn staff because it affects every site
on it. A delivery through the gateway clears the hold, and so does time: once
fewer than two refusals remain in the thirty-day window, mail goes again.

A held recipient is skipped for that send and the reason is recorded. In
Sequences, a held enrollment pauses as **Held — gateway refused this sender
twice** and **Resume** sends it anyway; see [mail gateways in
Sequences](../../content-and-data/crm/sequences.md#mail-gateways).

## Transactional mail is never held {#transactional-mail}

Mail a person asked for — a password reset, a receipt, a booking
confirmation, an account notice — is **never held for a gateway**. It is only
refused when the recipient's domain has no mail server at all. A gateway's
opinion of your campaigns must not stop a customer from resetting their
password.

## When an address arrives {#when-an-address-arrives}

Addresses are checked when they enter the workspace, not only when mail is
sent to them. A lead or contact created in the CRM, a CSV import, a form
submission and an address added to an email list each look the domain up in
the background, without slowing the save:

- an address whose domain takes no mail is marked **Would bounce** in its
  email state, and nothing is sent to find out;
- the gateway in front of the domain is shown beside the address, the same
  chip Sequences shows.

The **Leads** and **Contacts** lists filter by **Would bounce**, so the
addresses to fix or remove can be found in one step, and an import reports how
many of the addresses it brought in have no mail server.

## Before a campaign sends {#before-a-campaign-sends}

The campaign's send review counts the recipients the checks take out and
says why, in one line:

> 3 recipients excluded: 2 no mail server · 1 behind a gateway that refused this sender

Those recipients are skipped when the campaign sends; everyone else receives
it. See [see who it will reach](./overview.md#recipient-count).

## Before a one-to-one email {#before-a-one-to-one-email}

The CRM's compose window checks the recipient before you send, and warns when
the address would bounce or sits behind a gateway that has been refusing your
sending domain. It warns rather than blocks for a gateway: a one-to-one email
is your call.

## Sender readiness {#sender-readiness}

The recipient's side is only half of it. Receivers decide whether mail really
comes from your domain by three records **you** publish:

| Record | Where it lives | What it does |
| --- | --- | --- |
| **SPF** | The envelope domain | Names the servers allowed to send for the domain. It should name your mail provider and end in `~all` or `-all`; `+all` lets anyone send as you. |
| **DKIM** | `<selector>._domainkey.<domain>` | The public key the message signature is checked against. |
| **DMARC** | `_dmarc.<domain>` | Says what a receiver does with mail that fails (`p=none`, `quarantine` or `reject`) and where aggregate reports go (`rua`). |

Having all three is not enough: DMARC passes only when SPF or DKIM passes
**for a domain that lines up with the `From:` domain** — its alignment. So
**Sender readiness** shows each record and then whether they align:

- **Pass** on alignment means DMARC passes on DKIM, which survives forwarding.
- **Check** means DMARC passes on SPF alone, which forwarding breaks, or a
  record is present but weaker than it should be (`?all`, no closing `all`,
  `p=none` with no `rua` address to report to, no DMARC policy at all).
- **Fail** means receivers cannot confirm the mail is from your domain: no
  SPF, more than one SPF record, a missing or revoked DKIM key, or nothing
  that aligns.
- **Not answered** means a lookup went unanswered. Nothing is known to be
  wrong; check again in a few minutes.

It appears in two places:

- **Emails → Sending**, on a sending domain once its records are issued: SPF
  on the `send.` subdomain, the domain's own DKIM selector, and the domain's
  DMARC policy. The records table on the same card says what to publish; the
  verification decides whether the domain may send; readiness is how
  receivers will judge it. **Check DNS** reads the zone fresh.
- **Sequences → Mailboxes**, on each connected mailbox: the domain of the
  address it sends as, with Google's SPF include (`_spf.google.com`) and
  Google's `google` DKIM selector. A consumer Gmail address has nothing to
  publish, and the card says so. **Check DNS again** reads the zone fresh.

A subdomain with no DMARC record of its own is judged by its organizational
domain's record (its `sp=` policy, when it sets one). Answers are remembered
for ten minutes, so a card that renders often does not ask DNS every time.
Aglyn reads your DMARC policy and never asks you to weaken it.

## What Aglyn never does {#what-aglyn-never-does}

- **No SMTP probing.** Aglyn never connects to a recipient's mail server to
  ask whether an address exists (an `RCPT TO` probe). Receivers treat probing
  as abuse and blocklist the sender who does it, so every check here uses
  public DNS and the outcomes of mail that was really sent.
- No catch-all detection and no paid verification service: an address whose
  domain takes mail is sent to, and a bounce is what teaches the ledger.

## Related

- [Email campaigns](./overview.md)
- [Sequences](../../content-and-data/crm/sequences.md)
- [CRM](../../content-and-data/crm/overview.md)
