// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/*
 * Reference health (wave v7): id references are rename-safe but not
 * delete-safe, so the audit cross-checks every reference an automation,
 * workflow or computed variable holds against what still exists and lists the
 * dangling ones. A port of the console's reference-audit.ts as the Logic
 * page's card drives it (actions, workflows and variables). The Kotlin
 * plugin's ReferenceAudit.kt.
 */

/// What holds a broken reference, and what it points at.
struct ReferenceIssue: Equatable, Identifiable {
  /// `action`, `workflow` or `variable`.
  let source: String
  let sourceID: String
  let sourceName: String
  /// What the reference points at ("workflow", "dataset", …).
  let refType: String
  /// The dangling id or name as stored.
  let missing: String

  var id: String { "\(source):\(sourceID):\(refType):\(missing)" }
}

/// Known-good targets: doc ids AND display names both resolve. A nil set is a kind that was not loaded.
struct KnownTargets {
  var workflows: Set<String>?
  var functions: Set<String>?
  var datasets: Set<String>?
  var lists: Set<String>?
  var campaigns: Set<String>?
  var overlays: Set<String>?
  var webhooks: Set<String>?
  var screens: Set<String>?
}

private func resolves(_ known: Set<String>?, _ id: String?, _ name: String? = nil) -> Bool {
  let cleanID = (id ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let cleanName = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if cleanID.isEmpty && cleanName.isEmpty { return true }  // Nothing referenced.
  guard let known else { return true }  // Target kind not loaded: don't cry wolf.
  return (!cleanID.isEmpty && known.contains(cleanID)) || (!cleanName.isEmpty && known.contains(cleanName))
}

private func text(_ step: [String: Any], _ key: String) -> String? { step[key] as? String }

private func missing(_ step: [String: Any], _ idKey: String, _ nameKey: String) -> String {
  let id = text(step, idKey) ?? ""
  return id.isEmpty ? (text(step, nameKey) ?? "") : id
}

extension FirestoreDocument {
  /// Live: not soft-deleted.
  var alive: Bool { data["deletedAt"] == nil || data["deletedAt"] is NSNull }
}

private func steps(_ doc: FirestoreDocument) -> [[String: Any]] {
  (doc.data["steps"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
}

func auditHostReferences(
  actions: [FirestoreDocument], workflows: [FirestoreDocument], variables: [FirestoreDocument], known: KnownTargets
) -> [ReferenceIssue] {
  var issues: [ReferenceIssue] = []

  for action in actions {
    func push(_ refType: String, _ missing: String) {
      issues.append(ReferenceIssue(source: "action", sourceID: action.id, sourceName: action.string("name") ?? action.id, refType: refType, missing: missing))
    }
    for step in steps(action) {
      switch text(step, "type") {
      case "runWorkflow":
        if !resolves(known.workflows, text(step, "workflowId"), text(step, "workflowName")) { push("workflow", missing(step, "workflowId", "workflowName")) }
      case "datasetAppend", "updateDataset":
        if !resolves(known.datasets, text(step, "datasetId"), text(step, "datasetName")) { push("dataset", missing(step, "datasetId", "datasetName")) }
      case "enrollList":
        if !resolves(known.lists, text(step, "listId"), text(step, "listName")) { push("list", missing(step, "listId", "listName")) }
      case "assignCampaign":
        if !resolves(known.campaigns, text(step, "campaignId"), text(step, "campaignName")) { push("campaign", missing(step, "campaignId", "campaignName")) }
      case "showOverlay":
        if !resolves(known.overlays, text(step, "overlayId"), text(step, "overlayName")) { push("overlay", missing(step, "overlayId", "overlayName")) }
      case "webhookPost":
        if !resolves(known.webhooks, text(step, "webhookId"), text(step, "webhookName")) { push("webhook", missing(step, "webhookId", "webhookName")) }
      case "redirect":
        // Screen-id redirects go stale when the screen is deleted or unpublished.
        if !resolves(known.screens, text(step, "screenId")) { push("screen", text(step, "screenId") ?? "") }
      default: break
      }
    }
  }

  for workflow in workflows {
    for step in steps(workflow) where !resolves(known.functions, text(step, "functionId"), text(step, "functionName")) {
      issues.append(
        ReferenceIssue(
          source: "workflow", sourceID: workflow.id, sourceName: workflow.string("name") ?? workflow.id, refType: "function",
          missing: missing(step, "functionId", "functionName")))
    }
  }

  for variable in variables where !resolves(known.workflows, variable.string("workflowId"), variable.string("workflowName")) {
    let id = variable.string("workflowId") ?? ""
    issues.append(
      ReferenceIssue(
        source: "variable", sourceID: variable.id, sourceName: variable.string("name") ?? variable.id, refType: "workflow",
        missing: id.isEmpty ? (variable.string("workflowName") ?? "") : id))
  }
  return issues
}

/// A collection's ids and names, trimmed: both resolve a reference.
func knownSet(_ docs: [FirestoreDocument], nameKey: String = "name") -> Set<String> {
  var set = Set<String>()
  for doc in docs where doc.alive {
    set.insert(doc.id)
    if let name = doc.string(nameKey)?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { set.insert(name) }
  }
  return set
}
