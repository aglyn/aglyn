package com.aglyn.plugins.workflows

import com.aglyn.contracts.ACTION_NAME_MAX
import com.aglyn.contracts.Doc
import com.aglyn.contracts.ORG_AUTOMATION_TRIGGER_EVENTS
import com.aglyn.contracts.ORG_SCOPE_TOKEN
import com.aglyn.contracts.SITE_EVENT_TYPES
import com.aglyn.contracts.asDoc
import com.aglyn.contracts.hostEventTypes
import com.aglyn.contracts.hostIdsFromScope
import com.aglyn.contracts.hostScopeToken
import com.aglyn.contracts.isOrgWideScope
import com.aglyn.contracts.jsNumber
import com.aglyn.contracts.jsString
import com.aglyn.contracts.normalizeTriggerConditions
import com.aglyn.contracts.str

/*
 * The editors' drafts, and the documents and bodies they save as: the
 * console's `draftFromAction`, its save's candidate, `conditionRowsFromTrigger`
 * / `conditionsFromRows`, the workflow card's draft and the org editor's
 * `orgAutomationDraft` / `orgAutomationBody`. Pure, so the specs hold each.
 */

const val CUSTOM_EVENT_VALUE = "__custom__"
const val FORM_IS_OP = "formIs"
const val FORM_ID_FIELD = "formId"

/** One condition row; a lone row with no op means "always run". */
data class ConditionRow(val op: String = "", val field: String = "", val value: String = "")

val EMPTY_CONDITION_ROW = ConditionRow()

/** A stored trigger's clauses as rows: `formId equals …` reads as "Form is", none as the lone "always" row. */
fun conditionRowsFromTrigger(trigger: Doc?): List<ConditionRow> {
  val rows = normalizeTriggerConditions(trigger).map { condition ->
    val field = condition["field"]?.let(::jsString) ?: ""
    val value = condition["value"]?.let(::jsString) ?: ""
    if (field.trim() == FORM_ID_FIELD && condition["op"] == "equals") ConditionRow(FORM_IS_OP, FORM_ID_FIELD, value)
    else ConditionRow(condition["op"] as? String ?: "", field, value)
  }
  return rows.ifEmpty { listOf(EMPTY_CONDITION_ROW) }
}

/** The rows as the stored clauses and combinator, or nothing when every row says "always". Blank fields are kept for the validator. */
fun conditionsFromRows(rows: List<ConditionRow>, combinator: String): Doc {
  if (rows.none { it.op.isNotEmpty() }) return emptyMap()
  return linkedMapOf(
    "conditions" to rows.filter { it.op.isNotEmpty() }.map { row ->
      if (row.op == FORM_IS_OP) {
        linkedMapOf("field" to FORM_ID_FIELD, "op" to "equals", "value" to row.value.trim())
      } else {
        linkedMapOf<String, Any?>("field" to row.field.trim(), "op" to row.op).apply { if (row.op != "notEmpty") put("value", row.value.trim()) }
      }
    },
    "combinator" to combinator,
  )
}

/** Changes a row's op as the console's select does: "Form is" starts a fresh form row, leaving it clears the field. */
fun withOp(row: ConditionRow, op: String): ConditionRow = when {
  op == FORM_IS_OP -> ConditionRow(op, FORM_ID_FIELD, "")
  row.op == FORM_IS_OP -> ConditionRow(op, "", "")
  else -> row.copy(op = op)
}

// ── Actions ───────────────────────────────────────────────────────────────

data class ActionDraft(
  val id: String?,
  val name: String = "",
  /** A host event, a site event, or [CUSTOM_EVENT_VALUE]. */
  val event: String = "formSubmission",
  val customEvent: String = "",
  val filter: String = "",
  val selector: String = "",
  val threshold: String = "",
  val pathPattern: String = "",
  val oncePerVisitor: Boolean = false,
  val oncePerSession: Boolean = false,
  val everyTime: Boolean = false,
  val cooldownMinutes: Double? = null,
  val conditionRows: List<ConditionRow> = listOf(EMPTY_CONDITION_ROW),
  val combinator: String = "and",
  val steps: List<Doc> = listOf(defaultStep("siteAlert")),
  val enabled: Boolean = true,
  /** The recipe stamp as stored: present (an id or null) or absent, which an edit keeps absent. */
  val recipe: Any? = null,
  val hasRecipe: Boolean = true,
) {
  /** The trigger's event as it will be saved. */
  val savedEvent: String get() = if (event == CUSTOM_EVENT_VALUE) customEvent.trim() else event

  /** The Frequency select's value. */
  val frequency: String
    get() = when {
      oncePerVisitor -> "visitor"
      oncePerSession -> "session"
      (cooldownMinutes ?: 0.0) >= 1 -> "cooldown"
      everyTime -> "every"
      else -> ""
    }

  fun withFrequency(mode: String): ActionDraft = copy(
    everyTime = mode == "every",
    oncePerVisitor = mode == "visitor",
    oncePerSession = mode == "session",
    cooldownMinutes = if (mode == "cooldown") (cooldownMinutes?.takeIf { it >= 1 } ?: 60.0) else null,
  )
}

