// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// An activity row's words (activity-presenter.ts `activityRowText` and `activityActorLabel`, activity-labels.ts,
// run-activity-words.ts): what the console's Recent Activity and Page Activity cards print for a stored
// `hosts/{id}/activity` document. The nouns, the AI codes' words and sentences, and the brand come from the contracts;
// the automation-run words are replayed by their function cases.

/// The fields of a stored activity document a row reads. Any of them may be absent.
public struct ActivityEntryFields: Equatable, Sendable {
  public var action: String?
  public var targetType: String?
  public var targetName: String?
  /// Early org entries carried the type at the top level rather than under `target`.
  public var type: String?
  public var actorId: String?
  public var actorEmail: String?
  public var actorEmailNow: String?
  public var apiKeyName: String?
  public var staffActorEmail: String?

  public init(
    action: String? = nil, targetType: String? = nil, targetName: String? = nil, type: String? = nil, actorId: String? = nil,
    actorEmail: String? = nil, actorEmailNow: String? = nil, apiKeyName: String? = nil, staffActorEmail: String? = nil
  ) {
    self.action = action
    self.targetType = targetType
    self.targetName = targetName
    self.type = type
    self.actorId = actorId
    self.actorEmail = actorEmail
    self.actorEmailNow = actorEmailNow
    self.apiKeyName = apiKeyName
    self.staffActorEmail = staffActorEmail
  }

  /// A Firestore activity document's fields.
  public init(data: [String: Any]) {
    let target = data["target"] as? [String: Any]
    self.init(
      action: data["action"] as? String, targetType: target?["type"] as? String, targetName: target?["name"] as? String,
      type: data["type"] as? String, actorId: data["actorId"] as? String, actorEmail: data["actorEmail"] as? String,
      actorEmailNow: data["actorEmailNow"] as? String, apiKeyName: data["apiKeyName"] as? String,
      staffActorEmail: data["staffActorEmail"] as? String)
  }
}

private func trimmed(_ text: String?) -> String { text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

/// A plugin's namespaced target type, `pluginId:noun`.
private let pluginTargetType = try! NSRegularExpression(pattern: #"^[a-z][a-z0-9-]*:([A-Za-z][A-Za-z0-9]*)$"#)

/// The run line the automation engine files (run-activity-words.ts).
private let automationRunLine = try! NSRegularExpression(
  pattern: #"^(Action|Org automation|Workflow) (ran|skipped|failed|is waiting,) on ([A-Za-z][\w.:-]*?)(?:(?: with errors)?:\s.*| with errors:.*)?$"#)

/// The capture groups of a whole-string match, or nil.
private func firstGroups(_ text: String, _ regex: NSRegularExpression) -> [String]? {
  let range = NSRange(text.startIndex..., in: text)
  guard let match = regex.firstMatch(in: text, range: range) else { return nil }
  return (1..<match.numberOfRanges).map { index in
    Range(match.range(at: index), in: text).map { String(text[$0]) } ?? ""
  }
}

private func capitalizedFirst(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

/// The noun a target type reads as: `screen` → `Page`, a plugin's `outreach:mailbox` → `Mailbox`, nothing → `Item`.
public func activityTypeLabel(_ type: String?) -> String {
  guard let type, !type.isEmpty else { return "Item" }
  if let known = ContractValues.shared.activityTypeLabels[type] { return known }
  if let noun = firstGroups(type, pluginTargetType)?.first { return capitalizedFirst(noun) }
  return capitalizedFirst(type)
}

/// `page Home`: the noun and name a sentence uses (`activityTargetPhrase`).
public func activityTargetPhrase(type: String?, name: String?) -> String {
  let noun = activityTypeLabel(type)
  let lower = noun == "Item" ? "item" : noun.prefix(1).lowercased() + noun.dropFirst()
  let name = trimmed(name)
  return name.isEmpty ? lower : "\(lower) \(name)"
}

/// An automation run line in words (`describeAutomationRunAction`): `Action ran on order.created` → `Automation ran:
/// Order created`; nil for any other line.
public func describeAutomationRunAction(_ action: String) -> String? {
  let line = action.trimmingCharacters(in: .whitespacesAndNewlines)
  guard let groups = firstGroups(line, automationRunLine), groups.count == 3 else { return nil }
  let (actor, verb, event) = (groups[0], groups[1], groups[2])
  let failed = verb == "failed" || action.contains(" with errors:")
  let who = actor == "Action" ? "Automation" : actor
  let what = failed ? "failed" : verb == "skipped" ? "skipped" : verb == "is waiting," ? "is waiting" : "ran"
  let label = hostEventLabel(event)
  let words: String
  if label != event {
    words = label
  } else {
    let spaced = event.replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression)
      .replacingOccurrences(of: "[._:-]+", with: " ", options: .regularExpression).lowercased()
    words = capitalizedFirst(spaced)
  }
  return "\(who) \(what): \(words)"
}

/// What a stored action reads as (`activityActionLabel`): an AI code's words, an automation run in words, a duplicate's
/// sentence, else the stored text.
public func activityActionText(_ action: String?) -> String {
  let stored = trimmed(action)
  let values = ContractValues.shared
  return values.aiActivityActionLabels[stored] ?? describeAutomationRunAction(stored)
    ?? values.duplicateActivityActionLabels[stored] ?? stored
}

/// The row's text (`activityRowText`): an AI code with a sentence reads as one about its target (`Created page Home
/// with Aglyn AI`); any other row is `action — name`, the action alone, or the target's name.
public func activityRowText(_ entry: ActivityEntryFields) -> String {
  let stored = trimmed(entry.action)
  if let sentence = ContractValues.shared.aiActivityActionSentences[stored] {
    return sentence.replacingOccurrences(of: "{target}", with: activityTargetPhrase(type: entry.targetType, name: entry.targetName))
  }
  let action = activityActionText(stored)
  let name = trimmed(entry.targetName)
  if !action.isEmpty && !name.isEmpty { return "\(action) — \(name)" }
  if !action.isEmpty { return action }
  if let name = entry.targetName, !name.isEmpty { return name }
  return activityTypeLabel(entry.targetType)
}

/// Who did it (`activityActorLabel`): the address recorded, an integration's key, the account, a workflow, or the
/// platform.
public func activityActorLabel(_ entry: ActivityEntryFields) -> String {
  if let email = entry.actorEmail, !email.isEmpty { return email }
  if let key = entry.apiKeyName, !key.isEmpty { return "API key \(key)" }
  let actorID = trimmed(entry.actorId)
  if actorID == "api" { return "API key" }
  if !actorID.isEmpty && !actorID.hasPrefix("system:") {
    if let now = entry.actorEmailNow, !now.isEmpty { return now }
    return "Account \(actorID)"
  }
  if (entry.targetType ?? entry.type) == "workflow" {
    let name = trimmed(entry.targetName)
    return name.isEmpty ? "Workflow" : "Workflow \(name)"
  }
  let brand = ContractValues.shared.platformBrandName
  if let staff = entry.staffActorEmail, !staff.isEmpty { return "\(brand) staff (\(staff))" }
  return brand
}
