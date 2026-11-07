// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * The publisher's OAuth app for each connection a plugin declares (AGL-4196): the console's
 * `ListingConnectionCredentialsCard`, on the listing page the publisher opens from Sell. A plugin that declares a
 * connection signs site owners in with its publisher's own OAuth app, and the platform keeps that app's client ID and
 * secret sealed. This sets, replaces and clears them. It is write-only: the route never answers either value, so all it
 * can show is Set or Not set, and the redirect URI the publisher registers at the provider. The Kotlin plugin's
 * ListingConnectionCredentials.kt draws the same.
 */

/// "Set a listing's connection credentials", the key the credentials route asks of the publishing workspace's member.
let pluginConnectionCredentialsKey = "marketplace.connectionCredentials"

/// The console route that reads, sets and clears a listing's connection credentials.
let pluginConnectionCredentialsRoute = "/api/plugin-connections/credentials"

/// The address a publisher registers at the provider as the OAuth app's redirect URI (`pluginConnectionRedirectUri`).
func pluginConnectionRedirectURI(origin: String) -> String {
  var base = origin
  while base.hasSuffix("/") { base.removeLast() }
  return "\(base)/api/plugin-connections/connect/callback"
}

/// One declared connection's OAuth app, as the route answers it: whether it is set, never its values.
struct PluginConnectionCredentials: Identifiable, Equatable {
  let connectionID: String
  let label: String
  let set: Bool
  let updatedAtMs: Double?
  var id: String { connectionID }

  init?(_ json: JSONValue) {
    guard let connectionID = json["connectionId"]?.stringValue else { return nil }
    self.connectionID = connectionID
    label = json["label"]?.stringValue ?? connectionID
    set = json["set"]?.boolValue ?? false
    updatedAtMs = json["updatedAtMs"]?.numberValue
  }
}

/// The credentials route's answer: whether the deployment can run connections, and each declared connection.
struct PluginConnectionCredentialsAnswer: Equatable {
  let configured: Bool
  let credentials: [PluginConnectionCredentials]

  init(_ json: JSONValue?) {
    configured = json?["configured"]?.boolValue ?? false
    credentials = (json?["credentials"]?.arrayValue ?? []).compactMap(PluginConnectionCredentials.init)
  }
}

/// The credentials route, as the signed-in member.
struct PluginConnectionCredentialsAPI {
  let api: ConsoleAPIClient
  let listingID: String

  func read() async throws -> PluginConnectionCredentialsAnswer {
    PluginConnectionCredentialsAnswer(try await api.request(pluginConnectionCredentialsRoute, query: [("listingId", listingID)]))
  }

  func save(connectionID: String, clientID: String, clientSecret: String) async throws -> PluginConnectionCredentialsAnswer {
    let body: [String: Any] = ["listingId": listingID, "connectionId": connectionID, "clientId": clientID, "clientSecret": clientSecret]
    return PluginConnectionCredentialsAnswer(try await api.request(pluginConnectionCredentialsRoute, method: .post, body: JSONValue.from(body)))
  }

  func clear(connectionID: String) async throws -> PluginConnectionCredentialsAnswer {
    let body: [String: Any] = ["listingId": listingID, "connectionId": connectionID, "clear": true]
    return PluginConnectionCredentialsAnswer(try await api.request(pluginConnectionCredentialsRoute, method: .post, body: JSONValue.from(body)))
  }
}

/// What the listing page knows of its connection credentials: loaded by the page's own task, so these sections need none.
@MainActor @Observable
final class ListingConnectionCredentialsModel {
  var answer: PluginConnectionCredentialsAnswer?
  var loadError: String?
  var refused = false

  func load(_ api: PluginConnectionCredentialsAPI) async {
    do {
      answer = try await api.read()
      loadError = nil
    } catch {
      refused = pluginConnectionRefusalReason(error) == "permission"
      loadError = (error as? ConsoleAPIError)?.message ?? "The connection credentials could not be read. Try again."
    }
  }
}

/// The listing page's connection credentials, for its publisher: one section per connection the latest version declares,
/// and nothing for a listing that declares none.
struct ListingConnectionCredentialsSections: View {
  let context: NativePluginContext
  let model: ListingConnectionCredentialsModel
  let api: PluginConnectionCredentialsAPI

  var body: some View {
    if let loadError = model.loadError {
      Section {
        AglynNotice(loadError, tone: model.refused ? .info : .error)
      } header: {
        Text("Connection credentials")
      }
    } else if let answer = model.answer {
      ForEach(answer.credentials) { entry in
        ListingConnectionCredentialsSection(context: context, entry: entry, configured: answer.configured, api: api) {
          model.answer = $0
        }
      }
    }
  }
}

/// One declared connection's OAuth app: set or not, the redirect URI, and the form that replaces it.
private struct ListingConnectionCredentialsSection: View {
  let context: NativePluginContext
  let entry: PluginConnectionCredentials
  let configured: Bool
  let api: PluginConnectionCredentialsAPI
  let onAnswer: (PluginConnectionCredentialsAnswer) -> Void
  @State private var runner = PluginActionRunner()
  @State private var editing = false
  @State private var clientID = ""
  @State private var clientSecret = ""
  @State private var confirmingClear = false

