# Self-hosting Aglyn

Run the entire Aglyn platform — the console and the tenant runtime that serves
your published sites — on your own infrastructure with Docker: any cloud, a
VPS, or bare metal. (AGL-904..906)

**What self-hosting v1 is:** the same Apache-2.0 code Aglyn's cloud runs,
pointed at **your own Firebase project** and your own Stripe/Resend keys. You
own the data, the infrastructure, and the domains.

**What it is not (yet):** Google-free. Firebase (Auth, Firestore, Storage,
Realtime Database, Remote Config) is the platform's identity and data layer.
A vendor-neutral backend (Postgres/S3/OIDC-style) is a separate roadmap track
(AGL-909). If your constraint is "no Google services at all," wait for that
track.

---

## Prerequisites

- Docker with Compose v2 (BuildKit enabled — default on current Docker).
- A Google account to create a free-tier Firebase project.
- Node ≥ 24 + the Firebase CLI **on your workstation** (one-time setup steps
  only; the containers don't need them).
- Two DNS names you control: one for the console (e.g.
  `console.example.com`) and a **wildcard** for published sites (e.g.
  `*.sites.example.com`).

## 1. Create your Firebase project

1. [console.firebase.google.com](https://console.firebase.google.com) → Add
   project.
2. Enable **Authentication** (Email/Password, plus Google or other OAuth
   providers you want), **Cloud Firestore**, **Storage**, and **Realtime
   Database**. Remote Config is used for release flags; the defaults compiled
   into the code apply when you leave it untouched.
3. Project settings → General → Your apps → add a **Web app** → copy the SDK
   config into the `NEXT_PUBLIC_FIREBASE_*` variables of your env file (step
   3).
4. Project settings → Service accounts → **Generate new private key** → copy
   the JSON fields into the `FIREBASE_*` variables.

## 2. Deploy the security rules to your project

The rules ship in this repo and deploy with the same scripts we use:

```bash
npm install
cp .env.selfhost.example .env    # the deploy scripts read .env
# fill in the FIREBASE_* service-account block first
node tools/scripts/deploy-firestore-rules.mjs
node tools/scripts/deploy-storage-rules.mjs
node tools/scripts/deploy-database-rules.mjs
```

Storage rules are deny-all **by design** — media flows through tokened URLs
and the Admin SDK, not direct client reads.

## 3. Configure the environment

```bash
cp .env.selfhost.example .env.selfhost
```

Fill it in following the comments. Two rules matter:

- `NEXT_PUBLIC_*` values are **baked into the client bundles at image build
  time**. Changing one means rebuilding the images, not just restarting.
- `TOKEN_SIGNING_SECRET` must be identical for console and tenant (compose
  shares one file, so it is). The code fails closed without it.

## 4. Build and run

```bash
docker compose up --build
```

- Console: `http://localhost:4200`
- Tenant runtime: `http://localhost:4500`

The first account you create is yours; grant yourself staff access with
`node tools/scripts/set-staff-claim.mjs` if you want the admin surfaces.

## 5. Put a reverse proxy in front

Terminate TLS at your proxy (Caddy, nginx, Traefik) and route:

- `console.example.com` → `console:4200`
- `*.sites.example.com` → `tenant:4500` (the tenant app resolves the host
  header to the right published site)

Caddy example:

```caddy
console.example.com {
  reverse_proxy localhost:4200
}
*.sites.example.com {
  reverse_proxy localhost:4500
}
```

Custom domains for individual sites work the same way: point the customer
domain at your proxy and route it to `tenant:4500`.

## Honest limits

| Area | Self-hosted behavior |
| --- | --- |
| Firebase | **Required.** Auth, Firestore, Storage, RTDB, Remote Config run in *your* project (free tier is fine to start). |
| Custom-domain self-service | The in-console attach flow is Vercel-specific and returns 501 without Vercel credentials. Attach domains at your reverse proxy instead (above). |
| Stripe | Optional. Without `STRIPE_SECRET_KEY`, commerce checkout and paid platform plans are unavailable; the rest of the platform runs. |
| Resend | Optional. Without `RESEND_API_KEY`, app email (invites, receipts, campaigns) is an inert no-op. |
| AI assist | Degrades gracefully without an Anthropic key. |
| Texas sales-tax report | Optional, and blank by default. The staff `/admin/tax-return` report is built around a single US-TX registration. Set `TX_WEBFILE_NUMBER` / `TX_TAXPAYER_NUMBER` to *your own* Comptroller identifiers to have them appear on the page and in the exported working papers; leave them unset and both surfaces say "not configured" rather than printing anything. They are **server-only** — never prefix either with `NEXT_PUBLIC_`, which would inline them into a client bundle served without authentication. Aglyn LLC's own values are not in this repository (AGL-2021). |
| Updates | `git pull && docker compose up --build`. Watch the release notes for Firestore rules changes and re-run the deploy scripts when they change. |

## Local development without Docker

The contributor path also works for kicking the tires — `npm install`,
`cp .env.example .env`, `npx nx serve console` — including fully offline
against the Firebase emulators (`npm run serve:console:emulated`; see
`docs/E2E_LOCAL.md`).
