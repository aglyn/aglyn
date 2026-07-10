---
sidebar_position: 2
title: Connect a domain
description: Point your own domain at your Aglyn site with a CNAME and DNS verification.
---

# Connect a domain

Move your site from its Aglyn subdomain to a domain you own.

:::info Plan availability
**Paid**.
:::

## Steps

1. In **Setup**, open the **custom domain** tab and start the **wizard**.
2. Enter the domain (e.g. `www.example.com`).
3. At your registrar's DNS settings, add the record the wizard shows — usually a **CNAME**
   from your domain to the target Aglyn hostname.
4. Back in Aglyn, run **verification**. Aglyn checks DNS and resolves the CNAME.
5. Once it verifies, your site serves on the custom domain.

## Registrar quick reference

The exact screen differs by registrar, but the record is the same:

| Field | Value |
| --- | --- |
| Type | `CNAME` |
| Name / Host | `www` (or the subdomain you're connecting) |
| Value / Target | the hostname the wizard shows |
| TTL | default is fine |

:::tip Apex domains
`CNAME` records can't sit on a bare apex (`example.com`) at most registrars. Connect `www`
and use your registrar's forwarding/ALIAS/ANAME feature for the apex, or follow the wizard's
guidance.
:::

## Related

- [Troubleshoot verification](troubleshooting.md)
- [Redirects](../redirects/overview.md)
