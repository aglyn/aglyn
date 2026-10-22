// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The slot the shell docks the AI panel's widget in: on the right on wide windows, a sheet on phones.
public let assistPanelSlot = "assistPanel"

/// How many turns of the thread ride with each question, as the console's panel sends them.
private let assistHistoryTurns = 12

/// One turn of the thread.
private struct AssistTurn: Identifiable, Equatable {
  let id = UUID()
  let role: String
  var text: String
  var docs: [Pair] = []
  var proposal: Pair?

  struct Pair: Equatable, Hashable {
    let label: String
    let href: String
  }
}

/// The day's or month's message standing (`quota` on the chat's answer).
private struct AssistQuota: Equatable {
  let period: String
  let limit: Int
  let remaining: Int
}

/// A few questions that fit where the person is, by the console path the shell reports (the Kotlin kit's, word for word).
func assistSuggestions(_ route: String) -> [String] {
  switch true {
  case route.contains("/orders"): ["Which orders need me today?", "Draft a reply about a late order", "How do I refund one item?"]
  case route.contains("/products"): ["Write a description for a product", "Which products are low on stock?", "How do I add variants?"]
  case route.contains("/crm"): ["Who should I follow up with this week?", "Draft a follow-up email", "How do deal stages work?"]
  case route.contains("/inbox"): ["Summarize today's messages", "Draft a friendly reply", "How do I add someone to a list?"]
  case route.contains("/screens") || route.contains("/pages"):
    ["Add a section to this page", "Write a headline for my home page", "How do I publish a page?"]
  case route.contains("/hosts/"): ["What needs me on this site?", "Build me a page", "How do I change my site's colors?"]
  default: ["What can Assist do here?", "Build me a new page", "How do I invite my team?"]
  }
}

/// The AI panel (`ai.assist-panel`, the console's Assist): a chat that reads the page the person is on, its context chip
/// saying what it reads, a few questions that fit the screen, the credits strip and the day's free limit. Answers stream
/// from `/api/assist/chat`, the console's own route; a proposal opens where it points, and documentation opens in the
/// in-app browser. With no model on a deployment the route answers from the docs, or says so.
struct AiAssistPanel: View {
  let context: NativePluginContext
  @Environment(\.aglynSlotParams) private var params
  @State private var turns: [AssistTurn] = []
  @State private var question = ""
  @State private var busy = false
  @State private var quota: AssistQuota?
  @State private var credits: String?
  @State private var task: Task<Void, Never>?

  private var route: String { params["route"] ?? "" }

