package com.aglyn.contracts

import kotlin.math.floor
import kotlin.math.max

/*
 * THE AUTOMATION RULES (AGL-3670), ported from the console: an action's and a
 * workflow's validation (workflows plugin model/host-actions.ts,
 * engine/workflow-steps.ts over core's site-interactions.ts), the org
 * automation reader (model/org-automations.ts), the stored shape of an
 * action, placeholders (draft-placeholders.ts) and the run history's words
 * (activity-presenter.ts). automation-cases.generated.json holds the
 * console's own answers and the tests replay every one.
 *
 * Documents are plain values, as Firestore hands them over: Map, List,
 * String, Boolean, Long/Double, null. A field this code does not know rides
 * along untouched, so a step written by a newer console survives an edit.
 *
 * Not ported, and so not checked here: the recipe stamp's registry (an
 * action's `recipe` is carried, never judged), and the two client-step
 * sanitizers that hold the console's whole HTML and analytics taxonomies
 * (`showHtml`'s author-HTML check, `trackGaEvent`'s parameter scrubber and
 * Aglyn's own event names). Both steps are checked here for what the editor
 * can change: a non-empty value, and GA4's own reserved names.
 */

typealias Doc = Map<String, Any?>

/** How each step type reads in a picker, a list and a run history, in the "Do" picker's order. */
val HOST_ACTION_STEP_LABELS: Map<String, String> = linkedMapOf(
  "runWorkflow" to "Run a workflow",
  "siteAlert" to "Show a site alert",
  "customEvent" to "Fire a custom event",
  "datasetAppend" to "Write to a dataset",
  "webhookPost" to "Send a webhook (Business)",
  "showOverlay" to "Show a popup or bar",
  "stickyNav" to "Make navigation sticky",
  "addClass" to "Add a CSS class",
  "toggleClass" to "Toggle a CSS class",
  "removeClass" to "Remove a CSS class",
  "showElement" to "Show an element",
  "hideElement" to "Hide an element",
  "toggleElement" to "Show/hide an element",
  "openDrawer" to "Open a drawer",
  "closeDrawer" to "Close a drawer",
  "toggleDrawer" to "Open/close a drawer",
  "openMenu" to "Open a menu",
  "closeMenu" to "Close a menu",
  "toggleMenu" to "Open/close a menu",
  "setAttribute" to "Set an ARIA or data attribute",
  "removeAttribute" to "Remove an ARIA or data attribute",
  "scrollTo" to "Scroll to element",
  "playVideo" to "Play a video",
  "showHtml" to "Show custom HTML",
  "runJs" to "Run custom JS (Business)",
  "redirect" to "Redirect the visitor",
  "trackGaEvent" to "Track an analytics event",
  "sendEmail" to "Send an email",
  "notifyAdmins" to "Notify site admins",
  "enrollList" to "Enroll in a list",
  "updateDataset" to "Update a dataset record",
  "assignCampaign" to "Assign to a campaign",
  "wait" to "Wait",
  "waitForEvent" to "Wait for something to happen",
  "exitFlow" to "End the flow here",
  "setContactStage" to "Set the contact’s lifecycle stage",
  "addContactTag" to "Tag the contact",
  "assignContactOwner" to "Assign the contact an owner",
  "createCrmTask" to "Create a CRM task",
  "logCrmActivity" to "Log a CRM activity",
)

/** The steps the visitor's browser runs (`CLIENT_ACTION_STEP_TYPES`). */
val CLIENT_ACTION_STEP_TYPES: Set<String> = setOf(
  "showOverlay", "stickyNav", "addClass", "removeClass", "toggleClass", "showElement", "hideElement", "toggleElement",
  "openDrawer", "closeDrawer", "toggleDrawer", "openMenu", "closeMenu", "toggleMenu", "setAttribute", "removeAttribute",
  "scrollTo", "playVideo", "showHtml", "runJs", "redirect", "trackGaEvent", "siteAlert",
)

/** The Actions steps a workflow may hold: every server step, and `siteAlert`. */
val WORKFLOW_ACTION_STEP_TYPES: List<String> =
  HOST_ACTION_STEP_LABELS.keys.filter { it == "siteAlert" || it !in CLIENT_ACTION_STEP_TYPES }

/** Events the visitor's page raises itself (`SITE_EVENT_TYPES`). */
val SITE_EVENT_TYPES: List<String> = listOf(
  "scrollDepth", "scrollToElement", "elementClick", "elementVisible", "elementHoverEnter", "elementHoverLeave",
  "exitIntent", "timeOnPage", "pageVisit",
)

/** Site events that watch one element and need a selector. */
val ELEMENT_SCOPED_SITE_EVENTS: List<String> =
  listOf("scrollToElement", "elementClick", "elementVisible", "elementHoverEnter", "elementHoverLeave")

/** The events an org automation may start on. */
val ORG_AUTOMATION_TRIGGER_EVENTS: List<String> = listOf(
  "formSubmission", "lead", "contactCreated", "contactStageChanged", "booking", "memberSignUp", "memberSignIn",
  "dealStageChanged", "dealWon", "dealLost", "taskCompleted",
)

/** The steps an org automation may hold, in its picker's order. */
val ORG_AUTOMATION_STEP_TYPES: List<String> = listOf(
  "sendEmail", "notifyAdmins", "enrollList", "assignCampaign", "datasetAppend", "updateDataset", "setContactStage",
  "addContactTag", "assignContactOwner", "createCrmTask", "logCrmActivity", "customEvent", "wait", "waitForEvent", "exitFlow",
)

