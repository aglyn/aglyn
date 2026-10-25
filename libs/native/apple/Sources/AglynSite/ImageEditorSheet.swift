// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynUI
import CoreGraphics
import SwiftUI

/// The media library's image editor, the native side of the console's: rotate, flip, a crop you drag (optionally locked
/// to a ratio) and a max width, then replace the original or save a copy. The pixels are Core Graphics'
/// (`ImageEditSession`); every number is the console's own arithmetic (`ImageEditSettings`).
///
/// `loadOriginal` fetches the file itself, not the display copy the library shows; `onSave` is handed the edited file and
/// whether it is a copy.
struct ImageEditorSheet: View {
  let fileName: String
  let loadOriginal: () async -> Data?
  let busy: Bool
  let error: String?
  let onCancel: () -> Void
  let onSave: (PickedFile, Bool) -> Void

  private enum Source {
    case loading
    case ready(ImageEditSession)
    case failed(String)
  }

  @State private var source = Source.loading
  @State private var settings = ImageEditSettings()
  @State private var preview: CGImage?
  @State private var dragStart: CGPoint?
  @State private var rendering = false
  @State private var problem: String?

  var body: some View {
    NavigationStack {
      Group {
        switch source {
        case .loading:
          ProgressView("Loading image").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
          Form { Section { AglynNotice(message, tone: .error) }.accessibilityIdentifier("image-edit-failed") }
        case .ready(let session):
          editor(session)
        }
      }
      .navigationTitle("Edit image")
      .aglynScreenTitle("Edit image")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: onCancel).disabled(busy || rendering).accessibilityIdentifier("image-edit-cancel")
        }
        if case .ready(let session) = source {
          ToolbarItem(placement: .primaryAction) {
            Button("Save as copy") { finish(session, asCopy: true) }
              .disabled(busy || rendering)
              .accessibilityIdentifier("image-edit-save-copy")
          }
          ToolbarItem(placement: .confirmationAction) {
            Button {
              finish(session, asCopy: false)
            } label: {
              if busy || rendering { ProgressView().controlSize(.small) } else { Text("Replace original") }
            }
            .disabled(busy || rendering)
            .accessibilityIdentifier("image-edit-replace")
          }
        }
      }
      .interactiveDismissDisabled(busy || rendering)
    }
    .aglynSheetMinimumSize(width: 460, height: 560)
    .task { await open() }
  }

  private func open() async {
    guard case .loading = source else { return }
    guard let data = await loadOriginal() else {
      source = .failed("The image could not be loaded. Check the connection and try again.")
      return
    }
    let session = await Task.detached { ImageEditSession.open(data) }.value
    guard let session else {
      source = .failed("This image's format cannot be edited here. Replace it with a new file instead.")
      return
    }
    source = .ready(session)
    await redraw(session)
  }

  /// The turned, mirrored picture at preview size; the crop is drawn over it.
  private func redraw(_ session: ImageEditSession) async {
    let plan = settings.previewPlan(sourceWidth: session.width, sourceHeight: session.height)
    preview = await Task.detached { session.draw(plan) }.value
  }

  private func finish(_ session: ImageEditSession, asCopy: Bool) {
    let plan = settings.savePlan(sourceWidth: session.width, sourceHeight: session.height, fileName: fileName)
    rendering = true
    problem = nil
    Task {
      let data = await Task.detached { session.render(plan) }.value
      rendering = false
      guard let data else {
        problem = "The edited image could not be saved. It may be too large for this device."
        return
      }
      onSave(
        PickedFile(name: asCopy ? imageEditCopyName(fileName) : fileName, mimeType: imageEditContentType(fileName), data: data), asCopy)
    }
  }

  private func editor(_ session: ImageEditSession) -> some View {
    let (previewW, previewH) = settings.previewSize(sourceWidth: session.width, sourceHeight: session.height)
    return Form {
      Section {
        if let preview {
          Image(decorative: preview, scale: 1)
            .resizable()
            .aspectRatio(CGFloat(previewW) / CGFloat(max(previewH, 1)), contentMode: .fit)
            .frame(maxWidth: 480, maxHeight: 420)
            .overlay { cropLayer(previewW: previewW, previewH: previewH) }
            .frame(maxWidth: .infinity)
            .accessibilityLabel("Preview of \(fileName)")
            .accessibilityIdentifier("image-edit-surface")
        } else {
          ProgressView().frame(maxWidth: .infinity, minHeight: 160)
        }
      } footer: {
        Text("Drag on the picture to set a crop. Pick a ratio first to lock its proportions.")
      }
      Section {
        HStack {
          Button {
            settings.turn(clockwise: false)
            Task { await redraw(session) }
          } label: {
            Label("Rotate left", systemImage: "rotate.left")
          }
          .accessibilityIdentifier("image-edit-rotate-left")
          Spacer()
          Button {
            settings.turn(clockwise: true)
            Task { await redraw(session) }
          } label: {
            Label("Rotate right", systemImage: "rotate.right")
          }
          .accessibilityIdentifier("image-edit-rotate-right")
        }
        .buttonStyle(.aglynSecondary)
        Toggle("Flip horizontally", isOn: Binding(get: { settings.flipH }, set: { settings.flipH = $0; Task { await redraw(session) } }))
          .accessibilityIdentifier("image-edit-flip-h")
        Toggle("Flip vertically", isOn: Binding(get: { settings.flipV }, set: { settings.flipV = $0; Task { await redraw(session) } }))
          .accessibilityIdentifier("image-edit-flip-v")
      }
      Section {
        Picker(
          "Crop ratio",
          selection: Binding(
            get: { imageEditAspects.firstIndex { $0.ratio == settings.aspect } ?? 0 },
            set: { settings.setAspect(imageEditAspects[$0].ratio) })
        ) {
          ForEach(Array(imageEditAspects.enumerated()), id: \.offset) { index, aspect in Text(aspect.label).tag(index) }
        }
        .accessibilityIdentifier("image-edit-ratio")
        if settings.crop != nil {
          Button("Clear crop") { settings.crop = nil }.accessibilityIdentifier("image-edit-clear-crop")
        }
        AglynCountedField(
          "Max width (px)", text: Binding(get: { settings.maxWidth }, set: { settings.setMaxWidth($0) }), supporting: "Blank keeps the size.",
          keyboard: .number)
      }
      if let message = problem ?? error {
        Section { AglynNotice(message, tone: .error) }.accessibilityIdentifier("image-edit-error")
      }
    }
    .formStyle(.grouped)
  }

  /// The crop over the picture: four dimmed bands around it and its outline, and the drag that draws it. A pointer
  /// position becomes a preview pixel, like the console's, however large the picture is shown.
  private func cropLayer(previewW: Int, previewH: Int) -> some View {
    GeometryReader { proxy in
      let width = max(Double(previewW), 1)
      let height = max(Double(previewH), 1)
      let kx = proxy.size.width / CGFloat(width)
      let ky = proxy.size.height / CGFloat(height)
      ZStack {
        if let crop = settings.crop {
          let frame = CGRect(x: crop.x * kx, y: crop.y * ky, width: crop.w * kx, height: crop.h * ky)
          Path { path in
            path.addRect(CGRect(origin: .zero, size: proxy.size))
            path.addRect(frame)
          }
          .fill(Color.black.opacity(0.45), style: FillStyle(eoFill: true))
          .allowsHitTesting(false)
          Rectangle().stroke(Color.white, lineWidth: 1.5)
            .frame(width: frame.width, height: frame.height)
            .position(x: frame.midX, y: frame.midY)
            .allowsHitTesting(false)
        }
        Color.clear
          .contentShape(Rectangle())
          .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .local)
              .onChanged { value in
                guard kx > 0, ky > 0 else { return }
                settings.drag(
                  from: (Double(value.startLocation.x / kx), Double(value.startLocation.y / ky)),
                  to: (Double(value.location.x / kx), Double(value.location.y / ky)), previewWidth: previewW, previewHeight: previewH)
              })
      }
    }
  }
}
