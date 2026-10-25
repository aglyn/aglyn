package com.aglyn.contracts

/*
 * An activity row's words (activity-presenter.ts `activityRowText` and `activityActorLabel`, activity-labels.ts,
 * run-activity-words.ts): what the console's Recent Activity and Page Activity cards print for a stored
 * `hosts/{id}/activity` document. The nouns, the AI codes' words and sentences, and the brand come from the contracts;
 * the automation-run words are replayed by their function cases. The Swift twin is AglynContracts/ActivityRules.swift.
 */

/** The fields of a stored activity document a row reads. Any of them may be absent. */
data class ActivityEntryFields(
  val action: String? = null,
  val targetType: String? = null,
  val targetName: String? = null,
  /** Early org entries carried the type at the top level rather than under `target`. */
  val type: String? = null,
  val actorId: String? = null,
  val actorEmail: String? = null,
  val actorEmailNow: String? = null,
  val apiKeyName: String? = null,
  val staffActorEmail: String? = null,
) {
  companion object {
    /** A Firestore activity document's fields. */
    fun of(data: Map<String, Any?>): ActivityEntryFields {
      val target = data["target"] as? Map<*, *>
      return ActivityEntryFields(
        action = data["action"] as? String, targetType = target?.get("type") as? String, targetName = target?.get("name") as? String,
        type = data["type"] as? String, actorId = data["actorId"] as? String, actorEmail = data["actorEmail"] as? String,
        actorEmailNow = data["actorEmailNow"] as? String, apiKeyName = data["apiKeyName"] as? String,
        staffActorEmail = data["staffActorEmail"] as? String,
      )
    }
  }
}

private val pluginTargetType = Regex("^[a-z][a-z0-9-]*:([A-Za-z][A-Za-z0-9]*)$")
private val automationRunLine =
  Regex("^(Action|Org automation|Workflow) (ran|skipped|failed|is waiting,) on ([A-Za-z][\\w.:-]*?)(?:(?: with errors)?:\\s.*| with errors:.*)?$")

private fun String.capitalizedFirst() = replaceFirstChar { it.uppercaseChar() }

/** The noun a target type reads as: `screen` → `Page`, a plugin's `outreach:mailbox` → `Mailbox`, nothing → `Item`. */
fun activityTypeLabel(type: String?): String {
  if (type.isNullOrEmpty()) return "Item"
  Contracts.activityTypeLabels[type]?.let { return it }
  pluginTargetType.matchEntire(type)?.let { return it.groupValues[1].capitalizedFirst() }
  return type.capitalizedFirst()
}

/** `page Home`: the noun and name a sentence uses (`activityTargetPhrase`). */
fun activityTargetPhrase(type: String?, name: String?): String {
  val noun = activityTypeLabel(type)
  val lower = if (noun == "Item") "item" else noun.replaceFirstChar { it.lowercaseChar() }
  val trimmed = name?.trim().orEmpty()
  return if (trimmed.isEmpty()) lower else "$lower $trimmed"
}

/** An automation run line in words (`describeAutomationRunAction`); null for any other line. */
fun describeAutomationRunAction(action: String): String? {
  val match = automationRunLine.matchEntire(action.trim()) ?: return null
  val (actor, verb, event) = match.destructured
  val failed = verb == "failed" || action.contains(" with errors:")
  val who = if (actor == "Action") "Automation" else actor
  val what = when {
    failed -> "failed"
    verb == "skipped" -> "skipped"
    verb == "is waiting," -> "is waiting"
    else -> "ran"
  }
  val label = hostEventLabel(event)
  val words = if (label != event) label else
    event.replace(Regex("([a-z0-9])([A-Z])"), "$1 $2").replace(Regex("[._:-]+"), " ").lowercase().capitalizedFirst()
  return "$who $what: $words"
}

/** What a stored action reads as (`activityActionLabel`): an AI code's words, a run in words, a duplicate's sentence, else the text. */
fun activityActionText(action: String?): String {
  val stored = action?.trim().orEmpty()
  return Contracts.aiActivityActionLabels[stored] ?: describeAutomationRunAction(stored)
    ?: Contracts.duplicateActivityActionLabels[stored] ?: stored
}

/** The row's text (`activityRowText`): an AI sentence about its target, else `action — name`, the action, or the target. */
fun activityRowText(entry: ActivityEntryFields): String {
  val stored = entry.action?.trim().orEmpty()
  Contracts.aiActivityActionSentences[stored]?.let { return it.replace("{target}", activityTargetPhrase(entry.targetType, entry.targetName)) }
  val action = activityActionText(stored)
  val name = entry.targetName?.trim().orEmpty()
  if (action.isNotEmpty() && name.isNotEmpty()) return "$action — $name"
  if (action.isNotEmpty()) return action
  if (!entry.targetName.isNullOrEmpty()) return entry.targetName
  return activityTypeLabel(entry.targetType)
}

/** Who did it (`activityActorLabel`): the address recorded, a key, the account, a workflow, or the platform. */
fun activityActorLabel(entry: ActivityEntryFields): String {
  if (!entry.actorEmail.isNullOrEmpty()) return entry.actorEmail
  if (!entry.apiKeyName.isNullOrEmpty()) return "API key ${entry.apiKeyName}"
  val actorId = entry.actorId?.trim().orEmpty()
  if (actorId == "api") return "API key"
  if (actorId.isNotEmpty() && !actorId.startsWith("system:")) {
    return if (!entry.actorEmailNow.isNullOrEmpty()) entry.actorEmailNow else "Account $actorId"
  }
  if ((entry.targetType ?: entry.type) == "workflow") {
    val name = entry.targetName?.trim().orEmpty()
    return if (name.isEmpty()) "Workflow" else "Workflow $name"
  }
  val brand = Contracts.platformBrandName
  if (!entry.staffActorEmail.isNullOrEmpty()) return "$brand staff (${entry.staffActorEmail})"
  return brand
}
