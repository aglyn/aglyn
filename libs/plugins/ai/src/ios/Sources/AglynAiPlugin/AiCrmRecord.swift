// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// The AI summary on a CRM record's page (AGL-2917), the console's `AiCrmRecordCard` and `useAiCrmAnswer`: a short summary
// of the record and a suggested next step, from its timeline, by a `crm` job through the console's own door
// (`POST /api/ai/jobs`), the answer read back through `/api/ai/crm/{jobId}`, which asks the CRM again whether this member may
// read it. Nothing is saved: "Create task" opens the record's task editor filled in, "Move to" asks before the deal moves.

/// The CRM record kinds an AI summary is written for (`AI_CRM_RECORD_KINDS`).
let aiCrmRecordKinds = ["contact", "company", "deal", "lead"]

let aiCrmLoadFailedCopy = "AI suggestions could not be loaded."
let aiCrmStartFailedCopy = "AI could not be started. Try again."
let aiCrmAnswerGoneCopy = "This suggestion is no longer available. Ask again."

/// A suggested next step (`AiCrmNextStep`).
struct AiCrmNextStep: Equatable {
  let title: String
  let kind: String
  let priority: String
  let dueInDays: Int
  let reason: String
}

/// A record's summary (`AiCrmRecordProposal`).
struct AiCrmRecordProposal: Equatable {
  let summary: String
  let standing: String?
  let asOf: String
  let nextStep: AiCrmNextStep?
  let stage: (id: String, reason: String)?

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.summary == rhs.summary && lhs.standing == rhs.standing && lhs.asOf == rhs.asOf && lhs.nextStep == rhs.nextStep
      && lhs.stage?.id == rhs.stage?.id && lhs.stage?.reason == rhs.stage?.reason
  }

  /// `readAiCrmProposal` for a `record` answer: nil for any other shape.
  init?(_ raw: JSONValue?) {
    guard raw?["kind"]?.stringValue == "record", let record = raw?["record"], aiCrmRecordKinds.contains(record["kind"]?.stringValue ?? ""),
      record["id"]?.stringValue != nil, let summary = raw?["summary"]?.stringValue
    else { return nil }
    self.summary = summary
    standing = raw?["standing"]?.stringValue
    asOf = raw?["asOf"]?.stringValue ?? ""
    if let step = raw?["nextStep"], let title = step["title"]?.stringValue {
      var due = 0
      if case .number(let days)? = step["dueInDays"] { due = Int(days) }
      nextStep = AiCrmNextStep(
        title: title, kind: step["kind"]?.stringValue ?? "todo", priority: step["priority"]?.stringValue ?? "normal", dueInDays: due,
        reason: step["reason"]?.stringValue ?? "")
    } else {
      nextStep = nil
    }
    if let stage = raw?["stage"], let id = stage["stageId"]?.stringValue {
      self.stage = (id, stage["reason"]?.stringValue ?? "")
    } else {
      stage = nil
    }
  }
}

/// Whether a `crm` job answers a summary of this record (`aiCrmJobAnswers`).
func aiCrmJobAnswersRecord(_ job: JSONValue?, kind: String, id: String) -> Bool {
  guard job?["kind"]?.stringValue == "crm" else { return false }
  return (job?["outputs"]?.arrayValue ?? []).contains { output in
    output["resource"]?.stringValue == "crm" && output["proposal"]?["kind"]?.stringValue == "record"
      && output["proposal"]?["record"]?["kind"]?.stringValue == kind && output["proposal"]?["record"]?["id"]?.stringValue == id
  }
}

/// When a step is due, in words (`aiCrmDueWords`).
func aiCrmDueWords(_ dueInDays: Int) -> String {
  if dueInDays <= 0 { return "due today" }
  if dueInDays == 1 { return "due tomorrow" }
  return "due in \(dueInDays) days"
}

/// A task kind as a person reads it (`TASK_KIND_WORDS`).
func aiCrmTaskKindWords(_ kind: String) -> String {
  ["call": "Call", "email": "Email", "meeting": "Meeting", "todo": "To-do"][kind] ?? kind
}

/// The suggested next step in one line, as the card says it.
func aiCrmNextStepLine(_ step: AiCrmNextStep) -> String {
  "\(step.title) (\(aiCrmTaskKindWords(step.kind)), \(step.priority) priority, \(aiCrmDueWords(step.dueInDays)))"
}

/// The AI summary card in a CRM record's `recordInsights` zone.
struct AiCrmRecordCard: View {
  let context: NativePluginContext
  @Environment(\.recordInsightsZone) private var zone
  @State private var verdict = "checking"
  @State private var job: JSONValue?
  @State private var proposal: AiCrmRecordProposal?
  @State private var jobID = ""
  @State private var notice: String?
  @State private var busy = false
  @State private var watching: Task<Void, Never>?

  private var kind: String? { zone.flatMap { aiCrmRecordKinds.contains($0.recordKind) ? $0.recordKind : nil } }
  private var orgID: String? { zone?.orgID ?? context.orgID }

  var body: some View {
    Group {
      if let zone, let kind, verdict == "ready" { content(zone, kind) }
    }
    .task(id: "\(zone?.recordKind ?? "")/\(zone?.recordID ?? "")/\(orgID ?? "")") { await load() }
    .onDisappear { watching?.cancel() }
  }

