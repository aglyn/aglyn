// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * EDITING A SITE'S FUNNELS, AS THE FUNNELS CARD DOES.
 *
 * Every change goes through the plugin's own console doors (`/api/funnels/...`),
 * which check the plan, the role and each step against the site's inventory.
 * The editor makes the same checks first (`normalizeFunnelDefinition`,
 * `stepInventoryProblem`, ported from the model and held to the console's
 * answers by the function cases) so a person is told before the round trip.
 * The Kotlin kit's `FunnelsEditing.kt` is the same contract.
 */

/// What a save or an activation answered: the funnel, and whether the site's recording switch moved.
struct FunnelSaved: Equatable, Sendable {
  var funnelID: String
  var recordingChanged: Bool
}

/// "Create with AI": a checked draft, and the steps it had to leave out.
struct FunnelProposal: Equatable, Sendable {
  var draft: FunnelDefinition
  var dropped: [String]
}

/// The automation "Act on this drop-off" drafted, switched off.
struct DropOffDrafted: Equatable, Sendable {
  var automationID: String
  var name: String
  var replayed: Bool
}

/// The plugin's console doors, behind a seam so the editor is tested without a server.
protocol FunnelsAPI: Sendable {
  func inventory() async throws -> FunnelInventory
  func result(funnelID: String, from: String, to: String, fresh: Bool) async throws -> FunnelResult
  func save(_ funnel: FunnelDefinition, funnelID: String?) async throws -> FunnelSaved
  func activate(_ funnelID: String) async throws -> FunnelSaved
  func delete(_ funnelID: String) async throws -> FunnelSaved
  func propose(_ brief: String) async throws -> FunnelProposal
  func draftDropOff(funnelID: String, step: Int, afterHours: Int, action: DropOffAction) async throws -> DropOffDrafted
  /// The published page reads the recording switch from the host document, so its cached pages are dropped.
  func announceSiteWide() async
}

struct ConsoleFunnelsAPI: FunnelsAPI {
  let api: ConsoleAPIClient
  let reader: FirestoreReader
  let hostID: String

  private func post(_ door: String, _ fields: [String: Any?] = [:]) async throws -> [String: JSONValue] {
    var body = fields
    body["hostId"] = hostID
    guard case .object(let answer)? = try await api.request("/api/funnels/\(door)", method: .post, body: jsonBody(body))
    else { throw ConsoleAPIError(status: 0, message: "Something went wrong. Try again.") }
    return answer
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: JSONValue?) throws -> T {
    guard let value else { throw ConsoleAPIError(status: 0, message: "Something went wrong. Try again.") }
    return try JSONDecoder().decode(type, from: try value.encoded())
  }

  func inventory() async throws -> FunnelInventory {
    try decode(FunnelInventory.self, try await post("inventory")["inventory"])
  }

  func result(funnelID: String, from: String, to: String, fresh: Bool) async throws -> FunnelResult {
    try decode(
      FunnelResult.self,
      try await post("results", ["funnelId": funnelID, "from": from, "to": to, "fresh": fresh])["result"])
  }

