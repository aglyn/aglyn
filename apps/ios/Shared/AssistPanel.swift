// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Observation
import SwiftUI

// The AI panel (AGL-3945, Figma AI panel & in-app browser 2:5): the console's Assist — its chat, the page it is
// reading, the places and docs it points to, and its credits strip — docked on the right on the Mac and iPad, a sheet
// on a phone. It talks to the same route the console's panel does (`/api/assist/chat`), with the same body; nothing
// runs a model that the console would not.

/// One turn of the conversation.
struct AssistTurn: Identifiable, Equatable {
  enum Role: String { case user, assistant }
  let id = UUID()
  let role: Role
  var text: String
  /// Documentation the answer drew on, each opened in the in-app browser.
  var docs: [(title: String, url: String)] = []
  /// A place the answer offers to open (`proposal`), confirmed by a tap.
  var place: (label: String, path: String)? = nil
  var failed = false

  static func == (a: AssistTurn, b: AssistTurn) -> Bool {
    a.id == b.id && a.text == b.text && a.failed == b.failed && a.docs.count == b.docs.count
  }
}

/// The conversation and the route's answers, for one window.
@MainActor
@Observable
final class AssistConversation {
  private(set) var turns: [AssistTurn] = []
  private(set) var busy = false
  /// The usage line the route last returned: messages left today, or credits this month.
  private(set) var quotaLine: String?
  /// Why the route would not answer (the daily free limit, AI off for the workspace).
  private(set) var refusal: String?
  @ObservationIgnored private var task: Task<Void, Never>?

  func clear() {
    task?.cancel()
    turns = []
    refusal = nil
    busy = false
  }

  /// Asks one question with the page it is asked from (the console's `context`: the route, the site, the workspace).
  func ask(_ question: String, api: ConsoleAPIClient?, orgID: String?, context: (route: String, hostID: String, orgSlug: String)?) {
    let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !busy, let api, let orgID else { return }
    let history: [JSONValue] = turns.filter { !$0.failed && !$0.text.isEmpty }.map {
      .object(["role": .string($0.role.rawValue), "text": .string($0.text)])
    }
    turns.append(AssistTurn(role: .user, text: text))
    turns.append(AssistTurn(role: .assistant, text: ""))
    busy = true
    refusal = nil
    var body: [String: JSONValue] = [
      "orgId": .string(orgID), "question": .string(text), "history": .array(history), "model": .null,
    ]
    if let context {
      body["context"] = .object([
        "route": .string(context.route), "hostId": .string(context.hostID), "orgSlug": .string(context.orgSlug),
      ])
    }
    task = Task { [weak self] in
      do {
        for try await event in api.events("/api/assist/chat", body: .object(body)) {
          self?.receive(event)
        }
      } catch {
        self?.fail(error)
      }
      self?.busy = false
    }
  }

  private func receive(_ event: JSONValue) {
    guard let index = turns.indices.last else { return }
    switch event["type"]?.stringValue {
    case "delta":
      turns[index].text += event["text"]?.stringValue ?? ""
    case "done":
      turns[index].docs = (event["docs"]?.arrayValue ?? []).compactMap { doc in
        guard let title = doc["title"]?.stringValue, let url = doc["url"]?.stringValue else { return nil }
        return (title, url)
      }
      if let proposal = event["proposal"], let path = proposal["path"]?.stringValue ?? proposal["href"]?.stringValue {
        turns[index].place = (proposal["label"]?.stringValue ?? "Open it", path)
      }
      quotaLine = Self.quotaLine(event["quota"])
    case "error":
      turns[index].text = event["error"]?.stringValue ?? "The answer did not come through. Try again."
      turns[index].failed = true
    default: break
    }
  }