/** Why an email step cannot be a transactional reply, in the editor's and the validator's words. */
val SEND_EMAIL_REPLY_INELIGIBLE_REASONS: Map<String, String> = linkedMapOf(
  "event" to "only a reply to the person’s own form submission, booking or sign-up can be transactional",
  "wait" to "an email after a wait is a mailing, so it keeps its unsubscribe link",
  "topic" to "an email in a topic is a mailing, so it keeps its unsubscribe link",
  "recipient" to "only an email to the person who acted can be a transactional reply",
)

val TRIGGER_CONDITION_OPS: List<String> = listOf("equals", "contains", "notEmpty")
val TRIGGER_COMBINATORS: List<String> = listOf("and", "or")
const val ACTION_MAX_CONDITIONS = 5
const val ACTION_MAX_STEPS = 10
const val ACTION_NAME_MAX = 60
const val FLOW_WAIT_MIN_MINUTES = 1
const val FLOW_WAIT_MAX_MINUTES = 90 * 24 * 60
const val CONTACT_TAG_MAX_LENGTH = 60
const val CRM_TASK_MAX_DUE_DAYS = 365
const val ELEMENT_VISIBILITY_MAX_DELAY_MS = 5000
const val SCROLL_TO_MAX_OFFSET_PX = 1000
const val ACTION_MAX_EVENT_PARAMS = 10
const val ACTION_EVENT_PARAM_NAME_MAX_LENGTH = 40
const val ORG_AUTOMATIONS_MAX = 100
const val ORG_AUTOMATION_NAME_MAX = 60
const val MAX_SCOPE_HOSTS = 30
const val WEBHOOK_MAX_PER_HOST = 5
const val ACTIONS_MAX_PER_HOST = 500
const val ORG_SCOPE_TOKEN = "org"
const val HOST_TOKEN_PREFIX = "host:"

val CONTACT_LIFECYCLE_STAGES: List<String> =
  listOf("subscriber", "lead", "marketing-qualified", "sales-qualified", "opportunity", "customer", "evangelist", "other")
val CONTACT_LIFECYCLE_STAGE_LABELS: Map<String, String> = linkedMapOf(
  "subscriber" to "Subscriber", "lead" to "Lead", "marketing-qualified" to "Marketing qualified",
  "sales-qualified" to "Sales qualified", "opportunity" to "Opportunity", "customer" to "Customer",
  "evangelist" to "Evangelist", "other" to "Other",
)
val CRM_TASK_KIND_LABELS: Map<String, String> = linkedMapOf("call" to "Call", "email" to "Email", "meeting" to "Meeting", "todo" to "To-do")
val CRM_ACTIVITY_KIND_LABELS: Map<String, String> =
  linkedMapOf("call" to "Call", "email" to "Email", "meeting" to "Meeting", "note" to "Note", "other" to "Other")
val CRM_ACTIVITY_DIRECTIONS: Map<String, List<String>> =
  mapOf("call" to listOf("outbound", "inbound", "internal"), "email" to listOf("outbound", "inbound"))
val CRM_ACTIVITY_DIRECTION_LABELS: Map<String, String> =
  linkedMapOf("outbound" to "Outbound", "inbound" to "Inbound", "internal" to "Internal")
val TASK_PRIORITIES: List<String> = listOf("low", "normal", "high")

val CUSTOM_EVENT_PATTERN = Regex("^[a-zA-Z][a-zA-Z0-9_-]{1,39}$")

/** A trigger bound to one element: the row is an element interaction, not a site action. */
val LEAF_SELECTOR = Regex("^\\[data-aglyn=\"leaf:.+\"]$")

/** A step that picks a record, as its declaring plugin states it. */
data class StepPick(val idField: String, val nameField: String, val missing: String)

/** One field of a step a person types words into, and what a sentence calls it. */
data class TypedField(val key: String, val names: String)

private val DECLARED_PICKS: Map<String, StepPick> = mapOf(
  "showOverlay" to StepPick("overlayId", "overlayName", "pick an overlay"),
  "runWorkflow" to StepPick("workflowId", "workflowName", "pick a workflow"),
)

private val TYPED_FIELDS: Map<String, List<TypedField>> = mapOf(
  "showOverlay" to listOf(TypedField("overlayName", "the popup or bar")),
  "siteAlert" to listOf(TypedField("message", "the message")),
  "addContactTag" to listOf(TypedField("tag", "the tag")),
  "createCrmTask" to listOf(TypedField("title", "the title")),
  "logCrmActivity" to listOf(TypedField("body", "the text")),
  "datasetAppend" to listOf(TypedField("datasetName", "the dataset")),
  "updateDataset" to listOf(TypedField("datasetName", "the dataset")),
  "runWorkflow" to listOf(TypedField("workflowName", "the workflow")),
  "webhookPost" to listOf(TypedField("webhookName", "the webhook")),
  "sendEmail" to listOf(TypedField("subject", "the subject"), TypedField("body", "the text")),
  "notifyAdmins" to listOf(TypedField("title", "the title"), TypedField("body", "the text")),
  "enrollList" to listOf(TypedField("listName", "the list")),
  "assignCampaign" to listOf(TypedField("campaignName", "the campaign")),
)

private val FLOW_SUSPENDING_STEP_TYPES = setOf("wait", "waitForEvent")

// ── Plain-value helpers ───────────────────────────────────────────────────

@Suppress("UNCHECKED_CAST")
fun Any?.asDoc(): Doc? = (this as? Map<*, *>)?.let { it as Doc }

/** A string field, or null for an absent or non-text one. */
fun Doc?.str(key: String): String? = this?.get(key) as? String

/** A string field trimmed, or "" when it is absent, blank or not text. */
fun Doc?.trimmed(key: String): String = str(key)?.trim() ?: ""