  func save(_ funnel: FunnelDefinition, funnelID: String?) async throws -> FunnelSaved {
    let definition = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(funnel))
    let answer = try await post("save", ["funnel": definition, "funnelId": funnelID])
    return FunnelSaved(funnelID: answer["funnelId"]?.stringValue ?? funnelID ?? "", recordingChanged: answer["recordingChanged"]?.boolValue == true)
  }

  func activate(_ funnelID: String) async throws -> FunnelSaved {
    let answer = try await post("activate", ["funnelId": funnelID])
    return FunnelSaved(funnelID: funnelID, recordingChanged: answer["recordingChanged"]?.boolValue == true)
  }

  func delete(_ funnelID: String) async throws -> FunnelSaved {
    let answer = try await post("delete", ["funnelId": funnelID])
    return FunnelSaved(funnelID: funnelID, recordingChanged: answer["recordingChanged"]?.boolValue == true)
  }

  func propose(_ brief: String) async throws -> FunnelProposal {
    let answer = try await post("propose", ["brief": brief])
    var dropped: [String] = []
    if case .array(let values)? = answer["dropped"] { dropped = values.compactMap(\.stringValue) }
    return FunnelProposal(draft: try decode(FunnelDefinition.self, answer["draft"]), dropped: dropped)
  }

  func draftDropOff(funnelID: String, step: Int, afterHours: Int, action: DropOffAction) async throws -> DropOffDrafted {
    let answer = try await post(
      "act", ["funnelId": funnelID, "step": step, "afterHours": afterHours, "action": action.rawValue])
    return DropOffDrafted(
      automationID: answer["automationId"]?.stringValue ?? "", name: answer["name"]?.stringValue ?? "",
      replayed: answer["replayed"]?.boolValue == true)
  }

  func announceSiteWide() async {
    await publishSiteWideChange(api: api, reader: reader, hostID: hostID)
  }
}

/// One step as the editor holds it: what is typed, before any check.
struct StepDraft: Equatable {
  var type: SiteJourneyStepType = .page
  var key = ""
  var match: FunnelPageMatch = .exact
  var label = ""

  var input: FunnelStepInput { FunnelStepInput(type: type.rawValue, key: key, match: match.rawValue, label: label) }

  init(type: SiteJourneyStepType = .page, key: String = "", match: FunnelPageMatch = .exact, label: String = "") {
    self.type = type
    self.key = key
    self.match = match
    self.label = label
  }

  init(_ step: FunnelStep) {
    self.init(type: step.type, key: step.key, match: step.match ?? .exact, label: step.label ?? "")
  }
}

/// The funnel editor's draft: a name and its steps. `id` is nil for a new funnel.
struct FunnelDraft: Equatable {
  var id: String?
  var name = ""
  var steps: [StepDraft] = []

  init() {}

  init(_ row: FunnelRow) {
    id = row.id
    name = row.name
    steps = row.steps.map(StepDraft.init)
  }

  init(_ definition: FunnelDefinition) {
    name = definition.name
    steps = definition.steps.map(StepDraft.init)
  }
}

/// What a new step starts on, as the console editor's `blankStep` does: the
/// site's first page for a page step, the email open for an email step, and
/// "any" of the kind for the rest.
func starterStep(_ type: SiteJourneyStepType, _ inventory: FunnelInventory?) -> StepDraft {
  switch type {
  case .page: StepDraft(type: type, key: inventory?.pages.first ?? "/")
  case .email: StepDraft(type: type, key: "opened")
  default: StepDraft(type: type)
  }
}

/// "Act on this drop-off" asked of the step people reached (1-based), by name.
struct DropOffRequest: Equatable {
  var funnelID: String
  var reachedStep: Int
  var stepLabel: String
  var nextStepLabel: String
}

/// How many drop-off waits the card offers, from the contracts.
func dropOffWaits() -> [Int] { ContractValues.shared.dropOffWaitHours.map { Int($0) } }

/// The Funnels screen's state for one site: the editor, the row actions and the dialogs.
@MainActor
@Observable
final class FunnelsEditor {
  var draft: FunnelDraft?
  private(set) var inventory: FunnelInventory?
  var deleting: FunnelRow?
  var proposing = false
  var dropOff: DropOffRequest?
  private(set) var busy = false
  private(set) var error: String?
  /// What just happened, or what the person can open next.
  var notice: String?
  /// Bumped when a result should be read again.
  private(set) var refreshKey = 0

  var fresh: Bool { refreshKey > 0 }

  @ObservationIgnored private let api: FunnelsAPI

  init(api: FunnelsAPI) { self.api = api }

  func refresh() { refreshKey += 1 }

  /// Loads the site's inventory once; the editor opens when it is in hand.
  private func loadedInventory() async throws -> FunnelInventory {
    if let inventory { return inventory }
    let loaded = try await api.inventory()
    inventory = loaded
    return loaded
  }

