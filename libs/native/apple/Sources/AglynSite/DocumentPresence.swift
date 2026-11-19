// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

// Who else is in a document right now (the console's `usePresenceSummary` and `DocumentPresenceChips`, AGL-2486):
// `POST /api/presence/summary {hostId}` answers who is in each of a site's documents, rolled up across versions, and a
// row shows their faces beside its name so a reader sees who is already in a page before opening it in the Besigner.
// A snapshot read every 30 seconds while the list is on screen (`SitePagesModel.pollPresence`), never a subscription per row. It fails to nothing: a
// refusal or an error is an empty summary, because this decorates a list and must never make one look broken. The
// Kotlin kit's DocumentPresence.kt.

/// One person in a document: the smallest useful identity (`PresentPerson`).
public struct PresentPerson: Equatable, Identifiable, Sendable {
  public let uid: String
  public let displayName: String
  public let photoURL: String?
  public var id: String { uid }

  public init(uid: String, displayName: String, photoURL: String? = nil) {
    self.uid = uid
    self.displayName = displayName
    self.photoURL = photoURL
  }
}

/// `{ docType: { docId: [person] } }`.
public struct PresenceSummary: Equatable, Sendable {
  public let byType: [String: [String: [PresentPerson]]]

  public init(_ byType: [String: [String: [PresentPerson]]] = [:]) { self.byType = byType }

  /// Who is in one document, across its versions; empty when nobody is.
  public func people(_ docType: String, _ docID: String) -> [PresentPerson] { byType[docType]?[docID] ?? [] }

  init(json: JSONValue?) {
    guard case .object(let types)? = json else {
      self.init()
      return
    }
    var byType: [String: [String: [PresentPerson]]] = [:]
    for (type, docs) in types {
      guard case .object(let byDoc) = docs else { continue }
      for (doc, people) in byDoc {
        let found = people.arrayValue?.compactMap { person -> PresentPerson? in
          guard let uid = person["uid"]?.stringValue, let name = person["displayName"]?.stringValue, !name.isEmpty else { return nil }
          return PresentPerson(uid: uid, displayName: name, photoURL: person["photoURL"]?.stringValue)
        } ?? []
        if !found.isEmpty { byType[type, default: [:]][doc] = found }
      }
    }
    self.init(byType)
  }
}

/// How often a visible list asks again (`PRESENCE_SUMMARY_POLL_MS`).
public let presenceSummaryPollSeconds: UInt64 = 30

/// The summary for a site, or an empty one for any refusal or failure.
public func fetchPresenceSummary(api: ConsoleAPIClient, hostID: String) async -> PresenceSummary {
  guard let answer = try? await api.request("/api/presence/summary", method: .post, body: jsonBody(["hostId": hostID])) else {
    return PresenceSummary()
  }
  return PresenceSummary(json: answer["summary"])
}

/// What the chips say (`presenceChipTooltip`, the document scope): hedged, because the roll-up cannot say WHICH
/// version, and a row that implied "the one you are about to open" would mislead.
public func presenceChipSentence(_ names: [String]) -> String {
  guard let last = names.last else { return "" }
  let who = names.count == 1 ? "\(last) is" : "\(names.dropLast().joined(separator: ", ")) and \(last) are"
  return "\(who) in this document right now — possibly in a different version."
}

/// The faces of who is in a document, overlapped, at most three and "+N" past that (`DocumentPresenceChips`).
struct DocumentPresenceChips: View {
  static let maxChips = 3
  let people: [PresentPerson]
  var size: CGFloat = 20

  var body: some View {
    if !people.isEmpty {
      let shown = Array(people.prefix(Self.maxChips))
      HStack(spacing: -size / 4) {
        ForEach(Array(shown.enumerated()), id: \.element.uid) { index, person in
          AglynAccountAvatar(
            initials: aglynInitials(person.displayName), photoURL: person.photoURL.flatMap(URL.init(string:)), size: size)
            .overlay(Circle().strokeBorder(AglynColor.paper, lineWidth: 1.5))
            .zIndex(Double(shown.count - index))
        }
        if people.count > shown.count {
          Text("+\(people.count - shown.count)").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            .padding(.leading, size / 4 + 2)
        }
      }
      .help(presenceChipSentence(people.map(\.displayName)))
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(presenceChipSentence(people.map(\.displayName)))
      .accessibilityIdentifier("document-presence")
    }
  }
}