private fun Doc?.list(key: String): List<Any?> = (this?.get(key) as? List<*>) ?: emptyList()

/** `Number.isInteger(value)`. */
fun isJsInteger(value: Any?): Boolean = when (value) {
  is Long, is Int -> true
  is Number -> value.toDouble().let { it.isFinite() && floor(it) == it }
  else -> false
}

fun isSiteEventType(event: String?): Boolean = event in SITE_EVENT_TYPES

/** The label a step type reads as; the raw type for one nobody declares. */
fun stepLabel(type: String?): String = HOST_ACTION_STEP_LABELS[type] ?: (type ?: "")

fun isCustomEventName(event: String): Boolean = event !in hostEventTypes && CUSTOM_EVENT_PATTERN.matches(event)

fun isFlowWaitMinutes(value: Any?): Boolean =
  isJsInteger(value) && jsNumber(value).let { it >= FLOW_WAIT_MIN_MINUTES && it <= FLOW_WAIT_MAX_MINUTES }

fun isFlowSuspendingStep(step: Any?): Boolean = step.asDoc().str("type") in FLOW_SUSPENDING_STEP_TYPES

/** Whether the step at [index] runs after a wait. */
fun stepRunsAfterWait(steps: List<Any?>?, index: Int): Boolean =
  (steps ?: emptyList()).take(max(0, index)).any(::isFlowSuspendingStep)

// ── Trigger filter and conditions ─────────────────────────────────────────

private val FILTER_COMPARISON = Regex("[=!<>]|&&|\\|\\|")
private val QUOTED = Regex("\"[^\"]*\"|'[^']*'")

/**
 * Why a trigger's free-text filter can never run, or null. [remedy] `action`
 * points a workflow's author at an action with a condition.
 */
fun triggerFilterProblem(filter: Any?, remedy: String? = null): String? {
  val text = (if (filter == null) "" else jsString(filter)).trim()
  if (text.isEmpty()) return null
  val fix = if (remedy == "action") {
    "start the workflow from an action with a condition (for example: source equals form) instead"
  } else {
    "use a condition instead (for example: source equals form)"
  }
  if (FILTER_COMPARISON.containsMatchIn(text.replace(QUOTED, "\"\""))) {
    return "A filter can’t compare values (no ==, !=, <, >, && or ||) — $fix, and clear the filter"
  }
  val syntax = expressionSyntaxError(text)
  return if (syntax != null) "The filter can’t be read ($syntax) — $fix, and clear the filter" else null
}

/** A trigger's condition clauses as a list: `conditions` wins; a legacy single `condition` is one. */
fun normalizeTriggerConditions(trigger: Doc?): List<Doc> {
  val conditions = trigger?.get("conditions")
  if (conditions is List<*>) return conditions.mapNotNull { it.asDoc() }
  return listOfNotNull(trigger?.get("condition").asDoc())
}

// ── Validation ────────────────────────────────────────────────────────────

private fun clauseProblem(clause: Doc, prefix: String, where: String, capital: Boolean): String? {
  fun say(text: String) = prefix + (if (capital) text.replaceFirstChar { it.uppercase() } else text) + where
  if (clause["op"] !in TRIGGER_CONDITION_OPS) return say("pick a condition operator")
  if (clause.trimmed("field").isEmpty()) return say("name the field the condition checks")
  if (clause["op"] != "notEmpty" && clause.trimmed("value").isEmpty()) return say("enter the value the condition compares against")
  return null
}

/** The platform's interaction checks (`validateInteraction`); [validateStep] is the owner's check of a step. */
fun validateInteraction(action: Doc, validateStep: (Doc, String) -> String? = { _, _ -> null }): String? {
  if (action.trimmed("name").isEmpty()) return "Name the action"
  val trigger = action["trigger"].asDoc()
  val event = trigger.trimmed("event")
  if (event.isEmpty()) return "Pick a trigger event"
  if (!isSiteEventType(event) && !CUSTOM_EVENT_PATTERN.matches(event)) return "Custom event names are 2–40 letters, digits, dashes"
  if (event in ELEMENT_SCOPED_SITE_EVENTS && trigger.trimmed("selector").isEmpty()) return "This trigger needs a CSS selector"
  if (event == "scrollDepth" || event == "timeOnPage") {
    val threshold = trigger?.get("threshold")
    val value = if (threshold == null) Double.NaN else jsNumber(threshold)
    if (!(value > 0)) return if (event == "scrollDepth") "Set the scroll percentage (1–100)" else "Set the seconds on page"
  }
  val cooldown = trigger?.get("cooldownMinutes")
  if (cooldown != null && !(jsNumber(cooldown) >= 1)) return "Cooldown must be at least 1 minute"
  triggerFilterProblem(trigger?.get("filter"))?.let { return it }
  val combinator = trigger?.get("combinator")
  if (combinator != null && combinator !in TRIGGER_COMBINATORS) return "Combine conditions with AND or OR"
  val conditions = normalizeTriggerConditions(trigger)
  if (conditions.size > ACTION_MAX_CONDITIONS) return "Conditions are capped at $ACTION_MAX_CONDITIONS"
  for ((index, condition) in conditions.withIndex()) {
    val where = if (conditions.size > 1) " (condition ${index + 1})" else ""
    clauseProblem(condition, "", where, capital = true)?.let { return it }
  }
  val steps = action.list("steps")
  if (steps.isEmpty()) return "Add at least one step"
  if (steps.size > ACTION_MAX_STEPS) return "Actions are capped at $ACTION_MAX_STEPS steps"
  for ((index, raw) in steps.withIndex()) {
    val step = raw.asDoc() ?: emptyMap()
    val label = "Step ${index + 1}"
    val guard = step["when"].asDoc()
    val clauses = guard.list("conditions").mapNotNull { it.asDoc() }
    if (clauses.size > ACTION_MAX_CONDITIONS) return "$label: conditions are capped at $ACTION_MAX_CONDITIONS"
    val guardCombinator = guard?.get("combinator")
    if (guardCombinator != null && guardCombinator !in TRIGGER_COMBINATORS) return "$label: combine conditions with AND or OR"
    for (clause in clauses) clauseProblem(clause, "$label: ", "", capital = false)?.let { return it }
    validateStep(step, label)?.let { return it }
    DECLARED_PICKS[step.str("type")]?.let { pick ->
      if (step.trimmed(pick.idField).isEmpty() && step.trimmed(pick.nameField).isEmpty()) return "$label: ${pick.missing}"
    }
    if (step.str("type") in CLIENT_ACTION_STEP_TYPES) clientStepProblem(step, label)?.let { return it }
  }
  return null
}

