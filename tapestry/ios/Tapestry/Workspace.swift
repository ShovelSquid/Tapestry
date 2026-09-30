import SwiftUI
import UIKit
import UniformTypeIdentifiers

extension UTType {
    static let tapestryDocument = UTType(exportedAs: "com.shovelsquid.tapestry.document")
}

// What the page editor sheet is editing, and which field it opens on.
struct PageEditTarget: Identifiable, Equatable {
    enum Field: Hashable { case title, body }
    let pageId: UInt64
    let field: Field
    var id: UInt64 { pageId }
}

struct SharedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

// The session: model, view state, and the open document. Plays the role of
// app/main.cpp's Session, minus the event loop — UIKit supplies that.
@MainActor
final class Workspace: ObservableObject {
    enum Tool: CaseIterable {
        case select, hand, zoom, brush
    }

    // Model and view state. Any change marks the document dirty so autosave
    // (on backgrounding) has something to write; saves append only deltas, so
    // this is cheap.
    @Published var world = World() { didSet { dirty = true } }
    @Published var camera = Camera() { didSet { dirty = true } }
    @Published var title = "Untitled tapestry" { didSet { dirty = true } }
    @Published var invertScroll = false { didSet { dirty = true } }

    @Published var selectedId: UInt64?
    @Published var tool: Tool = .select
    @Published var editor: PageEditTarget?
    @Published var isRenamingDocument = false
    @Published var isEditingZoom = false
    @Published var isImporting = false
    @Published var sharing: SharedFile?
    @Published private(set) var status: String?
    @Published private(set) var documentURL: URL

    // Set by the canvas on layout. Not published: they change during layout.
    var viewSize: CGSize = .zero
    var chromeInsets = UIEdgeInsets.zero

    private(set) var dirty = false
    private var needsInitialFraming = false
    private var scopedURL: URL?
    private var lastTickDate = Date()
    private var statusTask: Task<Void, Never>?

    // Default size of a fresh note, in world units — same as desktop.
    static let newNoteSize = CGSize(width: 320, height: 220)

    private static let lastDocumentKey = "lastDocument"
    private static let lastBookmarkKey = "lastDocumentBookmark"

    private static var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    init() {
        documentURL = Self.documentsDirectory.appendingPathComponent("workspace.tapestry")
        if let url = Self.restoreLastDocumentURL(), load(url, announce: false) {
            return
        }
        if load(documentURL, announce: false) {
            return
        }
        seedWorld()
        needsInitialFraming = true
        dirty = true
    }

    // MARK: - Viewport

    // The part of the canvas not covered by the header or tool palette.
    var viewport: CGRect {
        CGRect(origin: .zero, size: viewSize).inset(by: chromeInsets)
    }

    func canvasDidLayout() {
        guard viewSize.width > 0, viewSize.height > 0 else { return }
        if needsInitialFraming {
            needsInitialFraming = false
            // A document saved on a large desktop window can open with nothing
            // on a phone screen; frame it rather than showing empty grid.
            let visible = camera.visibleWorldRect(viewSize)
            let anyVisible = world.pages.contains { $0.displayRect.intersects(visible) }
            if !anyVisible { frameAll() }
        }
    }

    func frameAll() {
        guard let bounds = world.contentBounds else {
            resetView()
            return
        }
        let margin = min(60, min(viewport.width, viewport.height) * 0.08)
        camera.frame(bounds, in: viewport, margin: margin)
    }

    // 100%, origin centred — the phone equivalent of desktop's "0".
    func resetView() {
        camera.zoom = 1
        camera.center(on: .zero, in: viewport)
    }

    func centerAtOrigin() {
        camera.center(on: .zero, in: viewport)
    }