val FREQUENCY_OPTIONS = listOf(
  "" to "Every matching pageview",
  "every" to "Every occurrence (repeatable)",
  "session" to "Once per session",
  "visitor" to "Once per visitor",
  "cooldown" to "With a cooldown",
)

/** A stored action as the editor holds it (`draftFromAction`). */
fun actionDraftOf(action: Doc, id: String?): ActionDraft {
  val trigger = action["trigger"].asDoc() ?: emptyMap()
  val stored = trigger.str("event") ?: ""
  val builtIn = stored in hostEventTypes || stored in SITE_EVENT_TYPES
  val cooldown = trigger["cooldownMinutes"]?.let(::jsNumber)?.takeIf { it >= 1 }
  return ActionDraft(
    id = id,
    name = action["name"]?.let(::jsString) ?: "",
    event = if (builtIn) stored else CUSTOM_EVENT_VALUE,
    customEvent = if (builtIn) "" else stored,
    filter = trigger["filter"]?.let(::jsString) ?: "",
    selector = trigger["selector"]?.let(::jsString) ?: "",
    threshold = trigger["threshold"]?.let(::jsString) ?: "",
    pathPattern = trigger["pathPattern"]?.let(::jsString) ?: "",
    oncePerVisitor = trigger["oncePerVisitor"] == true,
    oncePerSession = trigger["oncePerSession"] == true,
    everyTime = trigger["everyTime"] == true,
    cooldownMinutes = cooldown,
    conditionRows = conditionRowsFromTrigger(trigger),
    combinator = if (trigger["combinator"] == "or") "or" else "and",
    steps = (action["steps"] as? List<*>)?.mapNotNull { it.asDoc() } ?: emptyList(),
    enabled = action["enabled"] != false,
    recipe = action["recipe"],
    hasRecipe = action.containsKey("recipe"),
  )
}

/** The action a save validates and writes: only what is set, conditions from the rows. */
fun actionCandidate(draft: ActionDraft): Doc {
  val trigger = linkedMapOf<String, Any?>("event" to draft.savedEvent)
  draft.filter.trim().takeIf { it.isNotEmpty() }?.let { trigger["filter"] = it }
  draft.selector.trim().takeIf { it.isNotEmpty() }?.let { trigger["selector"] = it }
  jsNumber(draft.threshold.ifBlank { "NaN" }).takeIf { it > 0 }?.let { trigger["threshold"] = it }
  draft.pathPattern.trim().takeIf { it.isNotEmpty() }?.let { trigger["pathPattern"] = it }
  if (draft.oncePerVisitor) trigger["oncePerVisitor"] = true
  if (draft.oncePerSession) trigger["oncePerSession"] = true
  draft.cooldownMinutes?.takeIf { it >= 1 }?.let { trigger["cooldownMinutes"] = it }
  if (draft.everyTime) trigger["everyTime"] = true
  trigger.putAll(conditionsFromRows(draft.conditionRows, draft.combinator))
  return linkedMapOf<String, Any?>(
    "name" to draft.name.trim().take(ACTION_NAME_MAX),
    "trigger" to trigger,
    "steps" to draft.steps,
    "enabled" to draft.enabled,
  ).apply { if (draft.hasRecipe) put("recipe", draft.recipe) }
}

// ── Workflows ─────────────────────────────────────────────────────────────

data class WorkflowDraft(
  val id: String?,
  val name: String = "",
  val steps: List<Doc> = listOf(emptyCall()),
  val returnValue: String = "",
  /** `{event, filter}`, or null for manual only. */
  val trigger: Doc? = null,
)

fun emptyCall(): Doc = linkedMapOf("functionName" to "", "args" to emptyList<String>(), "resultName" to "")

fun workflowDraftOf(row: Doc, id: String): WorkflowDraft = WorkflowDraft(
  id = id,
  name = row["name"]?.let(::jsString) ?: "",
  steps = (row["steps"] as? List<*>)?.mapNotNull { it.asDoc() } ?: emptyList(),
  returnValue = row["returnValue"] as? String ?: "",
  trigger = row["trigger"].asDoc(),
)

/** What a workflow save writes: the definition, the name trimmed and capped. */
fun workflowFields(draft: WorkflowDraft): Doc = linkedMapOf(
  "name" to draft.name.trim().take(ACTION_NAME_MAX),
  "steps" to draft.steps,
  "returnValue" to draft.returnValue,
  "trigger" to draft.trigger,
)