private val GA4_RESERVED_EVENT_NAMES = setOf(
  "ad_activeview", "ad_click", "ad_exposure", "ad_impression", "ad_query", "ad_reward", "adunit_exposure",
  "app_background", "app_clear_data", "app_exception", "app_install", "app_remove", "app_store_refund",
  "app_store_subscription_cancel", "app_store_subscription_convert", "app_store_subscription_renew", "app_update",
  "app_upgrade", "dynamic_link_app_open", "dynamic_link_app_update", "dynamic_link_first_open", "error", "first_open",
  "first_visit", "in_app_purchase", "notification_dismiss", "notification_foreground", "notification_open",
  "notification_receive", "os_update", "screen_view", "session_start", "user_engagement",
)
private val GA4_RESERVED_PREFIXES = listOf("firebase_", "google_", "ga_")

/** A GA4 event name as an author's text resolves to it: the name, or why there is none. */
fun resolveAuthoredEventName(raw: String?): Pair<String?, String?> {
  val normalized = (raw ?: "").trim().lowercase()
    .replace(Regex("[^a-z0-9_]+"), "_")
    .replace(Regex("^[^a-z]+"), "")
    .replace(Regex("_{2,}"), "_")
    .take(40)
    .replace(Regex("_+$"), "")
  if (normalized.isEmpty()) return null to "unusable"
  if (normalized in GA4_RESERVED_EVENT_NAMES || GA4_RESERVED_PREFIXES.any { normalized.startsWith(it) }) return null to "reserved"
  return normalized to null
}

private fun clientStepProblem(step: Doc, label: String): String? {
  val type = step.str("type")
  if (type == "siteAlert" && step.trimmed("message").isEmpty()) return "$label: enter the alert message"
  if (type == "addClass" || type == "removeClass" || type == "toggleClass") {
    if (step.trimmed("selector").isEmpty()) return "$label: enter a CSS selector"
    if (step.trimmed("className").isEmpty()) return "$label: enter the class name"
  }
  if (type == "showElement" || type == "hideElement" || type == "toggleElement") {
    if (step.trimmed("selector").isEmpty()) return "$label: pick the element to show or hide"
    val delay = step["delayMs"]
    if (delay != null && !(isJsInteger(delay) && jsNumber(delay) >= 0 && jsNumber(delay) <= ELEMENT_VISIBILITY_MAX_DELAY_MS)) {
      return "$label: delay must be 0–${ELEMENT_VISIBILITY_MAX_DELAY_MS}ms"
    }
    val dismiss = step["dismissOn"]
    if (dismiss != null && !(dismiss is List<*> && dismiss.all { it == "escape" || it == "outsideClick" })) {
      return "$label: dismiss options are escape and outsideClick"
    }
  }
  if (type == "scrollTo") {
    if (step.trimmed("selector").isEmpty()) return "$label: pick the element to scroll to"
    val behavior = step["behavior"]
    if (behavior != null && behavior != "smooth" && behavior != "instant") return "$label: scroll smoothly or instantly"
    val offset = step["offsetPx"]
    if (offset != null && !(isJsInteger(offset) && jsNumber(offset) >= 0 && jsNumber(offset) <= SCROLL_TO_MAX_OFFSET_PX)) {
      return "$label: the offset must be 0–${SCROLL_TO_MAX_OFFSET_PX}px"
    }
  }
  if (type == "playVideo" && step.trimmed("selector").isEmpty()) return "$label: pick the video to play"
  if (type == "showHtml" && step.trimmed("html").isEmpty()) return "$label: enter the HTML"
  if (type == "runJs" && step.trimmed("code").isEmpty()) return "$label: enter the JavaScript"
  if (type == "redirect" && step.trimmed("url").isEmpty() && step["screenId"].let { it == null || it == "" || it == false }) {
    return "$label: pick a page or enter the destination URL"
  }
  if (type == "trackGaEvent") {
    val name = step.trimmed("eventName")
    if (name.isEmpty()) return "$label: name the analytics event"
    val (resolved, reason) = resolveAuthoredEventName(step.str("eventName"))
    if (reason == "reserved") return "$label: \"$name\" is a reserved analytics event name — pick another"
    if (resolved == null) return "$label: the analytics event name must start with a letter"
    val params = step["params"].asDoc()?.entries?.toList() ?: emptyList()
    if (params.size > ACTION_MAX_EVENT_PARAMS) return "$label: analytics parameters are capped at $ACTION_MAX_EVENT_PARAMS"
    for ((key, value) in params) {
      if (key.trim().isEmpty()) return "$label: name every analytics parameter"
      if (key.trim().length > ACTION_EVENT_PARAM_NAME_MAX_LENGTH) {
        return "$label: the \"${key.trim().take(16)}…\" parameter name is over $ACTION_EVENT_PARAM_NAME_MAX_LENGTH characters, which GA4 drops"
      }
      if ((if (value == null) "" else jsString(value)).trim().isEmpty()) return "$label: enter a value for the \"${key.trim()}\" parameter"
    }
  }
  return null
}

