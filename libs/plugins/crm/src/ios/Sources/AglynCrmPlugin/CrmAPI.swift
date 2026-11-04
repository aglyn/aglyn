// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/*
 * THE CRM'S WRITES, AS THE CONSOLE MAKES THEM (the Kotlin `CrmApi.kt`):
 * routes where the console posts to one, the member's own writes under the
 * rules where the console writes the record itself, followed by the
 * console's `crm/list-fields` and `crm/sharing` follow-ups.
 */

enum CrmRoutes {
  static let contactsCreate = "/api/crm/contacts-create"
  static let contactUpdate = "/api/crm/contact-update"
  static let contactStage = "/api/crm/contact-stage"
  static let contactRemove = "/api/crm/contact-remove"
  static let companyDelete = "/api/crm/company-delete"
  static let leadsCreate = "/api/crm/leads-create"
  static let leadConvert = "/api/crm/lead-convert"
  static let dealStage = "/api/crm/deal-stage"
  static let taskSave = "/api/crm/task-save"
  static let taskComplete = "/api/crm/task-complete"
  static let nextActivity = "/api/crm/next-activity"
  static let listFields = "/api/crm/list-fields"
  static let sharing = "/api/crm/sharing"
  static let emailSend = "/api/crm/email-send"
  static let members = "/api/orgs/members"
}

struct TaskDraft: Equatable {
  var title = ""
  var kind = "todo"
  var priority = "normal"
  var dueAtMs: Int64?
  var assigneeUID: String?
  var notes = ""
  var contactID: String?
  var companyID: String?
  var dealID: String?
  /// A new task's site, at the workspace's level; nil files it with the organization.
  var sourceSite: String?
}

struct ConvertDraft {
  var ownerUID: String?
  var companyID: String?
  var createCompanyName: String?
  var dealTitle: String?
  var dealAmountCents: Int64?
  var dealStageID: String?
}

/// A route body with the site scope, nils dropped and route nulls kept as JSON null.
private func routeBody(_ base: [String: Any?], _ fields: [String: Any?]) -> JSONValue {
  var all = base
  for (key, value) in fields { all[key] = value }
  return jsonBody(all)
}

/// A contact-update `set`: a cleared field is JSON null, a custom key nested under `custom`.
func contactSetBody(_ changes: [String: Any]) -> JSONValue {
  func encode(_ value: Any) -> JSONValue {
    if case FirestoreSentinel.delete? = value as? FirestoreSentinel { return .null }
    if let map = value as? [String: Any] { return .object(map.mapValues(encode)) }
    return jsonValue(value) ?? .null
  }
  return .object(changes.mapValues(encode))
}

struct CrmAPI {
  let api: ConsoleAPIClient
  let reader: FirestoreReader
  let scope: CrmScope

  private func path(_ kind: CrmKind, _ id: String) -> [String] { crmPath(scope.orgID, kind.collection) + [id] }
  private func body(_ fields: [String: Any?]) -> JSONValue { routeBody(scope.routeScope, fields) }
  private func taskBody(_ fields: [String: Any?]) -> JSONValue { routeBody(scope.taskScope, fields) }
  /// A record's own provenance: its site, or JSON null for a record from no site.
  private var stampedHost: Any { scope.createHostID.map { $0 as Any } ?? NSNull() }

  func afterClientWrite(_ kind: CrmKind, _ id: String) async {
    _ = try? await api.request(CrmRoutes.listFields, method: .post, body: body(["collection": kind.collection, "ids": [id]]))
    if kind != .contact {
      _ = try? await api.request(
        CrmRoutes.sharing, method: .post, body: body(["action": "evaluate", "object": kind.collection, "ids": [id]]))
    }
  }

  func createContact(_ fields: [String: Any]) async throws -> String? {
    try await api.request(CrmRoutes.contactsCreate, method: .post, body: body(fields))?["contactId"]?.stringValue
  }

  func createLead(_ fields: [String: Any]) async throws -> String? {
    try await api.request(CrmRoutes.leadsCreate, method: .post, body: body(fields))?["leadId"]?.stringValue
  }

