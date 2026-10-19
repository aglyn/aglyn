---
sidebar_position: 2.5
title: Connect a domain automatically
description: For a domain you already own, let your DNS provider add Aglyn's records for you in one click instead of copying them by hand.
unlisted: true
---

# Connect a domain automatically

If you already own a domain, your DNS provider may be able to add Aglyn's records for
you. GoDaddy, IONOS, Cloudflare and other providers support **Domain Connect**, an
open standard for exactly this: you approve the change on your provider's own page,
and there are no records to copy.

## Steps {#steps}

1. In the site's **Admin** page, choose **Custom Domain**.
2. Type your domain into the **Domain** field of the **Custom domain** card.
3. If your DNS provider supports it, a button appears under the field:
   **Connect automatically with** *your provider*. Press it.
4. Your provider opens in a new window. Sign in there and approve the change.
5. Come back to Aglyn. The card says **Waiting for** *your provider*…, then
   **Checking your domain…**, and connects the domain as soon as the records answer.

Aglyn never sees your password at your provider: you sign in on the provider's own
page, and it writes only the records Aglyn's template names. For a bare domain like
`yourbusiness.com`, that is the domain and its `www` address, so both work.

## If there's no button {#no-button}

Your provider doesn't support Domain Connect for this domain, or hasn't approved
Aglyn's template yet. Add the record the card shows instead — see
[Connect a domain](connect-a-domain.md#steps).

## If it doesn't finish {#problems}

DNS changes can take a little while to reach the internet. If you closed the page, the
connection still finishes on its own once the records answer, within 48 hours. If they
never do, the card says so; add the records by hand, or try again.