/** A server step's own complaint, or null (`hostActionStepProblem`). */
fun hostActionStepProblem(step: Doc, label: String): String? {
  val type = step.str("type")
  if (type == "wait" && !isFlowWaitMinutes(step["delayMinutes"])) {
    return "$label: wait between $FLOW_WAIT_MIN_MINUTES minute and $FLOW_WAIT_MAX_MINUTES minutes"
  }
  if (type == "waitForEvent") {
    val waited = step.trimmed("eventName")
    if (waited.isEmpty() || (waited !in hostEventTypes && !isCustomEventName(waited))) return "$label: pick the event to wait for"
    if (!isFlowWaitMinutes(step["timeoutMinutes"])) return "$label: give up after $FLOW_WAIT_MIN_MINUTES–$FLOW_WAIT_MAX_MINUTES minutes"
  }
  if (type == "customEvent" && !isCustomEventName(step.trimmed("eventName"))) {
    return "$label: custom event names are 2–40 letters, digits, dashes"
  }
  if (type == "datasetAppend" && step.trimmed("datasetId").isEmpty() && step.trimmed("datasetName").isEmpty()) return "$label: pick a dataset"
  if (type == "webhookPost" && step.trimmed("webhookId").isEmpty() && step.trimmed("webhookName").isEmpty()) return "$label: pick a webhook"
  if (type == "sendEmail") {
    if (step.trimmed("subject").isEmpty()) return "$label: enter the subject"
    if (step.trimmed("body").isEmpty()) return "$label: enter the email body"
  }
  if (type == "notifyAdmins" && step.trimmed("title").isEmpty()) return "$label: enter the notification title"
  if (type == "enrollList" && step.trimmed("listId").isEmpty() && step.trimmed("listName").isEmpty()) return "$label: pick a list"
  if (type == "updateDataset" && step.trimmed("datasetId").isEmpty() && step.trimmed("datasetName").isEmpty()) return "$label: pick a dataset"
  if (type == "assignCampaign" && step.trimmed("campaignId").isEmpty() && step.trimmed("campaignName").isEmpty()) return "$label: pick a campaign"
  if (type == "setContactStage" && step["lifecycleStage"] !in CONTACT_LIFECYCLE_STAGES) return "$label: pick a lifecycle stage"
  if (type == "addContactTag") {
    val tag = step.trimmed("tag")
    if (tag.isEmpty()) return "$label: enter the tag"
    if (tag.length > CONTACT_TAG_MAX_LENGTH) return "$label: tags are at most $CONTACT_TAG_MAX_LENGTH characters"
  }
  if (type == "assignContactOwner") {
    val named = step.trimmed("ownerUid").isNotEmpty() || step.trimmed("ownerEmail").isNotEmpty()
    if (step["roundRobin"] == true && named) return "$label: pick round robin or a member, not both"
    if (step["roundRobin"] != true && step.trimmed("ownerUid").isEmpty() && !step.trimmed("ownerEmail").contains('@')) {
      return "$label: enter the owner’s email address"
    }
  }
  if (type == "createCrmTask") {
    if (step.trimmed("title").isEmpty()) return "$label: give the task a title"
    if (step["kind"] !in CRM_TASK_KIND_LABELS.keys) return "$label: pick the type of task"
    if (step.containsKey("priority") && step["priority"] !in TASK_PRIORITIES) return "$label: pick the task’s priority"
    val due = step["dueInDays"]
    if (!isJsInteger(due) || jsNumber(due) < 0 || jsNumber(due) > CRM_TASK_MAX_DUE_DAYS) return "$label: due in 0–$CRM_TASK_MAX_DUE_DAYS days"
    val assignee = step.trimmed("assigneeEmail")
    if (assignee.isNotEmpty() && !assignee.contains('@')) return "$label: enter the assignee’s email address"
  }
  if (type == "logCrmActivity") {
    val kind = step["kind"]
    if (kind !in CRM_ACTIVITY_KIND_LABELS.keys) return "$label: pick the kind of activity"
    if (step.containsKey("direction")) {
      val directions = CRM_ACTIVITY_DIRECTIONS[kind] ?: emptyList()
      if (step["direction"] !in directions) {
        return if (directions.isNotEmpty()) "$label: pick which way the $kind went" else "$label: only a call or an email takes a direction"
      }
    }
    if (step.trimmed("body").isEmpty()) return "$label: write what happened"
  }
  return null
}

/** Why a `sendEmail` step cannot be a transactional reply (`event`, `wait`, `topic`, `recipient`), or null. */
fun sendEmailReplyIneligibility(step: Doc, event: String?, afterWait: Boolean): String? {
  if (!hostEventRecipientActed(event)) return "event"
  if (afterWait) return "wait"
  if ((step["topicId"]?.let(::jsString) ?: "").trim().isNotEmpty()) return "topic"
  val toField = (step["toField"]?.let(::jsString) ?: "").trim()
  if (toField.isNotEmpty() && toField != "email") return "recipient"
  return null
}

/** Whether a `sendEmail` step goes out as a transactional reply: it qualifies, and its switch is not off. */
fun sendEmailIsTransactionalReply(step: Doc, event: String?, afterWait: Boolean): Boolean =
  step["transactional"] != false && sendEmailReplyIneligibility(step, event, afterWait) == null