  func add() async { await open(FunnelDraft()) }
  func edit(_ row: FunnelRow) async { await open(FunnelDraft(row)) }

  private func open(_ next: FunnelDraft) async {
    error = nil
    await run {
      let known = try await self.loadedInventory()
      var opened = next
      if opened.id == nil, opened.steps.isEmpty {
        opened.steps = [starterStep(.page, known), starterStep(.form, known)]
      }
      self.draft = opened
    }
  }

  func askDelete(_ row: FunnelRow) {
    error = nil
    deleting = row
  }

  func askPropose() {
    error = nil
    proposing = true
  }

  func askDropOff(_ request: DropOffRequest) {
    error = nil
    dropOff = request
  }

  func close() {
    guard !busy else { return }
    draft = nil
    deleting = nil
    proposing = false
    dropOff = nil
    error = nil
  }

  /// The save the card makes: the console's own checks first, then the door's.
  func save() async {
    guard let asked = draft else { return }
    await run {
      let check = normalizeFunnelDefinition(name: asked.name, steps: asked.steps.map(\.input))
      guard let funnel = check.funnel else {
        self.error = check.error
        return
      }
      let known = try await self.loadedInventory()
      for (index, step) in funnel.steps.enumerated() {
        if let problem = stepInventoryProblem(step, known) {
          self.error = "Step \(index + 1): \(problem)"
          return
        }
      }
      var labelled = funnel
      labelled.steps = funnel.steps.map { labelStepFromInventory($0, known) }
      let saved = try await self.api.save(labelled, funnelID: asked.id)
      if saved.recordingChanged { await self.api.announceSiteWide() }
      self.draft = nil
      self.notice = "\(labelled.name) saved."
      self.refreshKey = 0
    }
  }

  func activate(_ row: FunnelRow) async {
    await run {
      let activated = try await self.api.activate(row.id)
      if activated.recordingChanged { await self.api.announceSiteWide() }
      self.notice = "\(row.name) is live. It is measured from now on."
    }
  }

  func confirmDelete() async {
    guard let row = deleting else { return }
    await run {
      let deleted = try await self.api.delete(row.id)
      if deleted.recordingChanged { await self.api.announceSiteWide() }
      self.deleting = nil
      self.notice = "\(row.name) and its results are removed."
    }
  }

  func propose(_ brief: String) async {
    if brief.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      error = "Describe the funnel first."
      return
    }
    await run {
      let proposal = try await self.api.propose(brief.trimmingCharacters(in: .whitespacesAndNewlines))
      _ = try await self.loadedInventory()
      self.proposing = false
      self.draft = FunnelDraft(proposal.draft)
      self.notice = proposal.dropped.isEmpty
        ? nil : "Left out, because the site has no match: \(proposal.dropped.joined(separator: "; "))"
    }
  }

  func draftDropOff(afterHours: Int, action: DropOffAction) async {
    guard let request = dropOff else { return }
    await run {
      let drafted = try await self.api.draftDropOff(
        funnelID: request.funnelID, step: request.reachedStep, afterHours: afterHours, action: action)
      self.dropOff = nil
      self.notice = "\(drafted.name) is drafted, switched off. Switch it on under Automation when it reads right."
    }
  }

  /// The result the detail shows, read through the same door as the card.
  func result(for row: FunnelRow, days: Int, nowMs: Int) async throws -> FunnelResult {
    let range = recentRange(days: days, nowMs: nowMs)
    return try await api.result(funnelID: row.id, from: range.from, to: range.to, fresh: fresh)
  }

  private func run(_ block: @escaping @MainActor () async throws -> Void) async {
    guard !busy else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await block()
    } catch let failure as ConsoleAPIError where failure.status != 0 {
      error = failure.message
    } catch {
      self.error = "That did not go through. Check the connection and try again."
    }
  }
}