    func commitZoom(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "%", with: "")
        guard let percent = Double(trimmed), percent.isFinite, percent > 0 else {
            showStatus("not a zoom: \(text)")
            return
        }
        camera.setZoom(percent / 100, at: CGPoint(x: viewport.midX, y: viewport.midY))
    }

    // MARK: - Pages

    func createNote(atScreen point: CGPoint) {
        let at = camera.screenToWorld(point)
        let size = Self.newNoteSize
        selectedId = world.addPage(kind: .note, title: "Untitled note", body: "",
                                   rect: CGRect(x: at.x - size.width / 2, y: at.y - size.height / 2,
                                                width: size.width, height: size.height))
    }

    func createNoteInView() {
        createNote(atScreen: CGPoint(x: viewport.midX, y: viewport.midY))
        // A note too small to read is not much use; bring it to reading size.
        if camera.zoom < 0.6 {
            camera.setZoom(1, at: CGPoint(x: viewport.midX, y: viewport.midY))
        }
    }

    func deletePage(_ id: UInt64) {
        world.removePage(id: id)
        if selectedId == id { selectedId = nil }
        if editor?.pageId == id { editor = nil }
    }

    func edit(_ id: UInt64, field: PageEditTarget.Field) {
        editor = PageEditTarget(pageId: id, field: field)
    }

    // Brings the settings page forward and into view, creating one if the
    // document has none.
    func revealSettings() {
        var found = world.pages.first(where: { $0.kind == .settings })?.id
        if found == nil {
            let center = camera.screenToWorld(CGPoint(x: viewport.midX, y: viewport.midY))
            let rect = Renderer.settingsPageRect(topLeft: CGPoint(x: center.x - 160, y: center.y - 90))
            found = world.addPage(kind: .settings, title: "Settings", body: "", rect: rect)
        }
        guard let id = found else { return }
        world.bringToFront(id: id)
        world.updatePage(id: id) { $0.minimized = false }
        selectedId = id
        if let page = world.page(id: id) {
            // Make sure the controls are legible and on screen.
            if !Renderer.settingsControlsInteractive(zoom: camera.zoom) || camera.zoom < 0.75 {
                camera.zoom = min(1, viewport.width / (page.rect.width + 32))
            }
            camera.center(on: CGPoint(x: page.rect.midX, y: page.rect.midY), in: viewport)
        }
    }

    func removeLastStroke() {
        guard let last = world.strokes.last else { return }
        world.removeStroke(id: last.id)
    }

    func clearInk() {
        world.removeAllStrokes()
    }

    // MARK: - Documents

    var documentName: String {
        documentURL.deletingPathExtension().lastPathComponent
    }

    @discardableResult
    func save(announce: Bool = true) -> Bool {
        advanceTicks()
        let state = DocumentState(title: title, invertScroll: invertScroll,
                                  panX: camera.pan.x, panY: camera.pan.y, zoom: camera.zoom)
        do {
            try TapestryDocument.save(to: documentURL, state: state, world: world)
            dirty = false
            rememberDocument(documentURL)
            if announce { showStatus("saved \(documentURL.lastPathComponent)") }
            return true
        } catch {
            showStatus("could not save \(documentURL.lastPathComponent)")
            return false
        }
    }

    func autosave() {
        if dirty { save(announce: false) }
    }

    func open(_ url: URL) {
        if url.standardizedFileURL == documentURL.standardizedFileURL { return }
        autosave()
        if load(url, announce: true) {
            rememberDocument(url)
        }
    }

    func newDocument() {
        autosave()
        let url = Self.uniqueURL(named: "Untitled")
        world = World()
        let settings = Renderer.settingsPageRect(topLeft: CGPoint(x: -160, y: -90))
        world.addPage(kind: .settings, title: "Settings", body: "", rect: settings)
        title = "Untitled tapestry"
        invertScroll = false
        selectedId = nil
        editor = nil
        releaseScope()
        documentURL = url
        resetView()
        save(announce: false)
        showStatus("new \(url.lastPathComponent)")
    }

    func share() {
        if save(announce: false) {
            sharing = SharedFile(url: documentURL)
        }
    }

    func showStatus(_ text: String) {
        status = text
        statusTask?.cancel()
        statusTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            self?.status = nil
        }
    }

    // The world advances in 16 ms ticks on desktop. Nothing here simulates
    // yet, so instead of running an idle loop the tick count catches up to
    // wall-clock time at save, keeping delta ticks comparable across apps.
    private func advanceTicks() {
        let now = Date()
        let elapsed = max(0, now.timeIntervalSince(lastTickDate))
        lastTickDate = now
        world.ticks &+= UInt64(elapsed * 1000 / 16)
    }

    private func load(_ url: URL, announce: Bool) -> Bool {
        let scoped = url.startAccessingSecurityScopedResource()
        do {
            let (state, loaded) = try TapestryDocument.load(from: url)
            releaseScope()
            if scoped { scopedURL = url }
            documentURL = url
            world = loaded
            title = state.title
            invertScroll = state.invertScroll
            camera = Camera(pan: CGPoint(x: state.panX, y: state.panY), zoom: state.zoom)
            selectedId = nil
            editor = nil
            dirty = false
            lastTickDate = Date()
            needsInitialFraming = true
            if viewSize != .zero { canvasDidLayout() }
            if announce { showStatus("opened \(url.lastPathComponent)") }
            return true
        } catch {
            if scoped { url.stopAccessingSecurityScopedResource() }
            if announce { showStatus("could not open \(url.lastPathComponent)") }
            return false
        }
    }

    private func releaseScope() {
        scopedURL?.stopAccessingSecurityScopedResource()
        scopedURL = nil
    }

    // Local documents are remembered by name (the container path can move
    // between installs); documents elsewhere by bookmark.
    private func rememberDocument(_ url: URL) {
        let defaults = UserDefaults.standard
        if url.deletingLastPathComponent().standardizedFileURL
            == Self.documentsDirectory.standardizedFileURL {
            defaults.set(url.lastPathComponent, forKey: Self.lastDocumentKey)
            defaults.removeObject(forKey: Self.lastBookmarkKey)
        } else if let bookmark = try? url.bookmarkData() {
            defaults.removeObject(forKey: Self.lastDocumentKey)
            defaults.set(bookmark, forKey: Self.lastBookmarkKey)
        }
    }

    private static func restoreLastDocumentURL() -> URL? {
        let defaults = UserDefaults.standard
        if let name = defaults.string(forKey: lastDocumentKey) {
            return documentsDirectory.appendingPathComponent(name)
        }
        if let bookmark = defaults.data(forKey: lastBookmarkKey) {
            var stale = false
            return try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &stale)
        }
        return nil
    }

    private static func uniqueURL(named base: String) -> URL {
        var url = documentsDirectory.appendingPathComponent("\(base).tapestry")
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = documentsDirectory.appendingPathComponent("\(base) \(n).tapestry")
            n += 1
        }
        return url
    }

    // The starter workspace: the desktop's, with touch-flavoured instructions.
    private func seedWorld() {
        world = World()
        world.addPage(kind: .conversation, title: "Kickoff", body: """
            You: What if plans were places?

            Tapestry: Then planning would be arranging. Put the decision next to \
            the notes that justify it, keep the open questions in view at the \
            edge, and let distance mean what it means on a desk: relevance.

            You: And the pages keep their positions?

            Tapestry: Positions are the document.
            """, rect: CGRect(x: -560, y: -180, width: 440, height: 330))

        world.addPage(kind: .note, title: "How this works", body: """
            Pages occupy world space at real reading size. At 100% zoom this \
            text is as big as text in any other app.

            Zoom out and pages shrink to cards you arrange; zoom in and they \
            become documents you read. The grid coordinates are real — a page's \
            position is readable straight off the canvas.
            """, rect: CGRect(x: -40, y: -220, width: 360, height: 280))

        world.addPage(kind: .note, title: "Try it", body: """
            Drag a page to move it; the — button minimizes it.
            Drag empty space to pan; pinch to zoom.
            Double-tap empty space for a new note.
            Tap a selected page to edit its text.
            The brush draws; Apple Pencil pressure sets the width.
            """, rect: CGRect(x: 40, y: 120, width: 330, height: 210))

        world.addPage(kind: .file, title: "README.md", body: """
            tapestry/README.md — file pages will mirror documents on disk. For \
            now this card is a placeholder for that link.
            """, rect: CGRect(x: -440, y: 230, width: 330, height: 160))

        world.addPage(kind: .settings, title: "Settings", body: "",
                      rect: Renderer.settingsPageRect(topLeft: CGPoint(x: 420, y: -140)))
    }
}