/** An action's validation, the console's `validateHostAction`. */
fun validateHostAction(action: Doc): String? {
  validateInteraction(action, ::hostActionStepProblem)?.let { return it }
  val steps = action.list("steps")
  val event = action["trigger"].asDoc().str("event")
  for ((index, raw) in steps.withIndex()) {
    val step = raw.asDoc() ?: continue
    if (step.str("type") != "sendEmail" || step["transactional"] != true) continue
    val why = sendEmailReplyIneligibility(step, event, stepRunsAfterWait(steps, index))
    if (why != null) return "Step ${index + 1}: ${SEND_EMAIL_REPLY_INELIGIBLE_REASONS[why]}"
  }
  return null
}

// ── Workflows ─────────────────────────────────────────────────────────────

/** Whether a stored workflow step is an Actions step rather than a function call. */
fun isWorkflowActionStep(step: Any?): Boolean = step.asDoc().str("type")?.let { it in HOST_ACTION_STEP_LABELS } == true

fun workflowActionStepRefusal(step: Doc): String? {
  val type = step.str("type")
  if (type in WORKFLOW_ACTION_STEP_TYPES) return null
  val label = HOST_ACTION_STEP_LABELS[type]
  if (label != null) return "“$label” runs in the visitor’s browser, so a workflow cannot run it — build it as an interaction in Actions"
  return "“${jsString(step["type"])}” is not a step a workflow can run"
}

/** A workflow's steps checked as the editors check them (`validateWorkflowSteps`). */
fun validateWorkflowSteps(steps: List<Any?>?): String? {
  val list = steps ?: emptyList()
  if (list.size > WORKFLOW_MAX_STEPS) return "Workflows are capped at $WORKFLOW_MAX_STEPS steps"
  for ((index, raw) in list.withIndex()) {
    val label = "Step ${index + 1}"
    if (!isWorkflowActionStep(raw)) continue
    val step = raw.asDoc()!!
    workflowActionStepRefusal(step)?.let { return "$label: $it" }
    val problem = validateHostAction(mapOf("name" to "workflow step", "trigger" to mapOf("event" to "formSubmission"), "steps" to listOf(step)))
    if (problem != null) return problem.replace(Regex("^Step 1\\b"), label)
  }
  return null
}

/** The function calls of a workflow, each keeping the result name its place gives it (`workflowFunctionCalls`). */
fun workflowFunctionCalls(workflow: Doc): Doc {
  val steps = workflow.list("steps").mapIndexedNotNull { index, raw ->
    val step = raw.asDoc() ?: return@mapIndexedNotNull null
    if (isWorkflowActionStep(step)) return@mapIndexedNotNull null
    step + ("resultName" to (step.str("resultName")?.trim()?.ifEmpty { null } ?: "step${index + 1}"))
  }
  return workflow + ("steps" to steps)
}

// ── Stored shape ──────────────────────────────────────────────────────────

/** An interaction as `hosts/{hostId}/actions/{id}` holds it (`siteInteractionDocument`). */
fun siteInteractionDocument(interaction: Doc): Doc {
  val trigger = interaction["trigger"].asDoc() ?: emptyMap()
  val cooldown = trigger["cooldownMinutes"]?.let(::jsNumber) ?: Double.NaN
  val stored = LinkedHashMap<String, Any?>(interaction)
  stored.remove("recipe")
  stored["trigger"] = LinkedHashMap<String, Any?>(trigger).apply {
    put("oncePerVisitor", trigger["oncePerVisitor"] == true)
    put("oncePerSession", trigger["oncePerSession"] == true)
    put("cooldownMinutes", if (cooldown >= 1) cooldown else null)
    put("everyTime", trigger["everyTime"] == true)
    put("condition", null)
    put("conditions", trigger["conditions"])
    put("combinator", trigger["combinator"])
  }
  stored["enabled"] = interaction["enabled"] != false
  if (interaction.containsKey("recipe")) stored["recipe"] = interaction["recipe"]
  return stored
}

// ── Placeholders ──────────────────────────────────────────────────────────

private val DRAFT_PLACEHOLDER = Regex("\\[([^\\[\\]\\n]{1,120})](?!\\()")

/** The words inside the first `[placeholder]` in a value, or null. */
fun draftPlaceholderIn(value: Any?): String? {
  if (value !is String) return null
  return DRAFT_PLACEHOLDER.find(value)?.groupValues?.get(1)?.trim()?.ifEmpty { null }
}

/** One placeholder an interaction holds; [step] is 1-based, null for the trigger. */
data class InteractionPlaceholder(val step: Int?, val field: String, val names: String, val text: String)

/** Every placeholder an interaction holds: the trigger's conditions first, then each step's guard and words. */
fun interactionPlaceholders(interaction: Doc?): List<InteractionPlaceholder> {
  if (interaction == null) return emptyList()
  val found = mutableListOf<InteractionPlaceholder>()
  for (condition in normalizeTriggerConditions(interaction["trigger"].asDoc())) {
    draftPlaceholderIn(condition["value"])?.let { found += InteractionPlaceholder(null, "condition", "a condition value", it) }
  }
  interaction.list("steps").forEachIndexed { index, raw ->
    val step = raw.asDoc() ?: return@forEachIndexed
    for (clause in step["when"].asDoc().list("conditions")) {
      draftPlaceholderIn(clause.asDoc()?.get("value"))?.let { found += InteractionPlaceholder(index + 1, "condition", "a condition value", it) }
    }
    for (field in TYPED_FIELDS[step.str("type")] ?: emptyList()) {
      draftPlaceholderIn(step[field.key])?.let { found += InteractionPlaceholder(index + 1, field.key, field.names, it) }
    }
  }
  return found
}