  var body: some View {
    VStack(spacing: 0) {
      if let looking = params["title"], !looking.isEmpty {
        HStack(spacing: 6) {
          Image(systemName: "eye").font(.caption)
          Text("Looking at: \(looking)").font(AglynFont.caption).lineLimit(1)
        }
        .foregroundStyle(AglynColor.tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(Capsule().fill(AglynColor.primary.opacity(0.12)))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.one)
        .accessibilityIdentifier("assist-context")
      }
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 10) {
            if turns.isEmpty { suggestions }
            ForEach(Array(turns.enumerated()), id: \.element.id) { index, turn in
              turnView(turn, last: index == turns.count - 1).id(turn.id)
            }
          }
          .padding(AglynSpace.two)
        }
        .onChange(of: turns.last?.text) { if let last = turns.last { proxy.scrollTo(last.id, anchor: .bottom) } }
      }
      let standing = [
        quota.map { "\($0.remaining) of \($0.limit) free messages left \($0.period == "day" ? "today" : "this month")" }, credits,
      ].compactMap { $0 }.joined(separator: " · ")
      if !standing.isEmpty {
        Text(standing).font(AglynFont.caption).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, AglynSpace.two)
          .accessibilityIdentifier("assist-credits")
      }
      HStack(spacing: AglynSpace.one) {
        TextField(context.hostID != nil ? "Ask about this site" : "Ask about this workspace", text: $question, axis: .vertical)
          .textFieldStyle(.plain)
          .lineLimit(1...4)
          .onSubmit { ask(question) }
          .padding(10)
          .background(RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous).fill(AglynColor.page))
          .accessibilityIdentifier("assist-field")
        Button {
          ask(question)
        } label: {
          Image(systemName: "arrow.up.circle.fill").font(.title2)
        }
        .buttonStyle(.plain)
        .foregroundStyle(AglynColor.tint)
        .disabled(busy || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityLabel("Send")
        .accessibilityIdentifier("assist-send")
      }
      .padding(.horizontal, AglynSpace.oneAndHalf)
      .padding(.top, AglynSpace.one)
      Text("Questions are free; builds and edits use credits.")
        .font(AglynFont.caption).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AglynSpace.two)
        .padding(.bottom, AglynSpace.one)
    }
    .background(AglynColor.paper)
    .accessibilityIdentifier("assist-panel")
    .task(id: context.orgID) { await loadCredits() }
    .onDisappear { task?.cancel() }
  }

  private var suggestions: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Try").font(AglynFont.caption).foregroundStyle(.secondary)
      ForEach(assistSuggestions(route), id: \.self) { text in
        Button {
          ask(text)
        } label: {
          Label(text, systemImage: "sparkles").font(AglynFont.subheadline)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("assist-suggestion")
      }
    }
  }

  @ViewBuilder
  private func turnView(_ turn: AssistTurn, last: Bool) -> some View {
    let mine = turn.role == "user"
    let shown = turn.text.isEmpty && busy && last ? "…" : turn.text
    VStack(alignment: .leading, spacing: 6) {
      Text(
        (try? AttributedString(markdown: shown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
          ?? AttributedString(shown)
      )
      .font(AglynFont.body)
      .textSelection(.enabled)
      .environment(\.openURL, OpenURLAction { url in
        context.openLink(url.absoluteString)
        return .handled
      })
      if let proposal = turn.proposal {
        Button(proposal.label) { context.openLink(proposal.href) }
          .buttonStyle(.aglynProminent).controlSize(.small)
          .accessibilityIdentifier("assist-proposal")
      }
      ForEach(turn.docs, id: \.self) { doc in
        Button { context.openLink(doc.href) } label: { Label(doc.label, systemImage: "book").font(AglynFont.subheadline) }
          .buttonStyle(.borderless)
      }
    }
    .padding(10)
    .background(
      RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous)
        .fill(mine ? AglynColor.primary.opacity(0.14) : AglynColor.page))
    .frame(maxWidth: 520, alignment: .leading)
    .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    .accessibilityIdentifier(mine ? "assist-question" : "assist-answer")
  }

  private func loadCredits() async {
    guard let orgID = context.orgID,
      let answer = try? await context.api.request("/api/ai/billing/credits", query: [("orgId", orgID)])
    else { return }
    if answer["unlimited"]?.boolValue == true {
      credits = "AI credits are not capped on this workspace"
    } else if let remaining = answer["credits"]?["remaining"]?.numberValue {
      credits = "\(Int(remaining)) credits left this month"
    }
  }

  private func ask(_ text: String) {
    let asked = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !asked.isEmpty, !busy, let orgID = context.orgID else { return }
    let history: [JSONValue] = turns.suffix(assistHistoryTurns).filter { !$0.text.isEmpty }.map {
      .object(["role": .string($0.role), "text": .string($0.text)])
    }
    turns.append(AssistTurn(role: "user", text: asked))
    turns.append(AssistTurn(role: "assistant", text: ""))
    question = ""
    busy = true
    let index = turns.count - 1
    let body: JSONValue = .object([
      "orgId": .string(orgID), "question": .string(asked), "history": .array(history),
      "context": .object([
        "route": .string(route), "hostId": .string(context.hostID ?? ""), "orgSlug": .string(context.orgSlug ?? ""),
      ]),
    ])
    let api = context.api
    task = Task { @MainActor in
      do {
        for try await event in api.events("/api/assist/chat", body: body) {
          guard turns.indices.contains(index) else { break }
          switch event["type"]?.stringValue {
          case "delta": turns[index].text += event["text"]?.stringValue ?? ""
          case "done":
            turns[index].docs = (event["docs"]?.arrayValue ?? []).compactMap { doc in
              guard let label = doc["title"]?.stringValue ?? doc["label"]?.stringValue,
                let href = doc["url"]?.stringValue ?? doc["href"]?.stringValue
              else { return nil }
              return AssistTurn.Pair(label: label, href: href)
            }
            if let proposal = event["proposal"], let href = proposal["href"]?.stringValue {
              turns[index].proposal = AssistTurn.Pair(label: proposal["label"]?.stringValue ?? "Open it", href: href)
            }
            if let q = event["quota"] {
              quota = AssistQuota(
                period: q["period"]?.stringValue ?? "day", limit: Int(q["limit"]?.numberValue ?? 0),
                remaining: Int(q["remaining"]?.numberValue ?? 0))
            }
          case "error": turns[index].text += event["error"]?.stringValue ?? ""
          default: break
          }
        }
      } catch {
        let said: String =
          (error as? ConsoleAPIError)?.status == 501
          ? "I could not find anything in the documentation about that, and Assist is not switched on here yet. Try asking in different words."
          : ((error as? ConsoleAPIError)?.message ?? "The assistant request failed. Try again.")
        if turns.indices.contains(index) {
          turns[index].text = [turns[index].text, said].filter { !$0.isEmpty }.joined(separator: "\n\n")
        }
      }
      busy = false
    }
  }
}

