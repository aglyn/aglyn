// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * THE BAR OVER A CRM LIST (the Kotlin `CrmBulk.kt`; the console's
 * `contacts-bulk-bar.tsx`, `leads-`, `companies-`, `deals-` and
 * `tasks-bulk-bar.tsx` over `crm-bulk-writes.ts`): one act over every ticked
 * row, sent where the console sends it, and whatever was left alone or refused
 * named row by row under the bar, never only counted.
 */

/// One act the bar offers. Each list offers the console's own, in the console's order.
enum CrmBulkAction: String, Identifiable, Equatable {
  case addTag, removeTag, owner, stage, company, status, unqualify, lost, complete, assign, due, removeFromSite, delete
  var id: String { rawValue }

  /// The bar's button.
  var label: String {
    switch self {
    case .addTag: "Add tag"
    case .removeTag: "Remove tag"
    case .owner: "Set owner"
    case .stage: "Set stage"
    case .company: "Set company"
    case .status: "Set status"
    case .unqualify: "Unqualify"
    case .lost: "Mark lost"
    case .complete: "Complete"
    case .assign: "Assign"
    case .due: "Set due"
    case .removeFromSite: "Remove from this site"
    case .delete: "Delete"
    }
  }

  var destructive: Bool { self == .removeFromSite || self == .delete }
  /// Done at once, asked nothing: Complete.
  var immediate: Bool { self == .complete }
  /// Confirmed in an alert, with nothing to fill in.
  var confirms: Bool { destructive }
}

/// What a bar names its rows: "1 company", "3 deals".
struct CrmBulkNoun: Equatable {
  let singular: String
  let plural: String

  static let task = CrmBulkNoun(singular: "task", plural: "tasks")

  init(singular: String, plural: String) {
    self.singular = singular
    self.plural = plural
  }

  init(_ kind: CrmKind) {
    singular = kind.singular.lowercased()
    plural = kind.plural.lowercased()
  }

  /// `countNoun`: "1 contact" or "3 contacts".
  func count(_ count: Int) -> String {
    count == 1 ? "1 \(singular)" : "\(count.formatted()) \(plural)"
  }
}

/// The bar's acts for a record list (the console's buttons, in order). The ones a role cannot use stay listed and
/// switched off, as the console's `BlockedControl` and suite lock leave them.
func crmBulkActions(_ kind: CrmKind, orgLevel: Bool) -> [CrmBulkAction] {
  switch kind {
  case .contact: [.addTag, .removeTag, .owner, .stage, .company] + (orgLevel ? [] : [.removeFromSite])
  case .lead: [.owner, .status, .unqualify]
  case .company: [.addTag, .removeTag, .owner, .delete]
  case .deal: [.stage, .owner, .lost, .delete]
  }
}

/// The task list's acts (`tasks-bulk-bar.tsx`).
let crmBulkTaskActions: [CrmBulkAction] = [.complete, .assign, .due, .delete]

/// The value sheet's title (`ACTION_TITLES`).
func crmBulkSheetTitle(_ action: CrmBulkAction, kind: CrmKind?) -> String {
  switch action {
  case .addTag: "Add a tag"
  case .removeTag: "Remove a tag"
  case .owner: "Set the owner"
  case .stage: kind == .contact ? "Set the lifecycle stage" : "Set the stage"
  case .company: "Set the company"
  case .status: "Set the status"
  case .unqualify: "Unqualify"
  case .assign: "Assign to"
  case .due: "Set the due date"
  default: action.label
  }
}

/// A row an act left alone on purpose, or one the store or the route refused, with why.
struct CrmBulkSkip: Equatable, Hashable {
  let label: String
  let reason: String
}

/// What one act did: how many rows it reached, and every row it left, by name.
struct CrmBulkOutcome: Equatable {
  var done = 0
  var refused: [CrmBulkSkip] = []
}

/// The report under the bar: the head line, then one line per row (`CrmBulkBarFrame`).
struct CrmBulkReport: Equatable {
  let heading: String
  let lines: [String]

  init?(_ left: [CrmBulkSkip], noun: CrmBulkNoun) {
    guard !left.isEmpty else { return nil }
    heading = left.count == 1 ? "One \(noun.singular) was not changed:" : "\(left.count) \(noun.plural) were not changed:"
    lines = left.map { "\($0.label) — \($0.reason)" }
  }
}

