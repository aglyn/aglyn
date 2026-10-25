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

/// The panel's sizes, from Figma: touch on iPhone and iPad (iPhone / Sheet / AI 21:314, Android / Sheet / AI 273:20299),
/// the Mac's compact panel (AI panel 18:485). One structure, two sets of numbers.
private struct AssistMetrics {
  /// The one content edge: chip, suggestions, composer and footer all start and end on it.
  let edge: CGFloat = AglynSpace.two
  let chipText: CGFloat
  let chipWeight: Font.Weight
  let chipPadding: EdgeInsets
  /// The chip's least height: 28 on touch (21:340), the text's own on the Mac.
  let chipHeight: CGFloat
  /// Questions, answers, the field and suggestions.
  let body: CGFloat
  let suggestion: CGFloat
  let suggestionIcon: CGFloat
  let suggestionPadding: EdgeInsets
  /// A suggestion card's least height: 46 on touch (21:347), 36 on the Mac (the Kotlin panel's suggestionHeight).
  let suggestionHeight: CGFloat
  let suggestionRadius: CGFloat
  let suggestionGap: CGFloat
  /// Between a suggestion's ✦ and its words.
  let suggestionIconGap: CGFloat
  /// "Try" and the footer.
  let caption: CGFloat
  let captionWeight: Font.Weight
  let composer: CGFloat
  let composerRadius: CGFloat
  let composerLeading: CGFloat
  let send: CGFloat
  let sendRadius: CGFloat
  let sendIcon: CGFloat
  let bubbleRadius: CGFloat
  let action: CGFloat
  let actionHeight: CGFloat
  let actionRadius: CGFloat
  /// The Mac keeps its suggestions under the thread (18:485); a phone gives the thread the room once it starts.
  let suggestionsStay: Bool

  static var current: AssistMetrics {
    #if os(macOS)
      AssistMetrics(
        chipText: 12, chipWeight: .semibold,
        chipPadding: EdgeInsets(top: AglynSpace.half, leading: AglynSpace.one, bottom: AglynSpace.half, trailing: AglynSpace.of(1.25)),
        chipHeight: 0, body: 14, suggestion: 13, suggestionIcon: AglynSpace.of(1.75),
        suggestionPadding: EdgeInsets(top: AglynSpace.one, leading: AglynSpace.of(1.25), bottom: AglynSpace.one, trailing: AglynSpace.of(1.25)),
        suggestionHeight: AglynSpace.of(4.5), suggestionRadius: AglynTokens.radius * 1.5, suggestionGap: AglynSpace.of(1.75),
        suggestionIconGap: AglynSpace.one, caption: 12, captionWeight: .semibold, composer: AglynSpace.of(5.5),
        composerRadius: AglynTokens.radius * 2.5, composerLeading: AglynSpace.oneAndHalf, send: AglynSpace.four,
        sendRadius: AglynTokens.radius * 1.5, sendIcon: AglynSpace.of(1.75), bubbleRadius: AglynTokens.radius * 2.5,
        action: 13, actionHeight: AglynSpace.of(3.5), actionRadius: AglynTokens.radius * 1.5, suggestionsStay: true)
    #else
      AssistMetrics(
        chipText: 13, chipWeight: .regular,
        chipPadding: EdgeInsets(top: AglynSpace.of(0.625), leading: AglynSpace.of(1.25), bottom: AglynSpace.of(0.625), trailing: AglynSpace.oneAndHalf),
        chipHeight: AglynSpace.of(3.5), body: 15, suggestion: 15, suggestionIcon: AglynSpace.two,
        suggestionPadding: EdgeInsets(top: AglynSpace.oneAndHalf, leading: AglynSpace.of(1.75), bottom: AglynSpace.oneAndHalf, trailing: AglynSpace.of(1.75)),
        suggestionHeight: AglynSpace.of(5.75), suggestionRadius: AglynTokens.radius * 3, suggestionGap: AglynSpace.of(0.75),
        suggestionIconGap: AglynSpace.of(1.25), caption: 13, captionWeight: .regular, composer: AglynSpace.of(6.5),
        composerRadius: AglynTokens.radius * 3, composerLeading: AglynSpace.of(1.75), send: AglynSpace.of(5),
        sendRadius: AglynTokens.radius * 2, sendIcon: AglynSpace.two, bubbleRadius: AglynTokens.radius * 3,
        action: 15, actionHeight: AglynSpace.of(4.5), actionRadius: AglynTokens.radius * 2, suggestionsStay: false)
    #endif
  }

  /// The brand face at a size, scaled with Dynamic Type.
  func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .custom(AglynTokens.fontPostScriptName, size: size, relativeTo: .body).weight(weight)
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

  private let m = AssistMetrics.current
  private var route: String { params["route"] ?? "" }

