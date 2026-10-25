// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The screen Create with AI opens: the brief, then the job it started, followed live.
public let aiCreateScreen = "ai.create"

/// How often a moving job is read again; the console follows the job's event stream, which the apps poll instead.
public let aiCreatePollNanoseconds: UInt64 = 2_500_000_000

/// How long a list's door answer is reused before it is asked again.
private let aiCreateDoorSeconds: TimeInterval = 30

/// The lists Create with AI sits on, beside their own create action, and the zone each hosts (the console's names).
public enum AiCreateKind: String, CaseIterable, Sendable {
  case page, template, layout, form, component

  /// The list's zone the entry is drawn in.
  public var slot: String {
    switch self {
    case .page: ListCreateZone.pages
    case .template: ListCreateZone.templates
    case .layout: ListCreateZone.layouts
    case .form: ListCreateZone.forms
    case .component: ListCreateZone.components
    }
  }

  /// The entry's widget id, as plugins.config.json declares it.
  public var widgetID: String { "ai.create-\(rawValue)" }
}

// MARK: - What the door and the follow view answer

/// `/api/ai/create`: whether a list draws Create with AI, as what, and every word its brief says.
struct AiCreateDoor: Decodable, Equatable {
  struct Copy: Decodable, Equatable {
    let title: String
    let briefLabel: String
    let placeholder: String
    let next: String
    let submit: String
    let started: String
    let failed: String
  }

  struct Option: Decodable, Equatable, Identifiable {
    let id: String
    let label: String
  }

  struct Choice: Decodable, Equatable, Identifiable {
    let key: String
    let label: String
    let required: Bool
    let options: [Option]
    var id: String { key }
  }

  struct CollectionOption: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
  }

  struct Collections: Decodable, Equatable {
    let when: String
    let label: String
    let options: [CollectionOption]
    let helper: String
  }

  struct Credits: Decodable, Equatable {
    let text: String
    let exhausted: Bool
  }

  struct Upsell: Decodable, Equatable {
    let title: String
    let does: String
    let offer: String
    let canManageBilling: Bool
    let action: String?
    let dismiss: String
  }

  let kind: String
  let door: String
  let label: String
  let copy: Copy?
  let briefMaxChars: Int
  let choices: [Choice]
  let collections: Collections?
  let credits: Credits?
  let building: String?
  let upsell: Upsell?

  var drawn: Bool { door == "create" || door == "upsell" }
}

/// `/api/ai/create/:jobId`: the job as the console's follow card reads it.
struct AiFollowView: Decodable, Equatable {
  struct Line: Decodable, Equatable {
    let tone: String
    let text: String
  }

  struct Plan: Decodable, Equatable {
    let heading: String
    let lines: [String]
  }

  struct Confirm: Decodable, Equatable {
    let label: String
    let enabled: Bool
  }

  struct Open: Decodable, Equatable {
    let label: String
    let detail: String
    let besigner: String?
  }

  let id: String
  let kind: String
  let status: String
  let hostId: String?
  let phase: String
  let phaseLabel: String
  let line: Line
  let moving: Bool
  let settled: Bool
  let steps: String?
  let plan: Plan?
  let findings: [String]
  let detail: String?
  let estimate: String?
  let retryRefusal: String?
  let confirm: Confirm?
  let building: String?
  let problem: String?
  let spent: String?
  let open: Open?

  var tone: AglynTone {
    switch line.tone {
    case "success": .success
    case "warning": .warning
    case "error": .error
    default: .info
    }
  }
}

struct AiFollowAnswer: Decodable {
  let view: AiFollowView
}

// MARK: - The request the brief sends

/// The job's `inputs` for what was picked, or nil while a required pick is missing (the console's `aiBriefJobInputs`): a
/// page's optional type, a template's required subject and, for a collection entry's page, its collection.
func aiCreateInputs(_ door: AiCreateDoor, picks: [String: String], collectionID: String?) -> [String: JSONValue]? {
  var inputs: [String: JSONValue] = [:]
  for choice in door.choices {
    if let picked = picks[choice.key], choice.options.contains(where: { $0.id == picked }) {
      inputs[choice.key] = .string(picked)
    } else if choice.required {
      return nil
    }
  }
  if let collections = door.collections, picks["subject"] == collections.when {
    guard let collectionID, collections.options.contains(where: { $0.id == collectionID }) else { return nil }
    inputs["collectionId"] = .string(collectionID)
  }
  return inputs
}

