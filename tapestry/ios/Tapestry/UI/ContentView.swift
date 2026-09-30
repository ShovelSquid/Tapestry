import SwiftUI
import UIKit
import UniformTypeIdentifiers

// The window: canvas underneath, chrome on top. Header and tool styling follow
// app/main.cpp's drawHeader; on a phone the tools move from the header's right
// edge to a palette at the bottom, where thumbs are.
struct ContentView: View {
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @State private var titleDraft = ""
    @State private var zoomDraft = ""

    private var compact: Bool { sizeClass == .compact }

    var body: some View {
        ZStack {
            CanvasRepresentable(workspace: workspace)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                HeaderBar(compact: compact, onRename: beginRename)
                Readout()
                Spacer(minLength: 0)
                StatusLine()
                if compact {
                    ToolPalette(buttonSize: 40)
                        .padding(10)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.panelEdge, lineWidth: 1))
                        .padding(.bottom, 8)
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(item: $workspace.editor) { target in
            PageEditorView(target: target)
                .environmentObject(workspace)
        }
        .sheet(item: $workspace.sharing) { file in
            ActivityView(items: [file.url])
                .presentationDetents([.medium, .large])
        }
        .alert("Rename tapestry", isPresented: $workspace.isRenamingDocument) {
            TextField("Title", text: $titleDraft)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                let trimmed = titleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { workspace.title = trimmed }
            }
        }
        .alert("Zoom", isPresented: $workspace.isEditingZoom) {
            TextField("Percent", text: $zoomDraft)
                .keyboardType(.decimalPad)
            Button("Cancel", role: .cancel) {}
            Button("Set") { workspace.commitZoom(zoomDraft) }
        } message: {
            Text("Any percentage from 0.0001% to 100,000,000%. Pinching outside 5%–600% walks back gradually.")
        }
        .onChange(of: workspace.isEditingZoom) { _, editing in
            if editing { zoomDraft = String(format: "%g", workspace.camera.zoom * 100) }
        }
        .fileImporter(isPresented: $workspace.isImporting,
                      allowedContentTypes: [.tapestryDocument, .plainText, .data]) { result in
            if case .success(let url) = result { workspace.open(url) }
        }
        .onOpenURL { workspace.open($0) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { workspace.autosave() }
        }
    }

    private func beginRename() {
        titleDraft = workspace.title
        workspace.isRenamingDocument = true
    }
}

// "N pages   Z%" under the header's right edge.
private struct Readout: View {
    @EnvironmentObject private var workspace: Workspace

    var body: some View {
        HStack {
            Spacer()
            Text("\(workspace.world.pages.count) pages   \(String(format: "%g", workspace.camera.zoom * 100))%")
                .font(.system(size: 13).monospacedDigit())
                .foregroundStyle(Theme.readout)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .allowsHitTesting(false)
    }
}

// Transient "saved …" / "opened …" line, bottom-left.
private struct StatusLine: View {
    @EnvironmentObject private var workspace: Workspace

    var body: some View {
        HStack {
            if let status = workspace.status {
                Text(status)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.readout)
                    .transition(.opacity)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .animation(.easeOut(duration: 0.6), value: workspace.status)
        .allowsHitTesting(false)
    }
}

struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