  private var canSend: Bool { !busy && !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// "Ask about Juniper Street Bakery": the site or workspace the shell says the person is in.
  private var prompt: String {
    if let scope = params["scope"], !scope.isEmpty { return "Ask about \(scope)" }
    return context.hostID != nil ? "Ask about this site" : "Ask about this workspace"
  }

  var body: some View {
    VStack(spacing: 0) {
      if let looking = params["title"], !looking.isEmpty {
        contextChip(looking)
      }
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: AglynSpace.of(1.75)) {
            ForEach(Array(turns.enumerated()), id: \.element.id) { index, turn in
              turnView(turn, last: index == turns.count - 1).id(turn.id)
            }
          }
          .padding(.horizontal, m.edge)
          .padding(.vertical, turns.isEmpty ? 0 : AglynSpace.one)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: turns.last?.text) { if let last = turns.last { proxy.scrollTo(last.id, anchor: .bottom) } }
      }
      if turns.isEmpty || m.suggestionsStay { suggestions }
      if let quota {
        Text("\(quota.remaining) of \(quota.limit) free messages left \(quota.period == "day" ? "today" : "this month")")
          .font(m.font(m.caption)).foregroundStyle(AglynColor.textTertiary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, m.edge)
          .padding(.top, AglynSpace.of(0.75))
          .accessibilityIdentifier("assist-quota")
      }
      composer
    }
    .background { assistGround }
    // A container, so the chip, suggestions, field and Send keep their own identifiers under the panel's.
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("assist-panel")
    .task(id: context.orgID) { await loadCredits() }
    .onDisappear { task?.cancel() }
  }

  private var bold: Bool { AglynThemeRuntime.shared.phoneBold }

  /// The panel's ground: paper, and in the phone's bold look the AI glow behind the sheet's top, under its bar (21:314).
  @ViewBuilder
  private var assistGround: some View {
    if bold {
      ZStack(alignment: .top) {
        AglynColor.paper
        AglynAIGlow()
      }
      .ignoresSafeArea(edges: .top)
    } else {
      AglynColor.paper
    }
  }

  /// The marks on the chip and the suggestions: the brand pink in the phone's bold look, the accent otherwise.
  private var markColor: Color { bold ? AglynHighlight.icon : AglynColor.accentIcon }

  /// What the panel reads: the place's own icon and name on the accent's soft fill (the highlight's pink in the bold look).
  private func contextChip(_ looking: String) -> some View {
    HStack(spacing: AglynSpace.of(0.75)) {
      Image(systemName: params["icon"].flatMap { $0.isEmpty ? nil : $0 } ?? "eye")
        .font(.system(size: m.chipText))
        .foregroundStyle(markColor)
        .accessibilityHidden(true)
      Text("Looking at: \(looking)").font(m.font(m.chipText, m.chipWeight)).foregroundStyle(bold ? AglynHighlight.text : AglynColor.textPrimary)
        .lineLimit(1)
    }
    .padding(m.chipPadding)
    .frame(minHeight: m.chipHeight)
    .background(Capsule().fill(bold ? AglynHighlight.soft : AglynColor.accentSoft))
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, m.edge)
    .padding(.top, AglynSpace.half)
    .padding(.bottom, AglynSpace.of(0.75))
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("assist-context")
  }

  /// A few questions that fit the screen, as outlined cards just above the field.
  private var suggestions: some View {
    VStack(alignment: .leading, spacing: m.suggestionGap) {
      let place = params["place"] ?? ""
      Text(m.suggestionsStay && !place.isEmpty ? "Suggestions for \(place)" : "Try")
        .font(m.font(m.caption, m.captionWeight)).foregroundStyle(AglynColor.secondaryText)
      ForEach(assistSuggestions(route), id: \.self) { text in
        Button {
          ask(text)
        } label: {
          HStack(spacing: m.suggestionIconGap) {
            Image(systemName: "sparkles").font(.system(size: m.suggestionIcon)).foregroundStyle(markColor)
            Text(text).font(m.font(m.suggestion)).foregroundStyle(AglynColor.textPrimary).multilineTextAlignment(.leading)
            Spacer(minLength: 0)
          }
          .padding(m.suggestionPadding)
          .frame(maxWidth: .infinity, minHeight: m.suggestionHeight, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: m.suggestionRadius, style: .continuous).fill(AglynColor.paper))
          .overlay(RoundedRectangle(cornerRadius: m.suggestionRadius, style: .continuous).strokeBorder(AglynColor.divider))
          .contentShape(RoundedRectangle(cornerRadius: m.suggestionRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier("assist-suggestion")
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, m.edge)
    .padding(.top, AglynSpace.of(0.75))
  }

  /// The field and its Send, and under them what questions and builds cost.
  private var composer: some View {
    VStack(alignment: .leading, spacing: AglynSpace.of(0.75)) {
      HStack(spacing: AglynSpace.of(1.25)) {
        TextField(prompt, text: $question, axis: .vertical)
          .textFieldStyle(.plain)
          .font(m.font(m.body))
          .lineLimit(1...4)
          .onSubmit { ask(question) }
          .padding(.vertical, AglynSpace.one)
          .accessibilityIdentifier("assist-field")
        Button {
          ask(question)
        } label: {
          Image(systemName: "paperplane")
            .font(.system(size: m.sendIcon, weight: .semibold))
            .foregroundStyle(AglynColor.primaryContrast)
            .frame(width: m.send, height: m.send)
            .background {
              // The brand gradient under the white plane in the phone's bold look (Figma Send 21:366).
              let shape = RoundedRectangle(cornerRadius: m.sendRadius, style: .continuous)
              if bold { shape.fill(AglynBrandGradient.linear) } else { shape.fill(AglynColor.primary) }
            }
        }
        .buttonStyle(.plain)
        .opacity(canSend ? 1 : 0.4)
        .disabled(!canSend)
        .accessibilityLabel("Send")
        .accessibilityIdentifier("assist-send")
      }
      .padding(.leading, m.composerLeading)
      .padding(.trailing, AglynSpace.of(0.75))
      .frame(minHeight: m.composer)
      .background(RoundedRectangle(cornerRadius: m.composerRadius, style: .continuous).fill(AglynColor.sunken))
      .overlay(RoundedRectangle(cornerRadius: m.composerRadius, style: .continuous).strokeBorder(AglynColor.divider))
      Text(["Questions are free · builds and edits use credits", credits].compactMap { $0 }.joined(separator: " "))
        .font(m.font(m.caption)).foregroundStyle(AglynColor.textTertiary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("assist-credits")
    }
    .padding(.horizontal, m.edge)
    #if os(macOS)
      // The Mac's composer sits on its own band under a hairline (18:540).
      .padding(.top, AglynSpace.oneAndHalf)
      .padding(.bottom, AglynSpace.of(1.75))
      .overlay(alignment: .top) { Rectangle().fill(AglynColor.divider).frame(height: 1) }
      .padding(.top, AglynSpace.of(0.75))
    #else
      .padding(.top, AglynSpace.of(0.75))
      .padding(.bottom, AglynSpace.of(1.25))
    #endif
  }

  @ViewBuilder
  private func turnView(_ turn: AssistTurn, last: Bool) -> some View {
    let mine = turn.role == "user"
    let shown = turn.text.isEmpty && busy && last ? "…" : turn.text
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text(
        (try? AttributedString(markdown: shown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
          ?? AttributedString(shown)
      )
      .font(m.font(m.body))
      .foregroundStyle(AglynColor.textPrimary)
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .environment(\.openURL, OpenURLAction { url in
        context.openLink(url.absoluteString)
        return .handled
      })
      if turn.proposal != nil || !turn.docs.isEmpty {
        // What the answer points to: outlined buttons (Figma Button, Secondary, Small), never a second primary.
        AglynWrapRow(spacing: AglynSpace.one, lineSpacing: AglynSpace.one) {
          if let proposal = turn.proposal {
            Button(proposal.label) { context.openLink(proposal.href) }
              .accessibilityIdentifier("assist-proposal")
          }
          ForEach(turn.docs, id: \.self) { doc in
            Button { context.openLink(doc.href) } label: { Label(doc.label, systemImage: "book") }
          }
        }
        .buttonStyle(AssistActionStyle(m: m))
      }
    }
    // Your question on the sunken fill; the answer as plain text on the panel (18:505, 18:507).
    .padding(mine ? EdgeInsets(top: AglynSpace.of(1.25), leading: AglynSpace.oneAndHalf, bottom: AglynSpace.of(1.25), trailing: AglynSpace.oneAndHalf) : EdgeInsets())
    .background {
      if mine { RoundedRectangle(cornerRadius: m.bubbleRadius, style: .continuous).fill(AglynColor.sunken) }
    }
    .accessibilityIdentifier(mine ? "assist-question" : "assist-answer")
  }

  private func loadCredits() async {
    guard let orgID = context.orgID,
      let answer = try? await context.api.request("/api/ai/billing/credits", query: [("orgId", orgID)])
    else { return }
    // The footer's parenthesis (Figma 21:370): "(1,240 left this month)".
    if answer["unlimited"]?.boolValue == true {
      credits = "(not capped on this workspace)"
    } else if let remaining = answer["credits"]?["remaining"]?.numberValue {
      credits = "(\(Int(remaining).formatted()) left this month)"
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

/// An answer's next step or document: an outlined button (Figma Button, Secondary, Small: the surface, a border/strong
/// outline, primary text in semibold), touch-sized on a phone.
private struct AssistActionStyle: ButtonStyle {
  let m: AssistMetrics

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(m.font(m.action, .semibold))
      .foregroundStyle(AglynColor.textPrimary)
      .labelStyle(.titleAndIcon)
      .padding(.horizontal, AglynSpace.of(1.25))
      .frame(height: m.actionHeight)
      .background(
        RoundedRectangle(cornerRadius: m.actionRadius, style: .continuous)
          .fill(configuration.isPressed ? AglynColor.hover : AglynColor.paper))
      .overlay(RoundedRectangle(cornerRadius: m.actionRadius, style: .continuous).strokeBorder(AglynColor.borderStrong))
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