  func createRecord(_ kind: CrmKind, _ fields: [String: Any], extra: [String: Any] = [:]) async throws -> String {
    let id = newRecordID()
    var all = fields
    for (key, value) in extra { all[key] = value }
    all["visibleTo"] = scope.createTokens
    all["hostId"] = stampedHost
    all["createdByUid"] = scope.uid
    all["nextTaskAtMs"] = NSNull()
    all["createdAt"] = FirestoreSentinel.serverTimestamp
    all["updatedAt"] = FirestoreSentinel.serverTimestamp
    try await reader.setDocument(path(kind, id), all, merge: true)
    await afterClientWrite(kind, id)
    return id
  }

  func updateRecord(_ kind: CrmKind, _ id: String, _ changes: [String: Any]) async throws {
    guard !changes.isEmpty else { return }
    var all = changes
    all["updatedAt"] = FirestoreSentinel.serverTimestamp
    try await reader.setDocument(path(kind, id), all, merge: true)
    await afterClientWrite(kind, id)
  }

  func updateContact(_ id: String, _ changes: [String: Any]) async throws {
    guard !changes.isEmpty else { return }
    var all = scope.routeScope
    all["contactIds"] = [id]
    var object: [String: JSONValue] = [:]
    for (key, value) in all { if let value, let json = jsonValue(value) { object[key] = json } }
    object["set"] = contactSetBody(changes)
    _ = try await api.request(CrmRoutes.contactUpdate, method: .post, body: .object(object))
    // The route wrote it, so a polling reader would show the old record for up to its interval; the SDK's listeners hear it.
    RestFirestoreReader.rereadNow()
  }

  func setContactStage(_ id: String, _ stage: String?) async throws {
    var object: [String: JSONValue] = ["orgId": .string(scope.orgID), "contactId": .string(id)]
    if let site = scope.createHostID { object["hostId"] = .string(site) }
    object["lifecycleStage"] = stage.map { .string($0) } ?? .null
    _ = try await api.request(CrmRoutes.contactStage, method: .post, body: .object(object))
  }

  func removeContact(_ id: String) async throws {
    _ = try await api.request(CrmRoutes.contactRemove, method: .post, body: body(["contactIds": [id]]))
  }

  func setLeadStatus(_ id: String, status: String, label: String, reason: String? = nil) async throws {
    var changes: [String: Any] = ["status": status, "statusLabel": label]
    if status == "unqualified" {
      let trimmed = reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      changes["unqualifiedReason"] = trimmed.isEmpty ? FirestoreSentinel.delete as Any : trimmed as Any
    }
    try await updateRecord(.lead, id, changes)
  }

  func convertLead(_ id: String, _ draft: ConvertDraft) async throws {
    var deal: [String: Any]?
    if let title = draft.dealTitle?.trimmingCharacters(in: .whitespaces), !title.isEmpty {
      deal = ["title": title, "currency": "usd"]
      if let amount = draft.dealAmountCents { deal?["amountCents"] = amount }
      if let stage = draft.dealStageID { deal?["stageId"] = stage }
    }
    let company = draft.createCompanyName?.trimmingCharacters(in: .whitespaces)
    _ = try await api.request(
      CrmRoutes.leadConvert, method: .post,
      body: body([
        "leadId": id, "ownerUid": draft.ownerUID, "companyId": draft.companyID,
        "createCompany": (company?.isEmpty == false ? ["name": company!] : nil) as [String: Any]?, "deal": deal,
      ]))
  }

  func deleteRecord(_ kind: CrmKind, _ id: String) async throws {
    try await reader.deleteDocument(path(kind, id))
  }

  func deleteCompany(_ id: String) async throws {
    _ = try await api.request(CrmRoutes.companyDelete, method: .post, body: body(["companyId": id]))
  }

  func moveDeal(_ id: String, stageID: String) async throws {
    _ = try await api.request(CrmRoutes.dealStage, method: .post, body: body(["dealId": id, "stageId": stageID]))
  }

