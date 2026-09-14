# @aglyn/plugins-ai

The Aglyn AI plugin (AGL-2939): the in-console assistant, the besigner copy
assistant, generative building and automation jobs, and the AI add-on's
billing and access keys — one first-party plugin, provider-generic.

- `providers/` — the provider contract, the registry (a marketplace plugin
  registers a provider against `AI_PROVIDER_CONTRACT`), the model catalog
  with rates and capabilities, the routing table, and two adapters:
  `anthropic.ts` and `openai-compatible.ts`.
- `plugin-config.ts` — the `pluginSettings/ai` schema: the provider and the
  catalog model each kind of step runs on.
