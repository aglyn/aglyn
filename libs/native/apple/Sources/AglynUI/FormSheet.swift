// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A titled form in a sheet: Cancel, and a confirm that runs `save`, holds
/// still while it runs, closes the sheet when it succeeds and shows why it
/// failed in place when it does not. The Kotlin kit's `FormSheet`.
public struct AglynFormSheet<Content: View>: View {
  let title: String
  let confirm: String
  let destructive: Bool
  let canConfirm: Bool
  let save: () async throws -> Void
  let content: Content
  @Environment(\.dismiss) private var dismiss
  @State private var busy = false
  @State private var error: String?

  public init(
    _ title: String, confirm: String = "Save", destructive: Bool = false, canConfirm: Bool = true,
    save: @escaping () async throws -> Void, @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.confirm = confirm
    self.destructive = destructive
    self.canConfirm = canConfirm
    self.save = save
    self.content = content()
  }

  public var body: some View {
    NavigationStack {
      Form {
        if let error { AglynNotice(error, tone: .error) }
        content
      }
      .formStyle(.grouped)
      .navigationTitle(title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "Saving…" : confirm, role: destructive ? .destructive : nil) {
            busy = true
            error = nil
            Task {
              do {
                try await save()
                dismiss()
              } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
              }
              busy = false
            }
          }
          .disabled(busy || !canConfirm)
          .accessibilityIdentifier("form-sheet-confirm")
        }
      }
    }
    .frame(minWidth: 380, minHeight: 420)
  }
}