  private var canSet: Bool { context.canInWorkspace(pluginConnectionCredentialsKey) }
  private var refusal: String { context.refusal(pluginConnectionCredentialsKey) }
  private var redirectURI: String { pluginConnectionRedirectURI(origin: context.api.origin) }

  var body: some View {
    Section {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        HStack(spacing: AglynSpace.one) {
          StatusChip(entry.set ? "Set" : "Not set", tone: entry.set ? .success : .neutral)
            .accessibilityIdentifier("connection-credentials-status-\(entry.connectionID)")
          if entry.set, let updatedAtMs = entry.updatedAtMs {
            Text("Last changed \(pluginConnectionTime(updatedAtMs))").font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        Text(
          entry.set
            ? "Sites sign in to this service with your OAuth app. The client ID and secret are never shown again; replace them to change them."
            : "Until these are set, sites that install your plugin cannot connect this service."
        )
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
        if !configured { AglynNotice(pluginConnectionsNotConfiguredText, tone: .info) }
        if !canSet { AglynNotice(refusal, tone: .info) }
        if let error = runner.error { AglynNotice(error, tone: .error) { runner.error = nil } }
        if let notice = runner.notice { AglynNotice(notice, tone: .success) { runner.notice = nil } }
      }
      LabeledContent("Redirect URI") {
        HStack(spacing: AglynSpace.half) {
          Text(redirectURI).font(AglynFont.caption.monospaced()).textSelection(.enabled).lineLimit(2)
          Button {
            AglynClipboard.copy(redirectURI)
            runner.notice = "Redirect URI copied."
          } label: {
            Image(systemName: "doc.on.doc").accessibilityLabel("Copy the redirect URI")
          }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("connection-credentials-copy-\(entry.connectionID)")
        }
      }
      if editing {
        TextField("Client ID", text: $clientID)
          .autocorrectionDisabled()
          #if os(iOS)
            .textInputAutocapitalization(.never)
          #endif
          .disabled(runner.busy)
          .accessibilityIdentifier("connection-credentials-client-id-\(entry.connectionID)")
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          SecureField("Client secret", text: $clientSecret)
            .disabled(runner.busy)
            .accessibilityIdentifier("connection-credentials-client-secret-\(entry.connectionID)")
          Text("Stored sealed. It cannot be read back, by you or anyone else.").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      actions
    } header: {
      Text("Connection credentials: \(entry.label)")
    } footer: {
      Text("Register this address at the provider as your OAuth app's redirect URI, exactly as shown.")
    }
    .confirmationDialog("Clear the \(entry.label) credentials?", isPresented: $confirmingClear, titleVisibility: .visible) {
      Button("Clear", role: .destructive) { clear() }
    } message: {
      Text("Sites already connected stop syncing, and nobody can connect until you set new ones.")
    }
  }

  @ViewBuilder
  private var actions: some View {
    HStack(spacing: AglynSpace.one) {
      if editing {
        Button(runner.busy ? "Saving…" : "Save") { save() }
          .buttonStyle(.aglynProminent)
          .disabled(runner.busy || clientID.trimmingCharacters(in: .whitespaces).isEmpty || clientSecret.trimmingCharacters(in: .whitespaces).isEmpty)
          .accessibilityIdentifier("connection-credentials-save-\(entry.connectionID)")
        Button("Cancel") { close() }.buttonStyle(.aglynSecondary).disabled(runner.busy)
      } else {
        if entry.set {
          Button("Replace") { editing = true }.buttonStyle(.aglynSecondary).modifier(setControl)
        } else {
          Button("Set credentials") { editing = true }.buttonStyle(.aglynProminent).modifier(setControl)
        }
        if entry.set {
          Button(runner.busy ? "Clearing…" : "Clear", role: .destructive) { confirmingClear = true }
            .buttonStyle(.borderless)
            .disabled(runner.busy || !canSet)
            .help(canSet ? "" : refusal)
            .accessibilityIdentifier("connection-credentials-clear-\(entry.connectionID)")
        }
      }
    }
  }

  /// Set and Replace stay on screen when they cannot be used, off and with the reason (prerequisites are never hidden).
  private var setControl: SetControlModifier {
    SetControlModifier(
      disabled: runner.busy || !canSet || !configured,
      reason: !canSet ? refusal : (!configured ? pluginConnectionsNotConfiguredText : ""),
      identifier: "connection-credentials-set-\(entry.connectionID)")
  }

  private func close() {
    editing = false
    clientID = ""
    clientSecret = ""
  }

  private func save() {
    let id = clientID.trimmingCharacters(in: .whitespacesAndNewlines)
    let secret = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
    runner.run(success: "\(entry.label) credentials saved.") {
      let answer = try await api.save(connectionID: entry.connectionID, clientID: id, clientSecret: secret)
      close()
      onAnswer(answer)
    }
  }

  private func clear() {
    runner.run(success: "\(entry.label) credentials cleared.") {
      onAnswer(try await api.clear(connectionID: entry.connectionID))
    }
  }
}

private struct SetControlModifier: ViewModifier {
  let disabled: Bool
  let reason: String
  let identifier: String

  func body(content: Content) -> some View {
    content.disabled(disabled).help(reason).accessibilityIdentifier(identifier)
  }
}