  private func fail(_ error: Error) {
    guard let index = turns.indices.last else { return }
    let api = error as? ConsoleAPIError
    let message: String
    switch api?.status {
    case 404: message = "AI is not turned on for this workspace."
    case 429: message = api?.body?["error"]?.stringValue ?? "That is today's free messages used. They come back tomorrow."
    case 423: message = "AI is paused for this workspace right now."
    case 501: message = "AI is not set up on this server."
    default: message = api?.message ?? "The answer did not come through. Check the connection and try again."
    }
    turns[index].text = message
    turns[index].failed = true
    if api?.status == 429 || api?.status == 404 || api?.status == 423 { refusal = message }
  }

  /// The credits strip, in the route's own figures: free messages left today, else credits used this month.
  static func quotaLine(_ quota: JSONValue?) -> String? {
    guard let quota else { return nil }
    if quota["period"]?.stringValue == "day", let left = quota["remaining"]?.numberValue, let limit = quota["limit"]?.numberValue {
      return "\(Int(left)) of \(Int(limit)) free messages left today"
    }
    if let credits = quota["credits"], let used = credits["used"]?.numberValue {
      if let limit = credits["limit"]?.numberValue { return "\(Int(used)) of \(Int(limit)) credits used this month" }
      return "\(Int(used)) credits used this month"
    }
    return nil
  }
}

