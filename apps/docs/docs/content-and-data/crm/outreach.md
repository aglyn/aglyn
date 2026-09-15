---
sidebar_position: 15
title: Outreach
description: One-to-one email sequences a rep sends to a person from their own connected mailbox, kept with the CRM. Rolling out.
---

# Outreach

:::caution Rolling out
Outreach is a **release-flagged feature, currently being rolled out** — it is
not available in your workspace yet. This page says what it is for, and grows
with the feature.
:::

## What it is for

Outreach is for one-to-one selling. A rep writes a short **sequence** — a
first email and the follow-ups after it, each a set number of days apart — and
enrolls people from the CRM in it. Every email goes to one person, as a message
from the rep rather than as a campaign.

It is not a way to send one message to an audience. That is what
[email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
are for, sent from your site's sending identity to a segment of your contacts.

## Sent from your own mailbox

Outreach sends from the **rep's own mailbox**, connected to the workspace
through the rep's Google account. The email leaves from that address, sits in
that rep's sent mail like any other, and a reply comes back to the same inbox
— which is what makes it a conversation between two people rather than a
broadcast.

## Where it lives

Outreach is a tab of its own at the **organization** level, beside the CRM, at
`…/{organization}/outreach`. It has two sections: **Sequences** and
**Mailboxes**.

Opening it takes the **Use Outreach** permission, which owners and admins hold
by default. A [custom role](../../workspace-and-billing/teams-and-roles/custom-roles.md)
can grant it to other members of the organization. A collaborator added to
particular sites cannot open it, because Outreach covers the whole
organization.

## Connect a mailbox {#connect-a-mailbox}

Each rep connects their **own** Google mailbox in **Outreach → Mailboxes**:

1. Select **Connect with Google** and choose your Google account.
2. Google asks you to let Outreach **send email on your behalf** and **read
   your email**. Allow both. Sending is how a sequence's messages go out as
   you; reading is how Outreach notices a reply or a bounce, so a sequence
   stops when somebody answers. If either is left unticked, the connection is
   refused and nothing is saved.
3. You come back to Mailboxes with the mailbox listed as **Active**.

The access Google grants is stored encrypted and is never shown to anyone,
administrators included. Connecting the same Google account again updates the
mailbox you already have and keeps its settings. Each member can connect up to
five mailboxes.

If Mailboxes says connecting a Google mailbox isn't configured, your deployment
has no Google OAuth client set up. On a self-hosted install, see
[Environment variables](../../developers/self-hosting-environment.md#outreach).

### Send-as address and display name {#send-as}

A mailbox sends **as** one address: the account's own, or an alias Gmail has
already verified for it — one added under **Settings → Accounts → Send mail
as** in Gmail and confirmed there. Outreach only offers addresses Gmail lists
as verified. To use a new alias, add it in Gmail first, then connect the
mailbox again so Outreach sees it.

If the same address is waiting for verification under
[Your sending addresses](./settings.md#your-sending-addresses), connecting the
mailbox verifies it there too, because Gmail has already confirmed you can send
as it.

The **display name** is the name recipients see beside the address.

### Daily cap, warm-up and sending window {#daily-cap}

- **Daily cap** — the most the mailbox sends in one day. It starts at **20**
  and can be set up to **50**.
- **Warm-up** — a newly connected mailbox ramps up: at most **10** a day in
  its first week, **20** in its second and **30** from its third. The daily
  cap still applies, so a mailbox capped at 20 never sends more than 20.
- **Sending window** — the days of the week and the hours the mailbox sends
  in, read in the mailbox's **timezone**. A message that comes due outside the
  window waits for the next opening.

Google Workspace itself allows each user 2,000 messages and 2,000 unique
external recipients a day, aliases included; the caps here keep a mailbox far
below that.

### Status and health {#mailbox-status}

| Status | What it means |
| --- | --- |
| **Active** | The mailbox can send. |
| **Paused** | Somebody paused it. Nothing sends from it until it is resumed. |
| **Reconnect required** | Google stopped accepting the connection — the password changed, access was removed from the Google account, or an administrator revoked it. Nothing sends until you connect the mailbox again. |

**Health** shows the last seven days: messages sent, bounces and replies. A
mailbox that has never sent shows zeros and **No sends yet**.

### Test, pause and disconnect {#mailbox-actions}

- **Send a test to myself** sends a short plain-text message from the mailbox
  to its own address, so you can check it arrives. Only the member who
  connected the mailbox can send one.
- **Pause** stops the mailbox sending; **Resume** starts it again.
- **Disconnect** removes the mailbox and deletes its stored access, and tells
  Google to revoke that access. If another connected mailbox still uses the
  same Google account — a shared inbox two members connected — the access is
  left in place for that mailbox. You can always remove access yourself from
  your Google Account's third-party connections.

Organization owners and admins can change the settings of, pause and
disconnect any member's mailbox — a departing rep's mailbox has to be
stoppable by somebody. Other members manage only their own.

## Related

- [CRM](./overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)
- [Custom roles](../../workspace-and-billing/teams-and-roles/custom-roles.md)