  func closeDeal(_ id: String, won: Bool, lostReason: String? = nil) async throws {
    let reason = lostReason?.trimmingCharacters(in: .whitespacesAndNewlines)
    _ = try await api.request(
      CrmRoutes.dealStage, method: .post,
      body: body(["dealId": id, "status": won ? "won" : "lost", "lostReason": reason?.isEmpty == false ? reason : nil]))
  }

  func saveTask(_ taskID: String?, _ draft: TaskDraft) async throws {
    var task: [String: JSONValue] = [
      "title": .string(draft.title.trimmingCharacters(in: .whitespaces)), "kind": .string(draft.kind),
      "priority": .string(draft.priority), "notes": .string(draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)),
    ]
    task["dueAtMs"] = draft.dueAtMs.map { .number(Double($0)) } ?? .null
    task["assigneeUid"] = draft.assigneeUID.map { .string($0) } ?? .null
    task["contactId"] = draft.contactID.map { .string($0) } ?? .null
    task["companyId"] = draft.companyID.map { .string($0) } ?? .null
    task["dealId"] = draft.dealID.map { .string($0) } ?? .null
    var object: [String: JSONValue] = ["task": .object(task)]
    if scope.orgLevel {
      object["orgId"] = .string(scope.orgID)
      // A new task names the site it is filed from; with none it is the organization's own.
      if taskID == nil, let site = draft.sourceSite { object["hostId"] = .string(site) }
    } else {
      object["hostId"] = .string(scope.hostID)
    }
    if let taskID { object["taskId"] = .string(taskID) }
    _ = try await api.request(CrmRoutes.taskSave, method: .post, body: .object(object))
  }

  func completeTask(_ taskID: String) async throws {
    _ = try await api.request(CrmRoutes.taskComplete, method: .post, body: taskBody(["taskId": taskID]))
  }

  func reopenTask(_ task: CrmTask) async throws {
    try await reader.setDocument(
      crmPath(scope.orgID, "crmTasks") + [task.id],
      [
        "status": "open", "completedAtMs": FirestoreSentinel.delete, "completedByUid": FirestoreSentinel.delete,
        "updatedAt": FirestoreSentinel.serverTimestamp,
      ], merge: true)
    await refreshNextActivity(task)
  }

  func deleteTask(_ task: CrmTask) async throws {
    try await reader.deleteDocument(crmPath(scope.orgID, "crmTasks") + [task.id])
    await refreshNextActivity(task)
  }

  private func refreshNextActivity(_ task: CrmTask) async {
    var link: [String: Any] = [:]
    if let id = task.contactID { link["contactId"] = id }
    if let id = task.companyID { link["companyId"] = id }
    if let id = task.dealID { link["dealId"] = id }
    guard !link.isEmpty else { return }
    _ = try? await api.request(CrmRoutes.nextActivity, method: .post, body: taskBody(["links": [link]]))
  }

  func logActivity(
    kind: String, body text: String, links: [String: String], outcome: String? = nil, minutes: Int? = nil,
    direction: String? = nil
  ) async throws {
    var fields: [String: Any] = [
      "kind": kind, "body": text.trimmingCharacters(in: .whitespacesAndNewlines),
      "atMs": Int64(Date().timeIntervalSince1970 * 1000), "visibleTo": scope.createTokens, "hostId": stampedHost,
      "byUid": scope.uid, "createdAt": FirestoreSentinel.serverTimestamp, "updatedAt": FirestoreSentinel.serverTimestamp,
    ]
    for (key, value) in links { fields[key] = value }
    if let company = await activityCompany(links) { fields["companyId"] = company }
    if let outcome, !outcome.isEmpty { fields["outcome"] = outcome }
    if let minutes { fields["durationMinutes"] = minutes }
    if let direction, !direction.isEmpty { fields["direction"] = direction }
    try await reader.setDocument(crmPath(scope.orgID, "crmActivities") + [newRecordID()], fields, merge: true)
  }

  /// The company an activity rolls up to (`resolveCrmActivityCompany`), reading only what the links leave open. A read
  /// that fails costs the company's timeline this entry, never the entry itself.
  private func activityCompany(_ links: [String: String]) async -> String? {
    let named = links["companyId"]
    if let named, !named.isEmpty { return named }
    func read(_ collection: String, _ key: String) async -> [String: Any]? {
      guard let id = links[key], !id.isEmpty else { return nil }
      return (try? await reader.readOnce(crmPath(scope.orgID, collection) + [id]))?.data
    }
    let deal = await read("deals", "dealId")
    let dealCompany = crmActivityCompanyID(named: nil, deal: deal, contact: nil, groupID: nil, org: nil)
    if let dealCompany { return dealCompany }
    let contact = await read("contacts", "contactId")
    return crmActivityCompanyID(named: nil, deal: nil, contact: contact, groupID: scope.groupID, org: scope.org)
  }

  /// A deal's contact roles, as the console's card writes them (`dealContactRolesSave`): the whole list, its Primary as
  /// `contactId` with the name copied beside it, and the ids and keys a merge, an erasure and a rename find the deal by.
  func saveDealContactRoles(
    _ id: String, deal: [String: Any], _ next: [CrmContactRole], values: [(label: String, active: Bool)],
    primaryName: (String) -> String?
  ) async throws {
    let write: CrmDealRolesWrite
    switch dealContactRolesSave(deal, next, values) {
    case .failure(let refusal): throw ConsoleAPIError(status: 400, message: refusal.message)
    case .success(let judged): write = judged
    }
    let list = contactRoleListFields(write.contactRoles, visibleTo: deal["visibleTo"])
    var fields: [String: Any] = [
      "contactRoles": write.contactRoles.map(\.stored), "contactId": write.contactID ?? FirestoreSentinel.delete,
      "contactRoleContactIds": list.ids, "scopedContactRoleContactIds": list.scoped, "contactRoleKeys": list.keys,
      "updatedAt": FirestoreSentinel.serverTimestamp,
    ]
    if write.primaryChanged {
      fields["contactName"] = write.contactID.flatMap(primaryName).flatMap { $0.isEmpty ? nil : $0 } ?? FirestoreSentinel.delete
    }
    try await reader.setDocument(path(.deal, id), fields, merge: true)
  }

  /// A company's contact roles (`companyContactRolesSave`): the whole list, and the ids and keys a merge, an erasure
  /// and a rename find the company by.
  func saveCompanyContactRoles(
    _ id: String, company: [String: Any], _ next: [CrmContactRole], values: [(label: String, active: Bool)]
  ) async throws {
    let roles: [CrmContactRole]
    switch companyContactRolesSave(company, next, values) {
    case .failure(let refusal): throw ConsoleAPIError(status: 400, message: refusal.message)
    case .success(let judged): roles = judged
    }
    let list = contactRoleListFields(roles, visibleTo: nil)
    try await reader.setDocument(
      path(.company, id),
      [
        "contactRoles": roles.map(\.stored), "contactRoleContactIds": list.ids, "contactRoleKeys": list.keys,
        "updatedAt": FirestoreSentinel.serverTimestamp,
      ], merge: true)
  }

  func deleteActivity(_ id: String) async throws {
    try await reader.deleteDocument(crmPath(scope.orgID, "crmActivities") + [id])
  }

  func sendEmail(subject: String, message: String, links: [String: String]) async throws {
    var fields: [String: Any?] = ["subject": subject.trimmingCharacters(in: .whitespaces), "body": message.trimmingCharacters(in: .whitespacesAndNewlines)]
    for (key, value) in links { fields[key] = value }
    _ = try await api.request(CrmRoutes.emailSend, method: .post, body: body(fields))
  }

  func members() async -> [CrmMember] {
    guard let answer = try? await api.request(CrmRoutes.members, query: [("orgId", scope.orgID)]) else { return [] }
    return (answer["members"]?.arrayValue ?? []).compactMap { member in
      guard let uid = member["$id"]?.stringValue ?? member["uid"]?.stringValue else { return nil }
      let email = member["email"]?.stringValue
      let name = member["displayName"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
      return CrmMember(uid: uid, label: name ?? email ?? uid, email: email)
    }
  }
}