/** A trigger pick: an event keeps the filter typed so far; manual only drops it. */
fun withWorkflowTrigger(draft: WorkflowDraft, event: String): WorkflowDraft =
  draft.copy(trigger = if (event.isEmpty()) null else linkedMapOf("event" to event, "filter" to (draft.trigger?.get("filter")?.let(::jsString) ?: "")))

/** A result name as the field keeps it: letters, digits and underscores. */
fun resultNameOf(text: String): String = text.filter { it.isLetterOrDigit() && it.code < 128 || it == '_' }

// ── Org automations ───────────────────────────────────────────────────────

data class OrgAutomationDraft(
  val id: String?,
  val name: String = "",
  val event: String = "formSubmission",
  val filter: String = "",
  val conditionRows: List<ConditionRow> = listOf(EMPTY_CONDITION_ROW),
  val combinator: String = "and",
  val steps: List<Doc> = listOf(defaultStep("sendEmail")),
  val enabled: Boolean = true,
  /** `org` (every site) or `sites`. */
  val placement: String = "org",
  val siteIds: List<String> = emptyList(),
)

fun orgAutomationDraftOf(row: Doc, id: String): OrgAutomationDraft {
  val trigger = row["trigger"].asDoc()
  val event = trigger.str("event")?.takeIf { it in ORG_AUTOMATION_TRIGGER_EVENTS } ?: "formSubmission"
  val visibleTo = row["visibleTo"] as? List<*>
  return OrgAutomationDraft(
    id = id,
    name = row["name"]?.let(::jsString) ?: "",
    event = event,
    filter = trigger?.get("filter")?.let(::jsString) ?: "",
    conditionRows = conditionRowsFromTrigger(trigger),
    combinator = if (trigger?.get("combinator") == "or") "or" else "and",
    steps = (row["steps"] as? List<*>)?.mapNotNull { it.asDoc() } ?: emptyList(),
    enabled = row["enabled"] != false,
    placement = if (isOrgWideScope(visibleTo)) "org" else "sites",
    siteIds = hostIdsFromScope(visibleTo),
  )
}

fun draftPlacement(draft: OrgAutomationDraft): List<String> =
  if (draft.placement == "org") listOf(ORG_SCOPE_TOKEN) else draft.siteIds.map(::hostScopeToken)

/** What the manage route is sent (`orgAutomationBody`). */
fun orgAutomationBody(draft: OrgAutomationDraft): Doc {
  val trigger = linkedMapOf<String, Any?>("event" to draft.event)
  draft.filter.trim().takeIf { it.isNotEmpty() }?.let { trigger["filter"] = it }
  trigger.putAll(conditionsFromRows(draft.conditionRows, draft.combinator))
  return linkedMapOf(
    "name" to draft.name.trim(),
    "trigger" to trigger,
    "steps" to draft.steps,
    "enabled" to draft.enabled,
    "visibleTo" to draftPlacement(draft),
  )
}

// ── Webhooks ──────────────────────────────────────────────────────────────

data class WebhookDraft(
  val name: String = "",
  val direction: String = "outbound",
  val url: String = "",
  val workflowName: String = "",
  val secret: String,
)

/** Why the webhook cannot be saved, in the console's words, or null. */
fun webhookDraftProblem(draft: WebhookDraft): String? = when {
  draft.direction == "outbound" && !WEBHOOK_URL_PATTERN.matches(draft.url.trim()) -> "Outbound URLs must be public https addresses"
  draft.direction != "outbound" && draft.workflowName.isBlank() -> "Pick the workflow this endpoint runs"
  else -> null
}

// ── Steps ─────────────────────────────────────────────────────────────────