fun describeInteractionPlaceholder(placeholder: InteractionPlaceholder): String =
  "${if (placeholder.step == null) "The trigger" else "Step ${placeholder.step}"}: ${placeholder.names} (“${placeholder.text}”)"

// ── Org automations ───────────────────────────────────────────────────────

private val STEP_FIELDS: Map<String, Map<String, Any>> = mapOf(
  "sendEmail" to mapOf("subject" to 200, "body" to 5000, "toField" to 64, "topicId" to 128, "transactional" to "boolean"),
  "notifyAdmins" to mapOf("title" to 200, "body" to 500),
  "enrollList" to mapOf("listId" to 128, "listName" to 200),
  "assignCampaign" to mapOf("campaignId" to 128, "campaignName" to 200),
  "datasetAppend" to mapOf("datasetId" to 128, "datasetName" to 200),
  "updateDataset" to mapOf("datasetId" to 128, "datasetName" to 200),
  "setContactStage" to mapOf("lifecycleStage" to 64),
  "addContactTag" to mapOf("tag" to 200),
  "assignContactOwner" to mapOf("ownerUid" to 128, "ownerEmail" to 320, "roundRobin" to "boolean"),
  "createCrmTask" to mapOf("title" to 200, "kind" to 64, "priority" to 16, "dueInDays" to "number", "assigneeUid" to 128, "assigneeEmail" to 320),
  "logCrmActivity" to mapOf("kind" to 64, "body" to 2000, "direction" to 16),
  "customEvent" to mapOf("eventName" to 64),
  "wait" to mapOf("delayMinutes" to "number"),
  "waitForEvent" to mapOf("eventName" to 64, "timeoutMinutes" to "number"),
  "exitFlow" to emptyMap(),
)

private fun readCondition(raw: Any?): Doc? {
  val row = raw.asDoc() ?: return null
  val field = (row["field"]?.let(::jsString) ?: "").trim().take(64)
  val op = row["op"]
  if (op !in TRIGGER_CONDITION_OPS) return linkedMapOf("field" to field, "op" to op)
  return linkedMapOf<String, Any?>("field" to field, "op" to op).apply {
    if (op != "notEmpty") put("value", (row["value"]?.let(::jsString) ?: "").trim().take(200))
  }
}

private fun readConditions(raw: Any?): List<Doc> =
  ((raw as? List<*>) ?: emptyList<Any?>()).take(ACTION_MAX_CONDITIONS + 1).mapNotNull(::readCondition)

private fun readCombinator(raw: Any?): String? = (raw as? String)?.takeIf { it in TRIGGER_COMBINATORS }

private fun readStep(raw: Any?): Doc {
  val source = raw.asDoc() ?: emptyMap()
  val type = source["type"]
  if (type !in ORG_AUTOMATION_STEP_TYPES) return mapOf("type" to type)
  val step = linkedMapOf<String, Any?>("type" to type)
  for ((key, kind) in STEP_FIELDS.getValue(type as String)) {
    val value = source[key] ?: continue
    when (kind) {
      "boolean" -> if (value is Boolean) step[key] = value
      "number" -> if (value is Number && jsNumber(value).isFinite()) step[key] = value
      else -> if (value is String) step[key] = value.take(kind as Int)
    }
  }
  source["when"].asDoc()?.let { whenDoc ->
    val conditions = readConditions(whenDoc["conditions"])
    if (conditions.isNotEmpty()) step["when"] = linkedMapOf("conditions" to conditions, "combinator" to (readCombinator(whenDoc["combinator"]) ?: "and"))
  }
  return step
}

/** Why an org automation cannot hold this step, or null. */
fun orgAutomationStepRefusal(step: Doc): String? {
  val type = step["type"]
  if (type in ORG_AUTOMATION_STEP_TYPES) return null
  val label = HOST_ACTION_STEP_LABELS[type as? String] ?: return "“${if (type == null) "" else jsString(type)}” is not a step"
  return "“$label” belongs to one site, so an org automation cannot run it — build it as an action on that site"
}

fun isScopeToken(value: Any?): Boolean =
  value is String && (value == ORG_SCOPE_TOKEN || (value.startsWith(HOST_TOKEN_PREFIX) && value.length > HOST_TOKEN_PREFIX.length))

/** A scope a save can store, or null for none or more than [MAX_SCOPE_HOSTS] sites. */
fun normalizeVisibleTo(input: List<Any?>?): List<String>? {
  val tokens = (input ?: emptyList()).filter(::isScopeToken).map { it as String }
  if (tokens.isEmpty()) return null
  if (ORG_SCOPE_TOKEN in tokens) return listOf(ORG_SCOPE_TOKEN)
  val unique = tokens.distinct()
  return if (unique.size > MAX_SCOPE_HOSTS) null else unique
}

fun hostScopeToken(hostId: String) = "$HOST_TOKEN_PREFIX$hostId"

/** Every host id a scope names, in order; `['org']` names none. */
fun hostIdsFromScope(visibleTo: List<Any?>?): List<String> =
  (visibleTo ?: emptyList()).filter { isScopeToken(it) && it != ORG_SCOPE_TOKEN }.map { (it as String).removePrefix(HOST_TOKEN_PREFIX) }

fun isOrgWideScope(visibleTo: List<Any?>?): Boolean = visibleTo != null && ORG_SCOPE_TOKEN in visibleTo

fun visibleToHost(visibleTo: List<Any?>?, hostId: String): Boolean =
  visibleTo != null && (ORG_SCOPE_TOKEN in visibleTo || hostScopeToken(hostId) in visibleTo)

