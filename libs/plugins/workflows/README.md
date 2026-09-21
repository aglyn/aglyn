# @aglyn/plugins-workflows

The Automation plugin: the console's **Automation** section —
Workflows, Actions and Webhooks — and the engine that runs what is built there.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/plugins-workflows@beta
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`) by the console and the tenant runtime; it is not a standalone library.

## The engine

`src/lib/engine/` holds the automation engine, and nothing outside this plugin
runs an automation:

- `workflow-steps.ts` — ONE STEP MODEL. A stored step is a function
  call or an Actions step, told apart by `type`; nothing is migrated. It also
  holds which Actions steps a workflow may run (every server-side one), the
  refusal for the rest, and the validation both editors use. Pure and
  client-safe: the console's step editor reads it too.
- `run-event-workflows.ts` and `run-event-actions.ts` — the runners. A host
  event runs the workflows triggered by it and the actions listening for it;
  the site-event dispatch runs one action a published page fired.
- `run-event-actions.ts` also holds the step executors — datasets, email,
  webhooks, lists, campaigns, alerts, custom events — and the flow steps —
  behind `runServerStep`, one step at a time, which is what lets a workflow
  perform an Actions step without a second copy of any of them. Its
  `executeWorkflow` is the workflow half: function calls through the pure
  evaluator, Actions steps through that executor, in one scope.
- `crm-action-steps.ts` — the five CRM steps.
- `flow-enrollments.ts` — where a person waits between one step of a flow and
  the next, resumed by the `resume-flow-waits` job. A workflow's enrollment id
  is kept apart from an action's, so the two kinds never share a row.

A run is metered once by whoever admitted it — `workflowRunsPerMonth` for a
workflow, `actionRunsPerMonth` for an action — however many steps it holds.
The Actions tier gates are taken step by step inside it.

The engine hears events through the tenant runtime's host-event seam
(`@aglyn/tenant-runtime/host-event-listeners`). The listener is registered by
`registerWorkflowsServerDeclarations` (`declarations.server.ts`), which both
apps call at boot from their generated server-declarations manifest, and again
by the plugin's API register functions. The declaration is light: the engine
itself is imported when the first event arrives, or when the plugin's API
surface loads.

The vocabulary the engine runs — event types, step types, limits, condition
shapes, validation — stays in the core (`@aglyn/aglyn/app-utils/actions` and
`@aglyn/aglyn/app-utils/workflows`), because the console, the AI plugin and
the core's own compose path read it too.

## Entry points

- `.` — the console extension (nav, the Automation page, the activity widget).
- `./server` — the tenant and console API surfaces: the inbound webhook, the
  flow-resume job, the automation draft writer.
- `./declarations.server` — the boot registration above.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/workflows
