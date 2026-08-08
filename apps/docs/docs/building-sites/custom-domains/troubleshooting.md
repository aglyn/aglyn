---
sidebar_position: 3
title: Troubleshoot verification
description: Fix the common reasons a custom domain won't verify or attach.
---

# Troubleshoot verification

If **Verify & connect** won't go green, it's almost always DNS. Work through these.

:::info Plan availability
**Starter and above.**
:::

![Domain status in site setup](/img/custom-domains/setup-domains.png)

## Checklist

1. **Give it time.** DNS changes propagate on a TTL — wait a few minutes and press
   **Verify & connect** again. Aglyn resolves your record through public DNS resolvers,
   so a change your registrar shows as saved can still take a while to be visible.
2. **Read the message.** A failed verify tells you what it found: either the record it
   saw and the target it expected, or that no record exists yet. That's usually the
   whole diagnosis.
3. **Match the record to the name.**
   - A **subdomain** (`www.example.com`) needs a **CNAME** to `sites.aglyn.app`.
   - A **bare apex** (`example.com`) needs an **A record** to `216.198.79.1` (or an
     ALIAS/ANAME to `sites.aglyn.app`) — an apex cannot carry a CNAME, and Aglyn
     verifies it by its A record instead.
4. **Remove conflicting records.** Delete any old A/AAAA/CNAME records for the same
   host that point elsewhere. Two cases bite hardest:
   - An apex with a **wrong CNAME** (some DNS hosts allow one) never falls through to
     the A-record check — remove the CNAME so the A record can be evaluated.
   - A **stale A record** left over from a previous host answers alongside your ALIAS
     and wins unpredictably — delete the old A record outright.
5. **Disable proxying temporarily.** If your DNS provider proxies traffic (e.g. an
   orange-cloud toggle), the record resolves to the proxy's addresses instead of
   Aglyn's. Turn it off until verification succeeds.

## Verified but not serving?

Verification and attachment are separate steps under one button. If DNS verified but
the platform attachment failed, the domain chip reads **"— attachment pending"** —
press **Retry attachment** on the card. The same button (labeled **Re-attach** on a
healthy domain) also re-runs attachment if the site serves certificate errors; a
successful run confirms that SSL provisions shortly.

If connecting answers *"That domain is already connected to another site"*, the domain
is attached to a different Aglyn site — every domain can serve only one. Disconnect it
there first.

## Still stuck?

Confirm the record resolves from your machine (`dig www.example.com CNAME` or
`dig example.com A`), then press **Verify & connect** again. Remember that Aglyn checks
DNS **at connect time only** — a record you change after connecting isn't re-checked,
so a site that stops resolving after a DNS edit needs the record fixed (or the domain
disconnected and reconnected), not more waiting.

## Related

- [Connect a domain](connect-a-domain.md)