/// The body `POST /api/ai/jobs` takes, as the console's dialog sends it.
func aiCreateJobBody(orgID: String, hostID: String, kind: AiCreateKind, brief: String, inputs: [String: JSONValue]) -> JSONValue {
  .object([
    "orgId": .string(orgID), "hostId": .string(hostID), "kind": .string(kind.rawValue),
    "brief": .string(brief.trimmingCharacters(in: .whitespacesAndNewlines)), "inputs": .object(inputs),
  ])
}

/// The brief as the box keeps it: never past the door's limit.
func aiCreateClamped(_ brief: String, max: Int) -> String {
  brief.count > max ? String(brief.prefix(max)) : brief
}

/// Whether a refusal is the month's credits running out (the jobs ladder's `reason: quota`, a 402 or a 429).
func aiCreateOutOfCredits(_ error: Error) -> Bool {
  guard let failure = error as? ConsoleAPIError, failure.status == 402 || failure.status == 429 else { return false }
  if case .object(let body)? = failure.body, case .string(let reason)? = body["reason"] { return reason == "quota" }
  return failure.status == 402
}

// MARK: - The door, read once per list

/// The door answers lists read, kept briefly so a list's header and its empty state ask once.
@MainActor
final class AiCreateDoors {
  static let shared = AiCreateDoors()
  private var answers: [String: (at: Date, door: AiCreateDoor)] = [:]

  func door(_ context: NativePluginContext, kind: AiCreateKind, fresh: Bool = false) async throws -> AiCreateDoor? {
    guard let orgID = context.orgID, let hostID = context.hostID else { return nil }
    let key = "\(orgID)/\(hostID)/\(kind.rawValue)"
    if !fresh, let kept = answers[key], Date().timeIntervalSince(kept.at) < aiCreateDoorSeconds { return kept.door }
    let door = try await context.api.request(
      AiCreateDoor.self, "/api/ai/create", query: [("orgId", orgID), ("hostId", hostID), ("kind", kind.rawValue)])
    answers[key] = (Date(), door)
    return door
  }
}

// MARK: - The entry beside a list's create action

/// "Create with AI" in a list's zone (the console's `ai-describe-*` widgets): drawn where the door says, opening the
/// brief, or the add-on's offer on a plan that could buy it. An icon in a list's header, a button in its empty state.
struct AiCreateButton: View {
  let context: NativePluginContext
  let kind: AiCreateKind
  @Environment(\.slotPlacement) private var placement
  @State private var door: AiCreateDoor?

  private var key: String { "\(context.orgID ?? "")/\(context.hostID ?? "")/\(kind.rawValue)" }

  var body: some View {
    entry
      .task(id: key) {
        door = nil
        door = try? await AiCreateDoors.shared.door(context, kind: kind)
      }
  }

  @ViewBuilder
  private var entry: some View {
    if let door, door.drawn {
      let button = Button {
        context.navigate(aiCreateScreen, ["kind": kind.rawValue])
      } label: {
        Label(door.label, systemImage: "sparkles")
      }
      .accessibilityIdentifier("ai-create-\(kind.rawValue)")
      if placement == .header {
        button.help(door.label)
      } else {
        button.buttonStyle(.aglynSecondary)
      }
    } else {
      // Holds the read while the door is asked, and draws nothing where it says no.
      Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
  }
}

// MARK: - The brief, then the job

/// Create with AI (the console's brief dialog and its follow card, AGL-2907, AGL-3593): one question and its box, the
/// kind's chips, the month's credits, then the job it started — planning, the plan with its estimated cost and Confirm,
/// building, and the draft to open, in its native page or in the Besigner. Starting, confirming and canceling are the
/// console's own requests. Leaving stops following; the job carries on in AI jobs.
struct AiCreateScreen: View {
  let context: NativePluginContext
  let kind: AiCreateKind?
  let initialJobID: String?
  /// The brief already written where the flow was started (Home's prompt line).
  var initialBrief: String? = nil