/** The org automation fields a save stores, or the first reason it cannot be saved (`readOrgAutomation`). */
sealed interface OrgAutomationRead {
  data class Ok(val value: Doc) : OrgAutomationRead
  data class Refused(val problem: String) : OrgAutomationRead
}

fun readOrgAutomation(input: Any?): OrgAutomationRead {
  val body = input.asDoc() ?: emptyMap()
  val name = (body["name"]?.let(::jsString) ?: "").trim().take(ORG_AUTOMATION_NAME_MAX)
  if (name.isEmpty()) return OrgAutomationRead.Refused("Name the automation")
  val trigger = body["trigger"].asDoc() ?: emptyMap()
  val event = (trigger["event"]?.let(::jsString) ?: "").trim()
  if (event !in ORG_AUTOMATION_TRIGGER_EVENTS) {
    return OrgAutomationRead.Refused("Pick a trigger an org automation can start on — a form, a lead, a booking, a member or a CRM event")
  }
  val filter = (trigger["filter"]?.let(::jsString) ?: "").trim().take(500)
  val conditions = readConditions(trigger["conditions"])
  val combinator = readCombinator(trigger["combinator"])
  val rawSteps = (body["steps"] as? List<*>) ?: emptyList<Any?>()
  if (rawSteps.size > ACTION_MAX_STEPS) return OrgAutomationRead.Refused("Org automations are capped at $ACTION_MAX_STEPS steps")
  val steps = rawSteps.map(::readStep)
  for ((index, step) in steps.withIndex()) {
    orgAutomationStepRefusal(step)?.let { return OrgAutomationRead.Refused("Step ${index + 1}: $it") }
  }
  val checked = linkedMapOf<String, Any?>("event" to event).apply {
    if (filter.isNotEmpty()) put("filter", filter)
    if (conditions.isNotEmpty()) put("conditions", conditions)
    if (combinator != null) put("combinator", combinator)
  }
  validateHostAction(mapOf("name" to name, "trigger" to checked, "steps" to steps))?.let { return OrgAutomationRead.Refused(it) }
  val visibleTo = normalizeVisibleTo((body["visibleTo"] as? List<*>)?.filterIsInstance<String>() ?: emptyList())
    ?: return OrgAutomationRead.Refused("Choose every site, or up to 30 sites, for it to run on")
  val storedTrigger = linkedMapOf<String, Any?>("event" to event).apply {
    if (filter.isNotEmpty()) put("filter", filter)
    put("conditions", conditions.ifEmpty { null })
    put("combinator", if (conditions.isNotEmpty()) combinator ?: "and" else null)
  }
  return OrgAutomationRead.Ok(
    linkedMapOf(
      "name" to name,
      "trigger" to storedTrigger,
      "steps" to steps,
      "enabled" to (body["enabled"] != false),
      "visibleTo" to visibleTo,
    ),
  )
}

fun orgAutomationPausedHostIds(automation: Doc?): List<String> =
  (automation?.get("pausedHostIds") as? List<*>)?.filterIsInstance<String>() ?: emptyList()

private fun truthy(value: Any?): Boolean = when (value) {
  null, false, "", 0L, 0, 0.0 -> false
  is Double -> !value.isNaN() && value != 0.0
  else -> true
}

/** Why a stored org automation will not run on this site, or null when it will. */
fun orgAutomationStopReason(automation: Doc?, hostId: String): String? {
  if (automation == null || truthy(automation["deletedAt"])) return "the org automation was deleted"
  if (automation["enabled"] == false) return "the org automation was switched off"
  if (!visibleToHost(automation["visibleTo"] as? List<*>, hostId)) return "the org automation no longer runs on this site"
  if (hostId in orgAutomationPausedHostIds(automation)) return "the org automation is paused on this site"
  return null
}

fun orgAutomationRunsOnHost(automation: Doc?, hostId: String): Boolean = orgAutomationStopReason(automation, hostId) == null

// ── Run history words ─────────────────────────────────────────────────────

/** Who set a run off: the person, visitor, key or system (`runTriggeredByLabel`). */
fun runTriggeredByLabel(entry: Doc): String {
  val by = entry["triggeredBy"].asDoc()
  fun text(key: String) = by.str(key)?.ifEmpty { null }
  return when (by.str("kind")) {
    "member" -> text("email") ?: text("uid")?.let { "Account $it" } ?: "A member"
    "apiKey" -> text("apiKeyName")?.let { "API key $it" } ?: "API key"
    "visitor" -> text("email")?.let { "Site visitor ($it)" } ?: "Site visitor"
    "webhook" -> text("name")?.let { "Inbound webhook $it" } ?: "Inbound webhook"
    "platform" -> "Aglyn"
    else -> "Not recorded"
  }
}

/** A run's outcome, tolerating rows written before it was recorded; null for an entry that is not a run. */
fun actionRunResult(entry: Doc): String? {
  val stored = (entry["result"]?.let(::jsString) ?: "").trim()
  if (stored == "succeeded" || stored == "failed" || stored == "skipped") return stored
  val action = entry["action"]?.let(::jsString) ?: ""
  if (!action.startsWith("Action ran on")) return null
  return if ("with errors:" in action) "failed" else "succeeded"
}

private val RUN_ERRORS = Regex("with errors:\\s*(.+)$")

/** The `What happened` column. */
fun actionRunSummary(entry: Doc): String {
  val summary = (entry["summary"]?.let(::jsString) ?: "").trim()
  if (summary.isNotEmpty()) return summary
  val action = (entry["action"]?.let(::jsString) ?: "").trim()
  RUN_ERRORS.find(action)?.let { return it.groupValues[1] }
  if (action.startsWith("Action ran on")) return "Ran"
  return action
}
