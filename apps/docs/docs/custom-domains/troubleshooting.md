---
sidebar_position: 3
title: Troubleshoot verification
description: Fix the common reasons a custom domain won't verify.
---

# Troubleshoot verification

If the domain wizard won't verify, it's almost always DNS. Work through these.

:::info Plan availability
**Paid**.
:::

## Checklist

1. **Give it time.** DNS changes propagate on a TTL — wait a few minutes and re-run
   verification.
2. **Check the record type.** It must be a **CNAME** (not an A record) pointing at the
   hostname the wizard shows.
3. **Check the host field.** `www` connects `www.example.com`; a blank/`@` host targets the
   apex, which most registrars won't allow as a CNAME.
4. **Remove conflicts.** Delete any old A/AAAA/CNAME records for the same host that point
   elsewhere.
5. **Disable proxying temporarily.** If your DNS provider proxies traffic (e.g. an orange-cloud
   toggle), turn it off until verification succeeds.

## Still stuck?

Confirm the CNAME resolves from your machine, then re-run verification. Custom-domain CNAME
resolution and attachment are handled server-side once the record is correct.

## Related

- [Connect a domain](connect-a-domain.md)