/// Home's "Needs you" line for AI (`ai.needs-you`): jobs that finished in the last day and jobs waiting on the person's
/// input or review, the one job when there is one, else AI jobs.
struct AiNeedsYouWidget: View {
  let context: NativePluginContext
  @State private var jobs: [JSONValue]?

  var body: some View {
    let rows = jobs ?? []
    let dayAgo = Date().addingTimeInterval(-24 * 60 * 60)
    let waiting = rows.filter { ["needs_input", "needs_review"].contains($0["status"]?.stringValue ?? "") }
    let finished = rows.filter { job in
      job["status"]?.stringValue == "done"
        && (job["updatedAt"]?.stringValue.flatMap(Self.date) ?? .distantPast) >= dayAgo
    }
    VStack(spacing: 0) {
      if !waiting.isEmpty {
        AglynNeedsYouLine(
          id: "ai-waiting", systemImage: "sparkles",
          text: waiting.count == 1
            ? "AI is waiting on you: \(waiting[0]["brief"]?.stringValue ?? "a job")" : "\(waiting.count) AI jobs are waiting on you",
          place: "AI jobs", tone: .warning
        ) { open(waiting) }
      }
      if !finished.isEmpty {
        AglynNeedsYouLine(
          id: "ai-finished", systemImage: "sparkles",
          text: finished.count == 1
            ? "AI finished: \(finished[0]["brief"]?.stringValue ?? "a job")" : "\(finished.count) AI jobs finished today",
          place: "AI jobs"
        ) { open(finished) }
      }
    }
    .task(id: "\(context.orgID ?? ""):\(context.hostID ?? "")") {
      guard let orgID = context.orgID, let hostID = context.hostID else { return }
      let answer = try? await context.api.request(
        "/api/ai/jobs", query: [("orgId", orgID), ("hostId", hostID), ("limit", "20")])
      jobs = answer?["jobs"]?.arrayValue ?? []
    }
  }

  /// An ISO time, with or without its milliseconds.
  static func date(_ text: String) -> Date? {
    let precise = ISO8601DateFormatter()
    precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return precise.date(from: text) ?? ISO8601DateFormatter().date(from: text)
  }

  private func open(_ list: [JSONValue]) {
    if list.count == 1, let id = list[0]["id"]?.stringValue {
      context.navigate("ai.job", ["jobId": id])
    } else {
      context.navigate("ai.jobs")
    }
  }
}
