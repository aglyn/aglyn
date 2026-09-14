# @aglyn/plugins-ai

The Aglyn AI plugin (AGL-2939): the in-console assistant, the besigner copy
assistant, generative building and automation jobs, and the AI add-on's
billing and access keys — one first-party plugin, provider-generic.

- `providers/` — the provider contract, the registry (a marketplace plugin
  registers a provider against `AI_PROVIDER_CONTRACT`), the model catalog
  with rates and capabilities, the routing table, and two adapters:
  `anthropic.ts` and `openai-compatible.ts`.
- `runtime/` — the one runtime every door calls, the gate ladder, the answer
  cache, the palette and the node-tree validator.
- `jobs/` — the generation job machine, its steps and the beat.
- `activity/` — the activity codes the feed and the staff facet read.
- `usage/` — the meter every door reserves and records through: the org
  and per-user monthly rollups, the refusal counters, the Free taste's
  account and platform halves, the account-erasure sweep, and the staff
  readouts' arithmetic.
- `model/` — the generation job model and the per-user usage shapes and
  arithmetic the cards and the doors share, free of any server dependency.
- `server/` — the API handlers, registered under the `ai` and `assist`
  prefixes with `registerPluginApiRoute`.
- `components/` — the assistant dock, the billing, member and staff cards
  mounted through the console's widget zones, and the Assist signal staff
  page.
