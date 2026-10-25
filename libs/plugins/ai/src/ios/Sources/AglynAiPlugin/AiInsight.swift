// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// "Ask AI about these numbers" (AGL-4011): the console's tile (ai-insight-card.component.tsx) on a site's Home and
// Analytics and on the workspace's Home, and its "Ask about your numbers" dialog (ai-insight-dialog.component.tsx). A
// question starts an `insight` job through the console's own door (`POST /api/ai/jobs`), the dialog follows the job's
// events and reads the answer through `/api/ai/insights/{jobId}`, with every insight's figures one tap away. On a plan
// without the AI add-on the same tile opens the add-on's offer. Every word comes from the contracts
// (ai-insight-ask.ts). The Kotlin twin is `AiInsight.kt`.

/// Where a question is asked from: the console's `surface`.
enum AiInsightSurface: String {
  case analytics, workspace

  var placeholder: String {
    ContractValues.shared.aiInsightPlaceholders[rawValue] ?? ""
  }
}

/// The add-on's offer for the tile (`AI_UPSELL_COPY.insight`, `aiUpsellOffer`), in the console's words.
enum AiInsightUpsell {
  static let does =
    "Ask a question about the figures on this page and AI answers from them, every answer traced to the figures it is built from. It reads; it changes nothing."

  static func offer(canManageBilling: Bool) -> String {
    let feature = ContractValues.shared.aiInsightCardCopy.title
    let addon = "\(ContractValues.shared.platformBrandName) AI"
    return canManageBilling
      ? "\(feature) is switched off for this workspace. It comes with an \(addon) tier, which you can choose in Billing."
      : "\(feature) is switched off for this workspace. It comes with an \(addon) tier. Ask a workspace owner or admin to choose one in Billing."
  }
}

/// Whether the workspace's plan and release let it ask: the slot's `aiGenerative` feature and `release_ai_generative`.
@MainActor
@Observable
final class AiInsightGate {
  /// nil while asked; false shows the add-on's offer.
  private(set) var entitled: Bool?
  private(set) var released = false
  @ObservationIgnored private let org = ObservedDocument()

  func start(_ context: NativePluginContext) async {
    guard let orgID = context.orgID else { return }
    org.start(context.firestore, ["orgs", orgID])
    var query: [(String, String?)] = [("orgId", orgID)]
    if let hostID = context.hostID { query.append(("hostId", hostID)) }
    do {
      let body = try await context.api.request("/api/orgs/entitlements", query: query)
      entitled = body?["features"]?["aiGenerative"]?.boolValue ?? false
    } catch {
      entitled = nil
    }
  }

  func releasedFor(_ context: NativePluginContext) -> Bool {
    org.ready && releaseFlagOn("release_ai_generative", org: org.document?.data, orgID: context.orgID, staff: context.staff != nil)
  }

  func stop() { org.stop() }
}

/// The tile: what it answers and "Ask a question".
struct AiInsightTile: View {
  let context: NativePluginContext
  let surface: AiInsightSurface
  @State private var gate = AiInsightGate()
  @State private var asking = false
  @State private var upsell = false

  private var copy: AiInsightCardCopy { ContractValues.shared.aiInsightCardCopy }

  var body: some View {
    Group {
      if gate.entitled != nil && gate.releasedFor(context) {
        VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
          Text(copy.title).font(AglynFont.headline).accessibilityAddTraits(.isHeader)
          Text(surface == .workspace ? copy.workspace : copy.site).font(AglynFont.subheadline).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
          Button {
            if gate.entitled == true { asking = true } else { upsell = true }
          } label: {
            Label(copy.action, systemImage: "sparkles")
          }
          .buttonStyle(.aglynSecondary)
          .accessibilityIdentifier("ai-insight-ask")
        }
        .padding(AglynSpace.two)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .aglynCardSurface()
        .accessibilityIdentifier("ai-insight-tile")
      }
    }
    .task(id: "\(context.orgID ?? ""):\(context.hostID ?? "")") { await gate.start(context) }
    .onDisappear { gate.stop() }
    .sheet(isPresented: $asking) { AiInsightSheet(context: context, surface: surface) }
    .sheet(isPresented: $upsell) { AiInsightUpsellSheet(context: context) }
  }
}

/// The add-on's offer on a plan without it.
struct AiInsightUpsellSheet: View {
  let context: NativePluginContext
  @Environment(\.dismiss) private var dismiss

