// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynHardware
import AglynUI
import SwiftUI
import UniformTypeIdentifiers

/// The ZPL file handed to the device.
struct ZplFile: FileDocument {
  static var readableContentTypes: [UTType] { [.plainText] }
  let text: String

  init(text: String) { self.text = text }
  init(configuration: ReadConfiguration) throws {
    text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self)
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}

/// Labels for one product (the console's Labels dialog): the label size, how many of each variant, then the print sheet
/// or a ZPL file for a Zebra.
struct ProductLabelsSheet: View {
  let productName: String
  @State var rows: [ProductLabelRow]
  @State private var sizeID = ContractValues.shared.labelSizes.first?.id ?? ""
  @State private var problem: String?
  @State private var printing = false
  @State private var saving = false
  @Environment(\.dismiss) private var dismiss

  private var labels: [ProductLabel] { rows.map(\.label) }
  private var total: Int { labelCopiesTotal(labels) }
  private var zpl: String { productLabelsZpl(printableLabels(labels), sizeID: sizeID) }

  /// The ZPL, written where the share sheet can pick it up.
  private var zplURL: URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(labelsZplFileName(productName))
    try? Data(zpl.utf8).write(to: url, options: .atomic)
    return url
  }

  var body: some View {
    NavigationStack {
      Form {
        if let problem { AglynNotice(problem, tone: .error) { self.problem = nil } }
        Section {
          Picker("Label size", selection: $sizeID) {
            ForEach(ContractValues.shared.labelSizes, id: \.id) { Text($0.label).tag($0.id) }
          }
          .accessibilityIdentifier("labels-size")
        }
        Section {
          ForEach($rows) { $row in
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text(row.label.detail ?? row.label.name).lineLimit(1)
                Text(row.label.code.isEmpty ? "Add a barcode or SKU to print a label" : row.label.code)
                  .font(AglynFont.caption)
                  .foregroundStyle(row.label.code.isEmpty ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                  .lineLimit(1)
              }
              Spacer()
              TextField("Copies", value: copies($row), format: .number)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(width: 64)
                .disabled(row.label.code.isEmpty)
                .accessibilityLabel("Copies of \(row.label.detail ?? row.label.name)")
                #if os(iOS)
                  .keyboardType(.numberPad)
                #endif
              Stepper("Copies", value: copies($row), in: 0...ContractValues.shared.maxLabelCopies)
                .labelsHidden()
                .disabled(row.label.code.isEmpty)
            }
            .accessibilityIdentifier("labels-row-\(row.variantID)")
          }
        } header: {
          Text("Copies")
        } footer: {
          Text("Print to a label printer at 100% scale, or save ZPL to send straight to a Zebra.")
        }
        Section {
          Button {
            Task { await print() }
          } label: {
            if printing { ProgressView() } else { Label(total == 1 ? "Print 1 label" : "Print \(total) labels", systemImage: "printer") }
          }
          .disabled(total == 0 || printing)
          .accessibilityIdentifier("labels-print")
          Button {
            saving = true
          } label: {
            Label("Save ZPL…", systemImage: "square.and.arrow.down")
          }
          .disabled(total == 0)
          .accessibilityIdentifier("labels-zpl")
          if total > 0 {
            ShareLink(item: zplURL) { Label("Share ZPL…", systemImage: "square.and.arrow.up") }
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Labels — \(productName)")
      .aglynScreenTitle("Labels — \(productName)")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
      }
      .fileExporter(
        isPresented: $saving, document: ZplFile(text: zpl), contentType: .plainText, defaultFilename: labelsZplFileName(productName)
      ) { _ in }
    }
    .aglynSheetMinimumSize(width: 420, height: 440)
    .accessibilityIdentifier("labels-sheet")
  }

  /// A row's copy count, kept within the console's limit as it is typed.
  private func copies(_ row: Binding<ProductLabelRow>) -> Binding<Int> {
    Binding(
      get: { row.wrappedValue.label.code.isEmpty ? 0 : row.wrappedValue.label.copies },
      set: { row.wrappedValue.label.copies = labelCopiesFromInput(Double($0)) })
  }

  private func print() async {
    printing = true
    problem = nil
    defer { printing = false }
    let sheet = labelSheet(labels, sizeID: sizeID)
    if case .failed(let message) = await SystemPrinter.printDocument(.labels(sheet), jobName: "Labels — \(productName)") {
      problem = message
    }
  }
}