/** The step a kind becomes when it is picked (`defaultStep`). */
fun defaultStep(type: String): Doc = when (type) {
  "runWorkflow" -> linkedMapOf("type" to type, "workflowName" to "")
  "siteAlert" -> linkedMapOf("type" to type, "message" to "", "severity" to "info")
  "customEvent" -> linkedMapOf("type" to type, "eventName" to "")
  "webhookPost" -> linkedMapOf("type" to type, "webhookName" to "")
  "showOverlay" -> linkedMapOf("type" to type, "overlayId" to "")
  "stickyNav" -> linkedMapOf("type" to type, "selector" to "")
  "addClass", "removeClass", "toggleClass" -> linkedMapOf("type" to type, "selector" to "", "className" to "")
  "showElement", "hideElement", "toggleElement" -> linkedMapOf("type" to type, "selector" to "")
  "setAttribute" -> linkedMapOf("type" to type, "selector" to "", "name" to "", "value" to "")
  "removeAttribute" -> linkedMapOf("type" to type, "selector" to "", "name" to "")
  "scrollTo", "playVideo" -> linkedMapOf("type" to type, "selector" to "")
  "openDrawer", "closeDrawer", "toggleDrawer", "openMenu", "closeMenu", "toggleMenu", "exitFlow" -> linkedMapOf("type" to type)
  "showHtml" -> linkedMapOf("type" to type, "html" to "")
  "runJs" -> linkedMapOf("type" to type, "code" to "")
  "redirect" -> linkedMapOf("type" to type, "url" to "")
  "trackGaEvent" -> linkedMapOf("type" to type, "eventName" to "")
  "sendEmail" -> linkedMapOf("type" to type, "subject" to "", "body" to "")
  "notifyAdmins" -> linkedMapOf("type" to type, "title" to "")
  "enrollList" -> linkedMapOf("type" to type, "listId" to "")
  "updateDataset" -> linkedMapOf("type" to type, "datasetId" to "")
  "assignCampaign" -> linkedMapOf("type" to type, "campaignId" to "")
  "setContactStage" -> linkedMapOf("type" to type, "lifecycleStage" to "lead")
  "addContactTag" -> linkedMapOf("type" to type, "tag" to "")
  "assignContactOwner" -> linkedMapOf("type" to type, "ownerEmail" to "")
  "createCrmTask" -> linkedMapOf("type" to type, "title" to "", "kind" to "call", "dueInDays" to 1L)
  "logCrmActivity" -> linkedMapOf("type" to type, "kind" to "note", "body" to "")
  "wait" -> linkedMapOf("type" to type, "delayMinutes" to 60L * 24)
  "waitForEvent" -> linkedMapOf("type" to type, "eventName" to "", "timeoutMinutes" to 60L * 24 * 3)
  else -> linkedMapOf("type" to "datasetAppend", "datasetName" to "")
}

/** The durations a wait may be set to. */
val FLOW_WAIT_PRESETS: List<Pair<Long, String>> = listOf(
  5L to "5 minutes", 30L to "30 minutes", 60L to "1 hour", 240L to "4 hours", 1440L to "1 day", 2880L to "2 days",
  4320L to "3 days", 10080L to "1 week", 20160L to "2 weeks", 43200L to "30 days", 86400L to "60 days", 129600L to "90 days",
)

/** A field set to [value]; null (or, with [dropEmpty], an empty text) removes it, as `undefined` does. */
fun Doc.withField(key: String, value: Any?, dropEmpty: Boolean = false): Doc =
  LinkedHashMap(this).apply { if (value == null || (dropEmpty && value == "")) remove(key) else put(key, value) }

/** A teammate reference typed as one field: an address is `{role}Email`, anything else `{role}Uid`, blank clears both. */
fun Doc.withMemberRef(role: String, text: String): Doc {
  val trimmed = text.trim()
  val next = LinkedHashMap(this).apply { remove("${role}Email"); remove("${role}Uid") }
  if (trimmed.isEmpty()) return next
  return next.apply { if (trimmed.contains('@')) put("${role}Email", text) else put("${role}Uid", trimmed) }
}

/** A step's "Only if" guard set to [op] (keeping what was typed), or cleared for "Always run". */
fun Doc.withGuardOp(op: String): Doc {
  if (op.isEmpty()) return LinkedHashMap(this).apply { put("when", null) }
  val first = (this["when"].asDoc()?.get("conditions") as? List<*>)?.firstOrNull().asDoc()
  return LinkedHashMap(this).apply {
    put("when", linkedMapOf("conditions" to listOf(linkedMapOf("op" to op, "field" to (first?.get("field") ?: ""), "value" to (first?.get("value") ?: "")))))
  }
}

/** A guard's first clause with [key] changed. */
fun Doc.withGuardField(key: String, value: String): Doc {
  val first = (this["when"].asDoc()?.get("conditions") as? List<*>)?.firstOrNull().asDoc() ?: return this
  return LinkedHashMap(this).apply { put("when", linkedMapOf("conditions" to listOf(LinkedHashMap(first).apply { put(key, value) }))) }
}

/** The kind of a logged activity changed: a direction the new kind does not take goes with the old one. */
fun Doc.withActivityKind(kind: String): Doc {
  val direction = this["direction"] as? String
  val keep = direction != null && direction in (com.aglyn.contracts.CRM_ACTIVITY_DIRECTIONS[kind] ?: emptyList())
  return LinkedHashMap(this).apply {
    put("kind", kind)
    if (!keep) remove("direction")
  }
}

/** `aria-*` and `data-*` only: the attribute names an interaction may write. */
fun isInteractionAttributeAllowed(name: String?): Boolean =
  name != null && Regex("^(?:aria|data)-[a-z][a-z0-9-]*$").matches(name.trim().lowercase())