  private var canManageBilling: Bool { ["owner", "admin"].contains(context.orgRole ?? "") }

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        Text(AiInsightUpsell.does).font(AglynFont.body)
        Text(AiInsightUpsell.offer(canManageBilling: canManageBilling)).font(AglynFont.subheadline).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      }
      .padding(AglynSpace.three)
      .frame(maxWidth: .infinity, alignment: .topLeading)
      .navigationTitle(ContractValues.shared.aiInsightCardCopy.title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(canManageBilling ? "Not now" : "Close") { dismiss() }
        }
        if canManageBilling {
          ToolbarItem(placement: .confirmationAction) {
            Button("Add \(ContractValues.shared.platformBrandName) AI") {
              dismiss()
              context.navigate("core.billing.addons")
            }
            .accessibilityIdentifier("ai-insight-upsell-add")
          }
        }
      }
    }
    .accessibilityIdentifier("ai-insight-upsell")
  }
}

// MARK: - The answer

/// A table the job read, as `/api/ai/insights/{jobId}` returns it.
struct AiInsightTable {
  struct Column {
    let key: String
    let label: String
    let kind: String
    let currency: String?
  }

  let ref: String
  let title: String
  let periodFrom: String?
  let periodTo: String?
  let sourceLabel: String
  let sourcePath: String?
  let scope: String
  let columns: [Column]
  let rows: [[String: JSONValue]]

  init(_ value: JSONValue) {
    ref = value["ref"]?.stringValue ?? ""
    title = value["title"]?.stringValue ?? ""
    periodFrom = value["period"]?["from"]?.stringValue
    periodTo = value["period"]?["to"]?.stringValue
    sourceLabel = value["source"]?["label"]?.stringValue ?? ""
    sourcePath = value["source"]?["path"]?.stringValue
    scope = value["scope"]?.stringValue ?? "site"
    columns = (value["columns"]?.arrayValue ?? []).map {
      Column(
        key: $0["key"]?.stringValue ?? "", label: $0["label"]?.stringValue ?? "", kind: $0["kind"]?.stringValue ?? "",
        currency: $0["currency"]?.stringValue)
    }
    rows = (value["rows"]?.arrayValue ?? []).map { row in
      if case .object(let record) = row { return record }
      return [:]
    }
  }

  /// `aiInsightCellText` (`pluginFigureCellText`): a cell by its column's kind; nothing is "—".
  func cellText(_ key: String, _ value: JSONValue?) -> String {
    switch value {
    case nil, .null?: return "—"
    case .string(let text)?: return text.isEmpty ? "—" : text
    case .number(let number)?:
      guard let column = columns.first(where: { $0.key == key }) else { return number.formatted() }
      let oneDecimal = FloatingPointFormatStyle<Double>.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "en_US"))
      switch column.kind {
      case "money": return number.formatted(.currency(code: column.currency ?? "USD").locale(Locale(identifier: "en_US")))
      case "percent": return "\(number.formatted(oneDecimal))%"
      case "change": return "\(number > 0 ? "+" : "")\(number.formatted(oneDecimal))%"
      case "duration":
        let seconds = Int((number + 0.5).rounded(.down))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return String(format: "%dm %02ds", minutes, seconds % 60) }
        return String(format: "%dh %02dm", minutes / 60, minutes % 60)
      default:
        return number.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "en_US")))
      }
    case .bool(let flag)?: return String(flag)
    default: return "—"
    }
  }

  /// `aiInsightRowText`: one cited row, every column labeled.
  func rowText(_ index: Int) -> String {
    guard rows.indices.contains(index) else { return "" }
    return columns.map { "\($0.label): \(cellText($0.key, rows[index][$0.key]))" }.joined(separator: " · ")
  }

  /// `aiInsightSourceHref`: the console page the figures come from.
  func sourceHref(orgSlug: String?, host: String?) -> String? {
    guard let path = sourcePath, !path.isEmpty, let orgSlug, !orgSlug.isEmpty else { return nil }
    if scope == "org" { return "/\(orgSlug)/\(path)" }
    return host.map { "/\(orgSlug)/hosts/\($0)/\(path)" }
  }
}

/// An insight job's answer.
struct AiInsightAnswer {
  struct Insight {
    let text: String
    let cites: [(table: String, rows: [Int])]
  }

  let question: String
  let insights: [Insight]
  let gap: String?
  let left: Int
  let tables: [AiInsightTable]

  init(_ value: JSONValue) {
    question = value["question"]?.stringValue ?? ""
    insights = (value["insights"]?.arrayValue ?? []).map { insight in
      Insight(
        text: insight["text"]?.stringValue ?? "",
        cites: (insight["cites"]?.arrayValue ?? []).map { cite in
          (table: cite["table"]?.stringValue ?? "", rows: (cite["rows"]?.arrayValue ?? []).compactMap { $0.numberValue.map(Int.init) })
        })
    }
    gap = value["gap"]?.stringValue
    left = Int(value["left"]?.numberValue ?? 0)
    tables = (value["tables"]?.arrayValue ?? []).map(AiInsightTable.init)
  }
}