  private enum Load: Equatable {
    case loading
    case failed(String)
    case ready(AiCreateDoor)
  }

  @State private var load = Load.loading
  @State private var brief = ""
  @State private var picks: [String: String] = [:]
  @State private var collectionID: String?
  @State private var busy = false
  @State private var notice: String?
  @State private var outOfCredits = false
  @State private var jobID: String?
  @State private var view: AiFollowView?
  @State private var following: Task<Void, Never>?

  private var door: AiCreateDoor? {
    if case .ready(let door) = load { return door }
    return nil
  }

  var body: some View {
    Form {
      if let jobID {
        followSections(jobID)
      } else {
        switch load {
        case .loading:
          Section { ProgressView().frame(maxWidth: .infinity) }
        case .failed(let message):
          Section {
            AglynNotice(message, tone: .error)
            Button("Try again") { Task { await loadDoor(fresh: true) } }
          }
        case .ready(let door):
          if door.door == "upsell", let upsell = door.upsell {
            upsellSections(upsell)
          } else if door.door == "create", let copy = door.copy {
            briefSections(door, copy: copy)
          } else {
            Section {
              AglynEmptyState(
                "Create with AI is not available here", systemImage: "sparkles",
                message: "Your role, your plan or this site’s settings do not include it.")
            }
          }
        }
      }
    }
    .formStyle(.grouped)
    .aglynFormBackground()
    .navigationTitle(title)
    .aglynScreenTitle(title)
    .task {
      if let initialJobID, jobID == nil {
        jobID = initialJobID
        follow(initialJobID)
      } else if jobID == nil {
        if brief.isEmpty, let initialBrief { brief = initialBrief }
        await loadDoor(fresh: false)
      }
    }
    .onDisappear { following?.cancel() }
    .accessibilityIdentifier("ai-create")
  }

  private var title: String {
    if jobID != nil { return door?.copy?.title ?? "AI job" }
    if let door, door.door == "upsell" { return door.upsell?.title ?? door.label }
    return door?.copy?.title ?? "Create with AI"
  }

  // MARK: The brief