  @ViewBuilder
  private func content(_ zone: RecordInsightsZone, _ kind: String) -> some View {
    let running = job != nil && !aiJobIsTerminal(job)
    VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      Text("AI summary").font(AglynFont.strongSubheadline).accessibilityAddTraits(.isHeader)
      if let proposal {
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Text(proposal.summary)
          if let standing = proposal.standing { Text(standing).foregroundStyle(.secondary) }
          Text("Written from the timeline on \(proposal.asOf).").font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if let step = proposal.nextStep, let proposeTask = zone.proposeTask {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text("Suggested next step").font(AglynFont.caption).foregroundStyle(.secondary)
            Text(aiCrmNextStepLine(step))
            Text(step.reason).font(AglynFont.caption).foregroundStyle(.secondary)
            Button("Create task") {
              proposeTask(
                ProposedTask(title: step.title, notes: step.reason, kind: step.kind, priority: step.priority, dueInDays: step.dueInDays),
                jobID)
            }
            .buttonStyle(.aglynProminent)
            .accessibilityIdentifier("ai-crm-create-task")
          }
        }
        if let stage = proposal.stage, let proposeStage = zone.proposeStage, stage.id != zone.stageID,
          let offered = zone.stages?.first(where: { $0.id == stage.id })
        {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text("Suggested stage").font(AglynFont.caption).foregroundStyle(.secondary)
            Text(offered.name)
            Text(stage.reason).font(AglynFont.caption).foregroundStyle(.secondary)
            Button("Move to \(offered.name)") { proposeStage(offered.id, jobID) }.buttonStyle(.aglynSecondary)
          }
        }
      }
      HStack(spacing: AglynSpace.one) {
        Button(proposal == nil ? "Summarize this \(kind)" : "Summarize again") { ask(zone, kind) }
          .buttonStyle(.aglynSecondary)
          .disabled(busy || running || orgID == nil)
          .accessibilityIdentifier("ai-crm-summarize")
        if busy || running { ProgressView().controlSize(.small).accessibilityLabel("Summarizing") }
      }
      if let notice { AglynNotice(notice, tone: .warning) }
      if proposal == nil, let error = job?["error"]?.stringValue {
        AglynNotice(error, tone: job?["status"]?.stringValue == "failed" ? .error : .warning)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("AI summary")
    .accessibilityIdentifier("ai-crm-record")
  }

  private func jobs(_ orgID: String) async throws -> JSONValue? {
    try await context.api.request("/api/ai/jobs", query: [("orgId", orgID), ("limit", String(aiRecentJobsRead))])
  }

  /// The summary another member already asked for, if any (`recall: 'any'`); the flag off or a plan without generation
  /// (404, 403) leaves the card off the page.
  private func load() async {
    guard let zone, let kind, let orgID, context.can("ai.generate") else { return }
    verdict = "checking"
    job = nil
    proposal = nil
    notice = nil
    do {
      let answer = try await jobs(orgID)
      verdict = "ready"
      let found = (answer?["jobs"]?.arrayValue ?? []).first {
        $0["hostId"]?.stringValue == zone.hostID && aiCrmJobAnswersRecord($0, kind: kind, id: zone.recordID)
      }
      guard let found else { return }
      job = found
      jobID = found["id"]?.stringValue ?? ""
      if !aiJobIsTerminal(found) { watch(jobID, orgID: orgID) } else if found["status"]?.stringValue == "done" {
        proposal = await readAnswer(jobID, orgID: orgID)
      }
    } catch is CancellationError {
    } catch {
      if let failure = error as? ConsoleAPIError, failure.status == 403 || failure.status == 404 {
        verdict = "hidden"
      } else {
        notice = (error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message } ?? aiCrmLoadFailedCopy
        verdict = "ready"
      }
    }
  }

  private func readAnswer(_ id: String, orgID: String) async -> AiCrmRecordProposal? {
    let answer = try? await context.api.request("/api/ai/crm/\(id)", query: [("orgId", orgID)])
    return AiCrmRecordProposal(answer?["answer"]?["proposal"])
  }

  /// Follows a job until it settles, then reads its answer.
  private func watch(_ id: String, orgID: String) {
    watching?.cancel()
    watching = Task {
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: aiSeoPollNanoseconds)
        guard !Task.isCancelled else { return }
        guard let next = (try? await jobs(orgID)).flatMap({ aiJobByID($0, id) }) else { continue }
        job = next
        guard aiJobIsTerminal(next) else { continue }
        if next["status"]?.stringValue == "done" {
          proposal = await readAnswer(id, orgID: orgID)
          if proposal == nil { notice = aiCrmAnswerGoneCopy }
        }
        return
      }
    }
  }

  private func ask(_ zone: RecordInsightsZone, _ kind: String) {
    guard let orgID else { return }
    busy = true
    notice = nil
    Task {
      defer { busy = false }
      do {
        var body: [String: JSONValue] = [
          "orgId": .string(orgID), "kind": "crm", "brief": .string("Summarize this \(kind)"),
          "inputs": ["task": "record", "record": .string(kind), "recordId": .string(zone.recordID)],
        ]
        body["hostId"] = zone.hostID.map { .string($0) } ?? .null
        let answer = try await context.api.request("/api/ai/jobs", method: .post, body: .object(body))
        guard let started = answer?["job"] else { return }
        proposal = nil
        job = started
        jobID = started["id"]?.stringValue ?? ""
        if !aiJobIsTerminal(started) { watch(jobID, orgID: orgID) } else if started["status"]?.stringValue == "done" {
          proposal = await readAnswer(jobID, orgID: orgID)
        }
      } catch {
        notice = (error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message } ?? aiCrmStartFailedCopy
      }
    }
  }
}