/// "Ask about your numbers": the question and its window, the job's progress, then the answer with its figures.
struct AiInsightSheet: View {
  let context: NativePluginContext
  let surface: AiInsightSurface

  private enum Phase { case ask, working, answer }

  @Environment(\.dismiss) private var dismiss
  @State private var phase = Phase.ask
  @State private var question = ""
  @State private var days = Int(ContractValues.shared.aiInsightDefaultDays)
  @State private var notice: String?
  @State private var stillWriting: String?
  @State private var answer: AiInsightAnswer?
  @State private var openCitations: Int?
  @State private var subscribed: Bool?
  @State private var watching: Task<Void, Never>?

  private var copy: AiInsightDialogCopy { ContractValues.shared.aiInsightDialogCopy }
  private var maxChars: Int { Int(ContractValues.shared.aiInsightQuestionMaxChars) }

  var body: some View {
    NavigationStack {
      Form {
        switch phase {
        case .ask: askSection
        case .working:
          Section {
            HStack(spacing: AglynSpace.oneAndHalf) {
              ProgressView()
              Text(copy.working)
            }
            .accessibilityIdentifier("ai-insight-working")
          }
        case .answer: answerSection
        }
        if let notice {
          Section {
            AglynNotice(notice, tone: .warning)
            if let job = stillWriting {
              Button(copy.openJobs) {
                dismiss()
                context.navigate("ai.job", ["jobId": job])
              }
            }
          }
        }
        if let subscribed {
          Section {
            Toggle(copy.digest, isOn: Binding(get: { subscribed }, set: { toggleDigest($0) }))
              .accessibilityIdentifier("ai-insight-digest")
          }
        }
      }
      .formStyle(.aglynGrouped)
      .navigationTitle(copy.title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(copy.close) { dismiss() } }
        if phase == .answer {
          ToolbarItem(placement: .primaryAction) {
            Button(copy.askAnother) {
              answer = nil
              question = ""
              phase = .ask
            }
          }
        }
        if phase == .ask {
          ToolbarItem(placement: .confirmationAction) {
            Button(copy.ask) { ask() }
              .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
              .accessibilityIdentifier("ai-insight-submit")
          }
        }
      }
    }
    .accessibilityIdentifier("ai-insight-dialog")
    .task { await readDigest() }
    .onDisappear { watching?.cancel() }
  }

  @ViewBuilder
  private var askSection: some View {
    Section {
      TextField(copy.questionLabel, text: $question, prompt: Text(surface.placeholder), axis: .vertical)
        .lineLimit(2...6)
        .onChange(of: question) { if question.count > maxChars { question = String(question.prefix(maxChars)) } }
        .accessibilityIdentifier("ai-insight-question")
    } header: {
      Text(copy.questionLabel)
    }
    Section {
      Picker(copy.windowLabel, selection: $days) {
        ForEach(ContractValues.shared.aiInsightWindows.map { Int($0) }, id: \.self) { Text("\($0) days").tag($0) }
      }
      .pickerStyle(.segmented)
      .accessibilityIdentifier("ai-insight-window")
    } header: {
      Text(copy.windowLabel)
    } footer: {
      Text(copy.promise)
    }
  }

  @ViewBuilder
  private var answerSection: some View {
    if let answer {
      Section {
        if answer.insights.isEmpty {
          AglynNotice(copy.unanswered, tone: .info)
        }
        ForEach(Array(answer.insights.enumerated()), id: \.offset) { index, insight in
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            Text("\(index + 1). \(insight.text)")
            Button(openCitations == index ? copy.hideFigures : copy.showFigures) {
              openCitations = openCitations == index ? nil : index
            }
            .buttonStyle(.borderless)
            if openCitations == index {
              citations(insight, answer: answer)
            }
          }
        }
        if let gap = answer.gap, !gap.isEmpty { AglynNotice(gap, tone: .info) }
        if answer.left > 0 {
          Text(
            "\(answer.left) \(answer.left == 1 ? "insight was" : "insights were") left out because \(answer.left == 1 ? "its numbers" : "their numbers") could not be traced to the figures."
          )
          .font(AglynFont.caption).foregroundStyle(.secondary)
        }
      } header: {
        Text(answer.question)
      }
      .accessibilityIdentifier("ai-insight-answer")
    }
  }

  private func citations(_ insight: AiInsightAnswer.Insight, answer: AiInsightAnswer) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      ForEach(insight.cites, id: \.table) { cite in
        if let table = answer.tables.first(where: { $0.ref == cite.table }) {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            HStack(spacing: AglynSpace.half) {
              Text(table.periodFrom.map { "\(table.title) · \($0) to \(table.periodTo ?? "")" } ?? table.title)
              if let href = table.sourceHref(orgSlug: context.orgSlug, host: context.sites.first { $0.id == context.hostID }?.subdomain) {
                Button("Open \(table.sourceLabel)") { _ = context.openLink(href) }.buttonStyle(.borderless)
              }
            }
            .font(AglynFont.caption).foregroundStyle(.secondary)
            ForEach(cite.rows, id: \.self) { row in Text(table.rowText(row)).font(AglynFont.caption) }
          }
        }
      }
    }
    .padding(.leading, AglynSpace.one)
  }

  // MARK: Requests (the console dialog's own)

  private func readDigest() async {
    guard let orgID = context.orgID else { return }
    let users = ObservedDocument()
    users.start(context.firestore, ["users", context.uid])
    for _ in 0..<50 where !users.ready { try? await Task.sleep(nanoseconds: 100_000_000) }
    let digests = users.document?.data["insightDigests"] as? [String: Any]
    subscribed = (digests?[orgID] as? Bool) == true
    users.stop()
  }

  private func toggleDigest(_ next: Bool) {
    guard let orgID = context.orgID, subscribed != nil else { return }
    subscribed = next
    Task {
      do {
        try await context.firestore.setDocument(["users", context.uid], ["insightDigests": [orgID: next]], merge: true)
      } catch {
        subscribed = !next
        notice = copy.digestFailed
      }
    }
  }

  private func ask() {
    let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, let orgID = context.orgID else { return }
    notice = nil
    stillWriting = nil
    phase = .working
    watching?.cancel()
    watching = Task {
      do {
        let body: JSONValue = .object([
          "orgId": .string(orgID), "hostId": context.hostID.map { .string($0) } ?? .null, "kind": .string("insight"),
          "brief": .string(text), "inputs": .object(["surface": .string(surface.rawValue), "days": .number(Double(days))]),
        ])
        let created = try await context.api.request("/api/ai/jobs", method: .post, body: body)
        guard let job = created?["job"], let id = job["id"]?.stringValue else {
          notice = copy.askFailed
          phase = .ask
          return
        }
        await follow(id: id, status: job["status"]?.stringValue ?? "", error: job["error"]?.stringValue, orgID: orgID)
      } catch is CancellationError {
      } catch {
        notice = (error as? ConsoleAPIError)?.message ?? copy.askFailed
        phase = .ask
      }
    }
  }

  private static let terminal: Set<String> = ["done", "failed", "canceled"]

  /// Follows the job's events until it settles (the console's `follow`), reconnecting when the stream asks to.
  private func follow(id: String, status: String, error: String?, orgID: String) async {
    if Self.terminal.contains(status) { return await settle(id: id, status: status, error: error, orgID: orgID) }
    var again = true
    while again && !Task.isCancelled {
      again = false
      var settled: (status: String, error: String?)?
      do {
        for try await event in context.api.events("/api/ai/jobs/\(id)/events", query: [("orgId", orgID)], body: nil) {
          if event["type"]?.stringValue == "reconnect" { again = true }
          guard event["type"]?.stringValue == "state", let next = event["job"] else { continue }
          let nextStatus = next["status"]?.stringValue ?? ""
          if nextStatus == "needs_input" { notice = next["error"]?.stringValue ?? copy.cannotRun }
          if Self.terminal.contains(nextStatus) { settled = (nextStatus, next["error"]?.stringValue) }
        }
      } catch {
        if Task.isCancelled { return }
        break
      }
      if let settled { return await settle(id: id, status: settled.status, error: settled.error, orgID: orgID) }
    }
    if !Task.isCancelled {
      notice = copy.stillWriting
      stillWriting = id
      phase = .ask
    }
  }

  private func settle(id: String, status: String, error: String?, orgID: String) async {
    guard status == "done" else {
      notice = error ?? copy.questionFailed
      phase = .ask
      return
    }
    do {
      let payload = try await context.api.request("/api/ai/insights/\(id)", query: [("orgId", orgID)])
      guard let read = payload?["answer"] else {
        notice = copy.answerFailed
        phase = .ask
        return
      }
      answer = AiInsightAnswer(read)
      phase = .answer
    } catch {
      notice = (error as? ConsoleAPIError)?.message ?? copy.answerFailed
      phase = .ask
    }
  }
}