/// The record pages' cap on tags, which a bulk add never slips past (`CONTACT_TAGS_CAP`, `COMPANY_TAGS_CAP`).
let crmBulkTagsCap = 20
/// The longest reason a lead is unqualified or a deal lost with (`UNQUALIFY_REASON_MAX`, `LOST_REASON_MAX`).
let crmBulkReasonMax = 500
/// How many contacts one `crm/contact-update` or `crm/contact-remove` request names (`CRM_CONTACT_UPDATE_MAX`).
let crmBulkContactRouteMax = 200

/// `normalizeBulkTag`: trimmed, lowercased, at most 60 characters; nil for nothing.
func crmBulkTag(_ input: String) -> String? {
  let tag = String(input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().prefix(60))
  return tag.isEmpty ? nil : tag
}

/// What the bar reads off a row.
struct CrmBulkRow: Equatable {
  let id: String
  /// What a report names it by: a contact's address, a lead's name, a company's name, a deal's title, a task's title.
  let label: String
  var tags: [String] = []
  var companyID: String?
  var status: String?
  var statusLabel: String?
  var converted = false
  var pipelineID: String?
  /// The site a contact's stage is moved on: a site of the holder whose facet the row was read through.
  var site: String?
  /// Whether some site holds the contact: a row nobody holds has no facet to write.
  var held = true
}

/// The site of a holder: the holder itself when it is a site, a declared group's first site, nil for the organization's
/// own facet or none.
func crmHolderSite(_ holder: String, org: [String: Any]?) -> String? {
  guard !holder.isEmpty, holder != orgContactHolderID else { return nil }
  if let group = consentGroupNamed(org, holder) { return group.hostIDs.first }
  return holder
}