  @ViewBuilder
  private func briefSections(_ door: AiCreateDoor, copy: AiCreateDoor.Copy) -> some View {
    if let credits = door.credits {
      Section {
        AglynNotice(credits.text, tone: credits.exhausted ? .warning : .info)
        if credits.exhausted { creditActions }
      }
    }
    Section {
      TextField(copy.briefLabel, text: $brief, prompt: Text(copy.placeholder), axis: .vertical)
        .lineLimit(4...12)
        .disabled(busy)
        .onChange(of: brief) { _, text in
          let clamped = aiCreateClamped(text, max: door.briefMaxChars)
          if clamped != text { brief = clamped }
        }
        .accessibilityIdentifier("ai-create-brief")
    } header: {
      Text(copy.briefLabel)
    } footer: {
      Text("\(brief.count.formatted()) / \(door.briefMaxChars.formatted())").monospacedDigit()
    }
    ForEach(door.choices) { choice in
      Section(choice.label) {
        AglynWrapRow {
          ForEach(choice.options) { option in
            AglynChoiceChip(option.label, selected: picks[choice.key] == option.id) {
              if picks[choice.key] == option.id {
                // An optional pick clears when pressed again; a required one stays.
                if !choice.required { picks[choice.key] = nil }
              } else {
                picks[choice.key] = option.id
              }
            }
            .disabled(busy)
            .accessibilityIdentifier("ai-create-\(choice.key)-\(option.id)")
          }
        }
      }
    }
    if let collections = door.collections, picks["subject"] == collections.when {
      Section {
        Picker(collections.label, selection: $collectionID) {
          Text("Pick a collection").tag(String?.none)
          ForEach(collections.options) { option in Text(option.name).tag(Optional(option.id)) }
        }
        .disabled(busy || collections.options.isEmpty)
        .accessibilityIdentifier("ai-create-collection")
      } footer: {
        Text(collections.helper)
      }
    }
    Section {
      Text(copy.next).font(AglynFont.subheadline).foregroundStyle(.secondary)
      if let building = door.building { AglynNotice(building, tone: .info) }
      if let notice {
        AglynNotice(notice, tone: .warning)
        // Where more credits come from, unless the credits line above already offers it.
        if outOfCredits && door.credits?.exhausted != true { creditActions }
      }
      Button {
        start(door, copy: copy)
      } label: {
        HStack {
          Text(copy.submit)
          if busy { ProgressView().controlSize(.small) }
        }
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(.aglynProminent)
      .disabled(
        busy || brief.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          || aiCreateInputs(door, picks: picks, collectionID: collectionID) == nil
      )
      .accessibilityIdentifier("ai-create-submit")
    }
  }

  /// Where more credits come from: the workspace's AI credits, and its plans in Billing.
  @ViewBuilder
  private var creditActions: some View {
    HStack {
      Button("AI credits") { context.navigate("ai.credits") }
        .accessibilityIdentifier("ai-create-credits")
      Button("Plans and billing") { context.navigate("core.billing.plans") }
        .accessibilityIdentifier("ai-create-billing")
    }
    .buttonStyle(.aglynSecondary)
  }

  // MARK: The add-on's offer

  @ViewBuilder
  private func upsellSections(_ upsell: AiCreateDoor.Upsell) -> some View {
    // The console's AiUpsellDialog as the add-on's promo card (Figma Promo/Add-on card): its title, what the entry does,
    // the offer sentence, then Not now (Close for a member who cannot buy it) and the add-on's action.
    Section {
      AglynAddOnPromoCard(
        upsell.title, does: upsell.does, offer: upsell.offer, dismissTitle: upsell.dismiss, actionTitle: upsell.action,
        dismiss: { context.back() }, action: { context.navigate("core.billing.addons") }
      )
      .frame(maxWidth: .infinity)
      .listRowInsets(EdgeInsets())
      .listRowBackground(Color.clear)
    }
  }

  // MARK: The job

  @ViewBuilder
  private func followSections(_ jobID: String) -> some View {
    if let copy = door?.copy {
      Section { Text(copy.started).font(AglynFont.subheadline).foregroundStyle(.secondary) }
    }
    if let view {
      Section {
        HStack(spacing: AglynSpace.one) {
          if view.moving { ProgressView().controlSize(.small) }
          StatusChip(view.phaseLabel, tone: view.tone)
          if let steps = view.steps { Text(steps).font(AglynFont.caption).foregroundStyle(.secondary) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("ai-create-phase")
        AglynNotice(view.line.text, tone: view.tone)
        if let spent = view.spent { Text(spent).font(AglynFont.caption).foregroundStyle(.secondary) }
      }
      if let open = view.open {
        Section {
          Button {
            context.openLink(open.detail)
          } label: {
            Label(open.label, systemImage: "arrow.right.circle").frame(maxWidth: .infinity)
          }
          .buttonStyle(.aglynProminent)
          .accessibilityIdentifier("ai-create-open")
          if let besigner = open.besigner {
            Button {
              context.openBesigner(besigner, scope: .absolute)
            } label: {
              Label("Edit in the Besigner", systemImage: "wand.and.stars")
            }
            .accessibilityIdentifier("ai-create-besigner")
          }
        }
      }
      if let plan = view.plan {
        Section(plan.heading) {
          ForEach(Array(plan.lines.enumerated()), id: \.offset) { _, line in Text(line).font(AglynFont.subheadline) }
          if let estimate = view.estimate { Text(estimate).font(AglynFont.caption).foregroundStyle(.secondary) }
        }
      }
      if !view.findings.isEmpty || view.detail != nil {
        Section("Building rules broken") {
          ForEach(Array(view.findings.enumerated()), id: \.offset) { _, finding in Text(finding).font(AglynFont.caption) }
          if let detail = view.detail { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
        }
      }
      if view.confirm != nil || !view.settled {
        Section {
          if let retryRefusal = view.retryRefusal { Text(retryRefusal).font(AglynFont.caption).foregroundStyle(.secondary) }
          if let building = view.building { AglynNotice(building, tone: .info) }
          if let notice { AglynNotice(notice, tone: .warning) }
          if let confirm = view.confirm {
            Button(confirm.label) { decide(jobID, cancel: false) }
              .buttonStyle(.aglynProminent)
              .disabled(busy || !confirm.enabled)
              .accessibilityIdentifier("ai-create-confirm")
          }
          if !view.settled {
            Button("Cancel job", role: .destructive) { decide(jobID, cancel: true) }
              .disabled(busy)
              .accessibilityIdentifier("ai-create-cancel")
          }
        }
      }
    } else if let notice {
      Section { AglynNotice(notice, tone: .warning) }
    } else {
      Section { ProgressView().frame(maxWidth: .infinity) }
    }
    Section {
      Button("Open AI jobs") { context.navigate("ai.job", ["jobId": jobID]) }
        .accessibilityIdentifier("ai-create-jobs")
    }
  }

  // MARK: Requests

  private func loadDoor(fresh: Bool) async {
    guard let kind else {
      load = .failed("Create with AI needs a list to create into.")
      return
    }
    do {
      if let door = try await AiCreateDoors.shared.door(context, kind: kind, fresh: fresh) {
        load = .ready(door)
      } else {
        load = .failed("Pick a site first.")
      }
    } catch is CancellationError {
    } catch {
      load = .failed((error as? ConsoleAPIError)?.message ?? "Create with AI could not be loaded. Try again.")
    }
  }

  private func start(_ door: AiCreateDoor, copy: AiCreateDoor.Copy) {
    guard let kind, let orgID = context.orgID, let hostID = context.hostID,
      let inputs = aiCreateInputs(door, picks: picks, collectionID: collectionID)
    else { return }
    busy = true
    notice = nil
    outOfCredits = false
    Task {
      defer { busy = false }
      do {
        let answer = try await context.api.request(
          "/api/ai/jobs", method: .post,
          body: aiCreateJobBody(orgID: orgID, hostID: hostID, kind: kind, brief: brief, inputs: inputs))
        guard case .object(let job)? = answer?["job"], case .string(let id)? = job["id"] else {
          notice = copy.failed
          return
        }
        brief = ""
        picks = [:]
        collectionID = nil
        jobID = id
        follow(id)
      } catch is CancellationError {
      } catch {
        outOfCredits = aiCreateOutOfCredits(error)
        notice = (error as? ConsoleAPIError)?.message ?? copy.failed
      }
    }
  }

  /// Reads the job now, then again on a short beat while it moves.
  private func follow(_ id: String) {
    following?.cancel()
    following = Task {
      while !Task.isCancelled {
        if let next = await read(id) {
          view = next
          if !next.moving { return }
        }
        try? await Task.sleep(nanoseconds: aiCreatePollNanoseconds)
      }
    }
  }

  private func read(_ id: String) async -> AiFollowView? {
    guard let orgID = context.orgID else { return nil }
    do {
      let answer = try await context.api.request(
        AiFollowAnswer.self, "/api/ai/create/\(id)", query: [("orgId", orgID)])
      return answer.view
    } catch is CancellationError {
      return nil
    } catch {
      if view == nil { notice = (error as? ConsoleAPIError)?.message ?? "The job could not be read. Try again." }
      return nil
    }
  }

  /// Confirm the plan (or try a refused step again), or cancel: the same requests the console's follow card sends.
  private func decide(_ id: String, cancel: Bool) {
    guard let orgID = context.orgID else { return }
    busy = true
    notice = nil
    Task {
      defer { busy = false }
      do {
        var body: [String: JSONValue] = ["orgId": .string(orgID)]
        if !cancel, let hostID = view?.hostId ?? context.hostID { body["hostId"] = .string(hostID) }
        try await context.api.request(
          "/api/ai/jobs/\(id)/\(cancel ? "cancel" : "resume")", method: .post, body: .object(body))
      } catch is CancellationError {
        return
      } catch {
        notice = (error as? ConsoleAPIError)?.message ?? (cancel ? "The job could not be canceled — try again." : "The job could not be resumed — try again.")
      }
      follow(id)
    }
  }
}
