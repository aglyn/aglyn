package com.aglyn.plugins.logic

import com.aglyn.core.FirestoreDoc

/*
 * Reference health (wave v7): id references are rename-safe but not
 * delete-safe, so the audit cross-checks every reference an automation,
 * workflow or computed variable holds against what still exists and lists the
 * dangling ones. A port of the console's reference-audit.ts as the Logic
 * page's card drives it (actions, workflows and variables; the canvas-node
 * scan is the card's none).
 */

/** What holds a broken reference, and what it points at. */
data class ReferenceIssue(
  /** `action`, `workflow` or `variable`. */
  val source: String,
  val sourceId: String,
  val sourceName: String,
  /** What the reference points at ("workflow", "dataset", …). */
  val refType: String,
  /** The dangling id or name as stored. */
  val missing: String,
)

/** Known-good targets: doc ids AND display names both resolve. A null set is a kind that was not loaded. */
data class KnownTargets(
  val workflows: Set<String>? = null,
  val functions: Set<String>? = null,
  val datasets: Set<String>? = null,
  val lists: Set<String>? = null,
  val campaigns: Set<String>? = null,
  val overlays: Set<String>? = null,
  val webhooks: Set<String>? = null,
  val screens: Set<String>? = null,
)

private fun resolves(known: Set<String>?, id: String?, name: String? = null): Boolean {
  val cleanId = id?.trim().orEmpty()
  val cleanName = name?.trim().orEmpty()
  if (cleanId.isEmpty() && cleanName.isEmpty()) return true // Nothing referenced.
  if (known == null) return true // Target kind not loaded: don't cry wolf.
  return (cleanId.isNotEmpty() && cleanId in known) || (cleanName.isNotEmpty() && cleanName in known)
}

private fun Map<*, *>.text(key: String): String? = (this[key] as? String)

/** Whether a doc is live: not soft-deleted. */
fun FirestoreDoc.alive(): Boolean = data["deletedAt"] == null

fun auditHostReferences(
  actions: List<FirestoreDoc>,
  workflows: List<FirestoreDoc>,
  variables: List<FirestoreDoc>,
  known: KnownTargets,
): List<ReferenceIssue> {
  val issues = mutableListOf<ReferenceIssue>()

  for (action in actions) {
    fun push(refType: String, missing: String) {
      issues += ReferenceIssue("action", action.id, action.string("name") ?: action.id, refType, missing)
    }
    for (step in (action.data["steps"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()) {
      when (step.text("type")) {
        "runWorkflow" -> if (!resolves(known.workflows, step.text("workflowId"), step.text("workflowName"))) {
          push("workflow", step.text("workflowId")?.ifEmpty { null } ?: step.text("workflowName").orEmpty())
        }
        "datasetAppend", "updateDataset" -> if (!resolves(known.datasets, step.text("datasetId"), step.text("datasetName"))) {
          push("dataset", step.text("datasetId")?.ifEmpty { null } ?: step.text("datasetName").orEmpty())
        }
        "enrollList" -> if (!resolves(known.lists, step.text("listId"), step.text("listName"))) {
          push("list", step.text("listId")?.ifEmpty { null } ?: step.text("listName").orEmpty())
        }
        "assignCampaign" -> if (!resolves(known.campaigns, step.text("campaignId"), step.text("campaignName"))) {
          push("campaign", step.text("campaignId")?.ifEmpty { null } ?: step.text("campaignName").orEmpty())
        }
        "showOverlay" -> if (!resolves(known.overlays, step.text("overlayId"), step.text("overlayName"))) {
          push("overlay", step.text("overlayId")?.ifEmpty { null } ?: step.text("overlayName").orEmpty())
        }
        "webhookPost" -> if (!resolves(known.webhooks, step.text("webhookId"), step.text("webhookName"))) {
          push("webhook", step.text("webhookId")?.ifEmpty { null } ?: step.text("webhookName").orEmpty())
        }
        // Screen-id redirects go stale when the screen is deleted or unpublished.
        "redirect" -> if (!resolves(known.screens, step.text("screenId"))) {
          push("screen", step.text("screenId").orEmpty())
        }
      }
    }
  }

  for (workflow in workflows) {
    for (step in (workflow.data["steps"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()) {
      if (!resolves(known.functions, step.text("functionId"), step.text("functionName"))) {
        issues += ReferenceIssue("workflow", workflow.id, workflow.string("name") ?: workflow.id, "function", step.text("functionId")?.ifEmpty { null } ?: step.text("functionName").orEmpty())
      }
    }
  }

  for (variable in variables) {
    if (!resolves(known.workflows, variable.string("workflowId"), variable.string("workflowName"))) {
      issues += ReferenceIssue("variable", variable.id, variable.string("name") ?: variable.id, "workflow", variable.string("workflowId")?.ifEmpty { null } ?: variable.string("workflowName").orEmpty())
    }
  }
  return issues
}

/** A collection's ids and names, trimmed: both resolve a reference. */
fun knownSet(docs: List<FirestoreDoc>, nameKey: String = "name"): Set<String> {
  val set = LinkedHashSet<String>()
  for (doc in docs.filter { it.alive() }) {
    set += doc.id
    doc.string(nameKey)?.trim()?.takeIf { it.isNotEmpty() }?.let { set += it }
  }
  return set
}
