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

  private static var errorID: String { "form-sheet-error" }

  public var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        Form {
          if let error { AglynNotice(error, tone: .error).id(Self.errorID) }
          content
        }
        .formStyle(.grouped)
        // Why it did not save is read where it is: the form scrolls to it, rather than the new banner pushing the
        // field being typed in under the keyboard.
        .onChange(of: error) { _, error in
          guard error != nil else { return }
          withAnimation { proxy.scrollTo(Self.errorID, anchor: .top) }
        }
      }
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
      // A help or legal link in the form opens on the sheet's own stack, over the form it was opened from.
      .aglynBrowserDestination()
    }
    .aglynSheetMinimumSize(width: 380, height: 420)
  }
}