/// The panel.
struct AssistPanel: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss
  var docked = true
  @State private var question = ""
  @FocusState private var focused: Bool

  private var conversation: AssistConversation { navigation.assist }
  private var scope: ShellScope { ShellScope(model: model, navigation: navigation) }

  /// What the panel is reading: the screen in use and where it is.
  private var looking: String {
    let screen = scope.row(for: navigation.section)?.label ?? (navigation.section == .home ? "Home" : "this page")
    let place = scope.site?.name ?? scope.org?.name
    return [screen, place].compactMap { $0 }.joined(separator: " · ")
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Label("\(model.brandName) AI", systemImage: "sparkles").font(AglynFont.headline)
        Spacer()
        if !conversation.turns.isEmpty {
          Button("New chat") { conversation.clear() }.buttonStyle(.borderless).font(AglynFont.subheadline)
            .accessibilityIdentifier("assist-new-chat")
        }
        if !docked {
          Button("Done") { dismiss() }.buttonStyle(.borderless)
        }
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      HStack(spacing: 6) {
        Image(systemName: "eye").font(.caption)
        Text("Looking at: \(looking)").font(AglynFont.caption).lineLimit(1)
      }
      .foregroundStyle(AglynColor.tint)
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(Capsule().fill(AglynColor.primary.opacity(0.12)))
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 14)
      .accessibilityIdentifier("assist-context")
      Divider().padding(.top, 10)
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            if conversation.turns.isEmpty { suggestions }
            ForEach(conversation.turns) { turn in
              turnView(turn).id(turn.id)
            }
          }
          .padding(14)
        }
        .onChange(of: conversation.turns.last?.text) {
          if let last = conversation.turns.last { proxy.scrollTo(last.id, anchor: .bottom) }
        }
      }
      Divider()
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          TextField("Ask about \(scope.site?.name ?? scope.org?.name ?? "this workspace")", text: $question, axis: .vertical)
            .textFieldStyle(.plain)
            .lineLimit(1...4)
            .focused($focused)
            .onSubmit(send)
            .accessibilityIdentifier("assist-field")
          Button(action: send) {
            Image(systemName: "arrow.up.circle.fill").font(.title2)
          }
          .buttonStyle(.plain)
          .foregroundStyle(AglynColor.tint)
          .disabled(conversation.busy || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          .accessibilityLabel("Send")
          .accessibilityIdentifier("assist-send")
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).fill(AglynColor.page))
        Text(conversation.quotaLine ?? "Questions are free · builds and edits use credits")
          .font(AglynFont.caption).foregroundStyle(.secondary)
          .accessibilityIdentifier("assist-credits")
      }
      .padding(12)
    }
    .background(AglynColor.paper)
  }

  // MARK: Suggestions that fit the screen

  private var suggestions: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Try").font(AglynFont.caption).foregroundStyle(.secondary)
      ForEach(Self.suggestions(for: scope.row(for: navigation.section)?.id, inSite: scope.inSite), id: \.self) { text in
        Button {
          question = text
          send()
        } label: {
          HStack(spacing: 8) {
            Image(systemName: "sparkles").font(.caption).foregroundStyle(AglynColor.tint)
            Text(text).font(AglynFont.subheadline).multilineTextAlignment(.leading)
            Spacer(minLength: 0)
          }
          .padding(10)
          .background(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).strokeBorder(AglynColor.divider))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("assist-suggestion")
      }
    }
  }

  /// A few questions that fit the area on screen, asked of the console's Assist as written.
  static func suggestions(for rowID: String?, inSite: Bool) -> [String] {
    switch rowID {
    case "orders": ["Which orders need me today?", "How do I refund part of an order?", "How do pickup times work?"]
    case "products": ["How do I add a product with sizes?", "How do I track stock?", "How do I put a product on sale?"]
    case "pages": ["How do I add a page to the menu?", "How do I publish a page?", "How do I make a page private?"]
    case "inbox": ["How do I reply to a message?", "How do I turn a message into a lead?", "Where do form answers go?"]
    case "crm": ["How do I add a deal?", "How do I assign a lead?", "How do pipelines work?"]
    case "bookings": ["How do I set my hours?", "How do I take a deposit for a booking?", "How do I block a day off?"]
    default:
      inSite
        ? ["What should I set up next on this site?", "How do I connect my own domain?", "How do I take payments?"]
        : ["How do I invite my team?", "How do I add another site?", "What does my plan include?"]
    }
  }

  // MARK: Turns

  @ViewBuilder
  private func turnView(_ turn: AssistTurn) -> some View {
    if turn.role == .user {
      Text(turn.text)
        .font(AglynFont.body)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(AglynColor.primary.opacity(0.14)))
        .frame(maxWidth: .infinity, alignment: .trailing)
    } else {
      VStack(alignment: .leading, spacing: 8) {
        if turn.text.isEmpty && conversation.busy {
          ProgressView().controlSize(.small)
        } else {
          Text((try? AttributedString(markdown: turn.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(turn.text))
            .font(AglynFont.body)
            .foregroundStyle(turn.failed ? AglynColor.error : Color.primary)
            .textSelection(.enabled)
            .environment(\.openURL, OpenURLAction { url in follow(url) })
        }
        if let place = turn.place {
          Button(place.label) { model.open(place.path, in: navigation) }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        ForEach(turn.docs, id: \.url) { doc in
          Button {
            if let url = URL(string: doc.url) { navigation.openWeb(AglynWebPage(url)) }
          } label: {
            Label(doc.title, systemImage: "book").font(AglynFont.subheadline)
          }
          .buttonStyle(.borderless)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityIdentifier("assist-answer")
    }
  }

  /// A link in an answer: a console path opens its native screen; a web page the in-app browser.
  private func follow(_ url: URL) -> OpenURLAction.Result {
    if url.scheme == nil || url.host == nil {
      model.open(url.absoluteString, in: navigation)
    } else {
      navigation.openWeb(AglynWebPage(url))
    }
    return .handled
  }

  private func send() {
    let text = question
    question = ""
    let site = scope.site
    let orgSlug = model.workspace?.org?.slug ?? ""
    let route =
      "/\(orgSlug)" + (site.map { "/hosts/\($0.subdomain.isEmpty ? $0.id : $0.subdomain)" } ?? "")
      + (scope.row(for: navigation.section).map(Self.consolePath) ?? "")
    conversation.ask(
      text, api: model.api, orgID: model.workspace?.org?.id,
      context: (route: route, hostID: site?.id ?? "", orgSlug: orgSlug))
  }

  /// A row's console path within its scope, from the manifest's console reference.
  static func consolePath(_ row: NativeNavRow) -> String {
    switch row.console.surface {
    case .hostPluginTab, .orgPluginTab: row.console.id
    case .hostPluginSection, .orgPluginSection: row.console.id
    case .setupSection: "/setup/\(row.console.id)"
    default: ""
    }
  }
}
