// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The "Also send as texts" switch of the console's Customer notifications
/// card: when an order carries the customer's phone number, each update that
/// is on also goes by text, unless the store switches texts off here. Offered
/// only when the platform can send texts, so the screen never offers a
/// channel that does not exist.
struct CustomerTextsScreen: View {
  let context: NativePluginContext
  @State private var texts: CustomerTexts?
  @State private var store = ObservedDocument()

  var body: some View {
    Group {
      if let texts {
        switch texts.channel {
        case .checking:
          List { SkeletonRows(count: 2) }.aglynListBackground()
        case .unavailable:
          AglynEmptyState(
            "Texts are not set up", systemImage: "message",
            message: "This install has no text provider, so order updates go by email only.")
            .accessibilityIdentifier("texts-unavailable")
        case .notPermitted:
          AglynEmptyState(
            "Ask a site admin or editor", systemImage: "message",
            message: "Only a site admin or editor can change how customers are notified.")
            .accessibilityIdentifier("texts-not-permitted")
        case .failed:
          AglynEmptyState(
            "Could not check texts", systemImage: "exclamationmark.triangle",
            message: "Check the connection and try again."
          ) {
            Button("Try again") { Task { await texts.check() } }.buttonStyle(.borderedProminent)
          }
        case .available:
          form(texts)
        }
      } else {
        List { SkeletonRows(count: 2) }.aglynListBackground()
      }
    }
    .navigationTitle("Customer texts")
    .task(id: context.hostID) {
      guard let hostID = context.hostID else { return }
      let model = CustomerTexts(
        api: ConsoleTextsAPI(api: context.api, hostID: hostID), writer: context.writer, hostID: hostID)
      texts = model
      store.start(context.firestore, storeSettingsPath(hostID))
      await model.check()
    }
    .onDisappear { store.stop() }
  }

  private func form(_ texts: CustomerTexts) -> some View {
    Form {
      if let error = texts.error { Section { AglynNotice(error, tone: .error) } }
      Section {
        Toggle(
          isOn: Binding(
            get: { texts.enabled(store.document?.data) },
            set: { on in Task { await texts.set(on) } })
        ) {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(textsSwitchTitle)
            Text(textsSwitchSupporting).font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        .disabled(texts.saving || !store.ready)
        .accessibilityIdentifier("texts-switch")
      } header: {
        Text("Customer notifications")
      } footer: {
        Text("Order updates reach customers by email. Texts add a second channel for the same updates.")
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
  }
}