/// A record list's row as the bar reads it, through the facet the list shows it by.
func crmBulkRow(_ row: CrmRow, scope: CrmScope) -> CrmBulkRow {
  func s(_ key: String) -> String? {
    (row.data[key] as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
  }
  let tags = (row.data["tags"] as? [Any] ?? []).compactMap { $0 as? String }
  switch row.kind {
  case .contact:
    // `contactBulkAddressOf`: the address, else the id. The row's data is already the holder's view.
    let holder = scope.groupID.isEmpty ? crmContactPrimaryHolder(row.data, org: scope.org) : scope.groupID
    let site = scope.orgLevel ? crmHolderSite(holder, org: scope.org) : scope.hostID
    return CrmBulkRow(
      id: row.id, label: s("email") ?? row.id, tags: tags, companyID: s("companyId"), site: site,
      held: !scope.orgLevel || !(holder.isEmpty || holder == orgContactHolderID))
  case .lead:
    return CrmBulkRow(
      id: row.id, label: s("name") ?? s("email") ?? row.id, status: s("status"), statusLabel: s("statusLabel"),
      converted: s("convertedContactId") != nil)
  case .company:
    return CrmBulkRow(id: row.id, label: s("name") ?? row.id, tags: tags)
  case .deal:
    return CrmBulkRow(id: row.id, label: s("title") ?? "Untitled deal", status: s("status"), pipelineID: s("pipelineId"))
  }
}

/// A task as the bar reads it.
func crmBulkRow(_ task: CrmTask) -> CrmBulkRow {
  CrmBulkRow(id: task.id, label: task.title.isEmpty ? task.id : task.title, status: task.status)
}

/// The rows a plan reaches, and the rows it leaves out by name.
struct CrmBulkPlan: Equatable {
  var rows: [CrmBulkRow] = []
  var skipped: [CrmBulkSkip] = []
}

/// `planAddTag` / `planCompanyAddTag`: a row that carries the tag is left out silently; one already at the cap is left
/// out and named.
func crmBulkPlanAddTag(_ rows: [CrmBulkRow], tag: String) -> CrmBulkPlan {
  var plan = CrmBulkPlan()
  for row in rows {
    let held = row.tags.map { $0.lowercased() }
    if held.contains(tag) { continue }
    if held.count >= crmBulkTagsCap {
      plan.skipped.append(CrmBulkSkip(label: row.label, reason: "already has \(crmBulkTagsCap) tags"))
      continue
    }
    plan.rows.append(row)
  }
  return plan
}

/// `planRemoveTag`: the rows that carry it.
func crmBulkPlanRemoveTag(_ rows: [CrmBulkRow], tag: String) -> CrmBulkPlan {
  CrmBulkPlan(rows: rows.filter { $0.tags.map { $0.lowercased() }.contains(tag) })
}

/// `planSetCompany`: a contact already filed under the company is left alone.
func crmBulkPlanSetCompany(_ rows: [CrmBulkRow], companyID: String?) -> CrmBulkPlan {
  CrmBulkPlan(rows: rows.filter { $0.companyID != companyID })
}

/// The leads Set status reaches: a converted lead's status is its conversion, and one already at the asked status
/// is left alone (`leads-bulk-bar.tsx`).
func crmBulkPlanLeadStatus(_ rows: [CrmBulkRow], status: String, label: String) -> CrmBulkPlan {
  var plan = CrmBulkPlan()
  for row in rows {
    if row.converted {
      plan.skipped.append(CrmBulkSkip(label: row.label, reason: "was converted"))
    } else if row.status == status && (row.statusLabel ?? leadStatusLabel(status)) == label {
      plan.skipped.append(CrmBulkSkip(label: row.label, reason: "already \(label)"))
    } else {
      plan.rows.append(row)
    }
  }
  return plan
}

/// The leads Unqualify reaches: open ones that were not converted.
func crmBulkPlanUnqualify(_ rows: [CrmBulkRow]) -> CrmBulkPlan {
  let open = Set(ContractValues.shared.nativeCrmLeadOpenStatuses)
  var plan = CrmBulkPlan()
  for row in rows {
    if row.converted {
      plan.skipped.append(CrmBulkSkip(label: row.label, reason: "was converted"))
    } else if !open.contains(row.status ?? "new") {
      plan.skipped.append(CrmBulkSkip(label: row.label, reason: "is already closed"))
    } else {
      plan.rows.append(row)
    }
  }
  return plan
}

/// The one pipeline the selected deals are in, or nil when they span more than one: Set stage then has no list.
func crmBulkPipeline(_ rows: [CrmBulkRow]) -> String?? {
  let ids = Set(rows.map { $0.pipelineID ?? "" })
  guard ids.count == 1, let id = ids.first else { return nil }
  return .some(id.isEmpty ? nil : id)
}

/// The stages Set stage offers a pipeline's deals: its open stages, then its won stage.
func crmBulkDealStages(_ pipeline: Pipeline) -> [Stage] {
  pipeline.openStages + pipeline.stages.filter { $0.kind == "won" }.prefix(1)
}

/// How a finished act reads (`doneSentence`), given how many rows it reached and what it set.
func crmBulkDoneSentence(_ action: CrmBulkAction, noun: CrmBulkNoun, count: Int, cleared: Bool = false, named: String? = nil) -> String {
  let rows = noun.count(count)
  switch action {
  case .addTag: return "Tagged \(rows)"
  case .removeTag: return "Removed the tag from \(rows)"
  case .owner: return cleared && noun.singular == "lead" ? "Owner cleared on \(rows)" : "Owner set on \(rows)"
  case .stage: return named.map { "Moved \(rows) to \($0)" } ?? "Stage set on \(rows)"
  case .company: return "Company set on \(rows)"
  case .status: return "Status set on \(rows)"
  case .unqualify: return "Marked \(rows) unqualified"
  case .lost: return "Marked \(rows) lost"
  case .complete: return "Completed \(rows)"
  case .assign: return "Assigned \(rows) to \(named ?? "nobody")"
  case .due: return cleared ? "Due date cleared on \(rows)" : "Due date set on \(rows)"
  case .removeFromSite: return "\(rows) removed from this site"
  case .delete: return "Deleted \(rows)"
  }
}

/// The sentence a finished act shows: what it did, else that it changed nothing (`useCrmBulkApply`).
func crmBulkSentence(_ outcome: CrmBulkOutcome, attempted: Int, done: (Int) -> String) -> String {
  outcome.done > 0 ? done(outcome.done) : attempted > 0 ? "Nothing was changed" : "Nothing to change"
}

/// The alert a destructive act asks first (the console's confirms, word for word).
struct CrmBulkConfirm: Equatable {
  let title: String
  let message: String
  let button: String
}

func crmBulkConfirm(_ action: CrmBulkAction, noun: CrmBulkNoun, count: Int) -> CrmBulkConfirm? {
  let one = count == 1
  switch (action, noun.singular) {
  case (.removeFromSite, _):
    return CrmBulkConfirm(
      title: one ? "Remove this contact?" : "Remove \(count) contacts?",
      message: "\(one ? "This person is" : "These \(count) people are") removed from this site's Contacts, along with their notes, tags and "
        + "timeline. Other sites that captured the same people keep their own records. Their form submissions, orders, bookings, and "
        + "membership records are separate — delete those from their own pages if the request covers them.",
      button: one ? "Remove contact" : "Remove contacts")
  case (.delete, "company"):
    return CrmBulkConfirm(
      title: one ? "Delete this company?" : "Delete \(count) companies?",
      message: "\(one ? "It is" : "They are") removed from Companies and unlinked from every contact at them. The contacts themselves are "
        + "kept, and so is anything else filed against the companies.",
      button: one ? "Delete company" : "Delete companies")
  case (.delete, "deal"):
    return CrmBulkConfirm(
      title: one ? "Delete this deal?" : "Delete \(count) deals?",
      message: "\(one ? "It is" : "They are") removed from the pipeline along with their notes. The contacts and the companies they name "
        + "are not touched.",
      button: one ? "Delete deal" : "Delete deals")
  case (.delete, "task"):
    return CrmBulkConfirm(
      title: one ? "Delete this task?" : "Delete \(count) tasks?",
      message: "\(one ? "It is" : "They are") removed for everyone who can see them. A finished task is better ticked done, which keeps it "
        + "in the Done view.",
      button: one ? "Delete task" : "Delete tasks")
  default:
    return nil
  }
}

/// `bulkRefusalReason`: whatever the store or the route threw, as one sentence a report can carry.
func crmBulkRefusal(_ error: Error) -> String {
  if let api = error as? ConsoleAPIError {
    if api.status == 403 { return api.message.isEmpty ? "not permitted" : api.message }
    if api.status == 404 { return api.message.isEmpty ? "no longer exists" : api.message }
    return api.message.isEmpty ? "the write failed" : api.message
  }
  let text = (error as? LocalizedError)?.errorDescription ?? ""
  let lowered = text.lowercased()
  if lowered.contains("permission") { return "not permitted" }
  if lowered.contains("not found") || lowered.contains("no document") { return "no longer exists" }
  return text.isEmpty ? "the write failed" : text
}

/// `runCrmBulkCalls`: one request per row, in order, each refusal named by the row.
func crmBulkEach(_ rows: [CrmBulkRow], _ call: (CrmBulkRow) async throws -> Void) async -> CrmBulkOutcome {
  var outcome = CrmBulkOutcome()
  for row in rows {
    do {
      try await call(row)
      outcome.done += 1
    } catch {
      outcome.refused.append(CrmBulkSkip(label: row.label, reason: crmBulkRefusal(error)))
    }
  }
  return outcome
}

/// One route's answer for one row.
struct CrmBulkAnswer: Equatable {
  let id: String
  let ok: Bool
  var error: String?
}

/// `runCrmBulkBatch`: one request per piece of the selection, answered per row. A row the answer does not mention was
/// not written; a request refused whole is every row it carried refused with its one sentence.
func crmBulkBatch(
  _ rows: [CrmBulkRow], chunk: Int = crmBulkContactRouteMax, _ call: ([String]) async throws -> [CrmBulkAnswer]
) async -> CrmBulkOutcome {
  var outcome = CrmBulkOutcome()
  var start = 0
  while start < rows.count {
    let piece = Array(rows[start..<min(start + chunk, rows.count)])
    start += chunk
    let answers: [CrmBulkAnswer]
    do {
      answers = try await call(piece.map(\.id))
    } catch {
      let reason = crmBulkRefusal(error)
      outcome.refused += piece.map { CrmBulkSkip(label: $0.label, reason: reason) }
      continue
    }
    let byID = Dictionary(answers.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    for row in piece {
      if let answer = byID[row.id], answer.ok {
        outcome.done += 1
      } else {
        let error = byID[row.id]?.error ?? ""
        outcome.refused.append(CrmBulkSkip(label: row.label, reason: error.isEmpty ? "the write failed" : error))
      }
    }
  }
  return outcome
}

/// A contact route's per-contact answers (`results: [{ contactId, ok, error? }]`).
func crmBulkAnswers(_ answer: JSONValue?) -> [CrmBulkAnswer] {
  (answer?["results"]?.arrayValue ?? []).compactMap { result in
    guard let id = result["contactId"]?.stringValue ?? result["taskId"]?.stringValue ?? result["id"]?.stringValue else { return nil }
    return CrmBulkAnswer(id: id, ok: result["ok"]?.boolValue == true, error: result["error"]?.stringValue)
  }
}

/// The value an act was given in its sheet.
struct CrmBulkValue: Equatable {
  /// A tag, an owner's or assignee's uid (empty for nobody), a stage, a company (empty for none), a status, a reason.
  var text = ""
  /// A task's due time; nil clears it.
  var dueAtMs: Int64?
}

/// What one act did, said, and left.
struct CrmBulkResult: Equatable {
  let sentence: String
  let report: CrmBulkReport?
  let outcome: CrmBulkOutcome
  /// The picked rows a destructive act could not remove, which stay ticked so the reader can see them.
  var keep: [String] = []
}

extension CrmAPI {
  /// One act over a record list's ticked rows, sent where the console sends it.
  @MainActor func bulk(
    _ action: CrmBulkAction, kind: CrmKind, rows picked: [CrmBulkRow], value: CrmBulkValue, reference: CrmReference
  ) async -> CrmBulkResult {
    let noun = CrmBulkNoun(kind)
    var plan = CrmBulkPlan(rows: picked)
    var named: String?
    var loggedByRoute = false
    let cleared = value.text.isEmpty
    let job: (CrmBulkPlan) async -> CrmBulkOutcome
    switch (kind, action) {
    case (.contact, _):
      // A row no site holds has no facet to write: at the workspace's level it is left out and says so.
      let unheld = picked.filter { !$0.held }
      plan = CrmBulkPlan(rows: picked.filter(\.held), skipped: unheld.map { CrmBulkSkip(label: $0.label, reason: "no site holds this contact yet") })
      func update(_ set: [String: JSONValue]) -> (CrmBulkPlan) async -> CrmBulkOutcome {
        { plan in await crmBulkBatch(plan.rows) { ids in try await updateContacts(ids, set: set) } }
      }
      switch action {
      case .addTag, .removeTag:
        guard let tag = crmBulkTag(value.text) else { return CrmBulkResult(sentence: "Nothing to change", report: nil, outcome: .init()) }
        let reached = action == .addTag ? crmBulkPlanAddTag(plan.rows, tag: tag) : crmBulkPlanRemoveTag(plan.rows, tag: tag)
        plan = CrmBulkPlan(rows: reached.rows, skipped: plan.skipped + reached.skipped)
        job = update([action == .addTag ? "addTag" : "removeTag": .string(tag)])
      case .owner:
        job = update(["ownerUid": .string(value.text)])
      case .company:
        let company = value.text.isEmpty ? nil : value.text
        let reached = crmBulkPlanSetCompany(plan.rows, companyID: company)
        plan = CrmBulkPlan(rows: reached.rows, skipped: plan.skipped)
        job = update(["companyId": company.map { .string($0) } ?? .null])
      case .stage:
        // One row at a time through the one writer of a contact's stage, on the site that holds the row.
        job = { plan in
          await crmBulkEach(plan.rows) { row in
            guard let site = row.site else { throw ConsoleAPIError(status: 400, message: "no site holds this contact yet") }
            try await setContactStage(row.id, value.text, site: site)
          }
        }
      case .removeFromSite:
        job = { plan in await crmBulkBatch(plan.rows) { ids in try await removeContacts(ids) } }
      default:
        job = { _ in CrmBulkOutcome() }
      }
    case (.lead, .owner), (.company, .owner), (.deal, .owner):
      let owner: Any = value.text.isEmpty ? FirestoreSentinel.delete as Any : value.text as Any
      job = { plan in await crmBulkEach(plan.rows) { row in try await updateRecord(kind, row.id, ["ownerUid": owner]) } }
    case (.lead, .status):
      let label = leadStatusLabel(value.text)
      plan = crmBulkPlanLeadStatus(picked, status: value.text, label: label)
      job = { plan in
        await crmBulkEach(plan.rows) { row in
          // Reopening an unqualified lead clears its reason, as the row does.
          var changes: [String: Any] = ["status": value.text, "statusLabel": label]
          if row.status == "unqualified" { changes["unqualifiedReason"] = FirestoreSentinel.delete }
          try await updateRecord(.lead, row.id, changes)
        }
      }
    case (.lead, .unqualify):
      plan = crmBulkPlanUnqualify(picked)
      let reason = String(value.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(crmBulkReasonMax))
      job = { plan in
        await crmBulkEach(plan.rows) { row in
          try await updateRecord(
            .lead, row.id, ["status": "unqualified", "statusLabel": leadStatusLabel("unqualified"), "unqualifiedReason": reason])
        }
      }
    case (.company, .addTag), (.company, .removeTag):
      guard let tag = crmBulkTag(value.text) else { return CrmBulkResult(sentence: "Nothing to change", report: nil, outcome: .init()) }
      plan = action == .addTag ? crmBulkPlanAddTag(picked, tag: tag) : crmBulkPlanRemoveTag(picked, tag: tag)
      job = { plan in
        await crmBulkEach(plan.rows) { row in
          let held = row.tags.filter { $0.lowercased() != tag }
          try await updateRecord(.company, row.id, ["tags": action == .addTag ? held + [tag] : held])
        }
      }
    case (.company, .delete):
      job = { plan in await crmBulkEach(plan.rows) { row in try await deleteCompany(row.id) } }
    case (.deal, .stage):
      let pipeline = reference.pipeline(crmBulkPipeline(picked) ?? nil)
      named = pipeline.stages.first { $0.id == value.text }?.name
      loggedByRoute = true
      job = { plan in await crmBulkEach(plan.rows) { row in try await moveDeal(row.id, stageID: value.text) } }
    case (.deal, .lost):
      loggedByRoute = true
      let reason = String(value.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(crmBulkReasonMax))
      job = { plan in await crmBulkEach(plan.rows) { row in try await closeDeal(row.id, won: false, lostReason: reason) } }
    case (.deal, .delete):
      job = { plan in await crmBulkEach(plan.rows) { row in try await deleteRecord(.deal, row.id) } }
    default:
      job = { _ in CrmBulkOutcome() }
    }
    let outcome = await job(plan)
    let sentence = crmBulkSentence(outcome, attempted: plan.rows.count) {
      crmBulkDoneSentence(action, noun: noun, count: $0, cleared: cleared, named: named)
    }
    if !loggedByRoute { await logBulk(sentence, kind: kind.rawValue, done: outcome.done) }
    let refused = Set(outcome.refused.map(\.label))
    return CrmBulkResult(
      sentence: sentence, report: CrmBulkReport(plan.skipped + outcome.refused, noun: noun), outcome: outcome,
      keep: action.destructive ? picked.filter { refused.contains($0.label) }.map(\.id) : [])
  }

  /// One act over the ticked tasks (`tasks-bulk-bar.tsx`): Complete and Assign through their routes, the due date and
  /// the delete client-direct, then the linked records' next activity.
  @MainActor func bulkTasks(_ action: CrmBulkAction, tasks picked: [CrmTask], value: CrmBulkValue, reference: CrmReference) async -> CrmBulkResult {
    let noun = CrmBulkNoun.task
    let byID = Dictionary(picked.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    var rows = picked.map(crmBulkRow)
    var named: String?
    var loggedByRoute = false
    let job: ([CrmBulkRow]) async -> CrmBulkOutcome
    switch action {
    case .complete:
      rows = rows.filter { $0.status != "done" }
      job = { rows in await crmBulkEach(rows) { row in try await completeTask(row.id) } }
    case .assign:
      let assignee = value.text.isEmpty ? nil : value.text
      named = assignee.flatMap { reference.memberLabel($0) } ?? "nobody"
      job = { rows in
        await crmBulkEach(rows) { row in
          guard var draft = byID[row.id]?.draft else { return }
          draft.assigneeUID = assignee
          try await saveTask(row.id, draft)
        }
      }
    case .due:
      job = { rows in
        await crmBulkEach(rows) { row in
          guard let task = byID[row.id] else { return }
          try await setTaskDue(task, value.dueAtMs)
        }
      }
    case .delete:
      job = { rows in await crmBulkEach(rows) { row in if let task = byID[row.id] { try await deleteTask(task) } } }
    default:
      loggedByRoute = true
      job = { _ in CrmBulkOutcome() }
    }
    let outcome = await job(rows)
    let sentence = crmBulkSentence(outcome, attempted: rows.count) {
      crmBulkDoneSentence(action, noun: noun, count: $0, cleared: value.dueAtMs == nil, named: named)
    }
    if !loggedByRoute { await logBulk(sentence, kind: "task", done: outcome.done) }
    let refused = Set(outcome.refused.map(\.label))
    return CrmBulkResult(
      sentence: sentence, report: CrmBulkReport(outcome.refused, noun: noun), outcome: outcome,
      keep: action == .delete ? picked.filter { refused.contains(crmBulkRow($0).label) }.map(\.id) : [])
  }
}
