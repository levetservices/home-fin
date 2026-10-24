import Foundation
import HomeFinKit
import Observation
#if os(iOS)
import UIKit
#endif

/// Netflix-style downloads: films and episodes saved to the device for watching offline. Files
/// come through a background URLSession, so they keep downloading when the app isn't open.
@MainActor
@Observable
final class DownloadManager: NSObject {
    /// Every download for every profile on this device (views filter by the signed-in user).
    private(set) var records: [DownloadRecord] = []

    let store: DownloadStore
    @ObservationIgnored private var session: URLSession!

    static let sessionIdentifier = "app.homefin.downloads"

    override init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var directory = base.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Re-downloadable, so keep it out of iCloud backups.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? directory.setResourceValues(values)
        store = DownloadStore(directory: directory)
        super.init()
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.timeoutIntervalForRequest = 300
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        reload()
        // Anything the app was killed in the middle of starts again.
        Task { await resumeInterrupted() }
    }

    private func reload() {
        records = store.all()
    }

    // MARK: asking

    func records(for userId: String?) -> [DownloadRecord] {
        records.filter { $0.userId == userId }
    }

    func record(_ itemId: String) -> DownloadRecord? {
        records.first { $0.id == itemId }
    }

    /// A finished download's file, for playing offline.
    func localFile(for itemId: String) -> URL? {
        guard let record = record(itemId), record.state == .finished else { return nil }
        let url = store.fileURL(for: record)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func artwork(for record: DownloadRecord) -> URL? {
        store.artworkURL(for: record)
    }

    func bytesUsed(for userId: String?) -> Int64 {
        store.totalBytes(userId: userId)
    }

    // MARK: downloading

    /// Downloads a film or episode (fetches its media details first).
    func download(_ item: Item, jellyfin: JellyfinClient, quality: DownloadQuality, wifiOnly: Bool) async {
        guard record(item.id) == nil || record(item.id)?.state == .failed, let userId = jellyfin.userId else { return }
        let full = (try? await jellyfin.item(item.id)) ?? item
        var series: Item?
        if let seriesId = full.seriesId { series = try? await jellyfin.item(seriesId) }

        let source = jellyfin.downloadSource(for: full, quality: quality)
        var record = DownloadRecord(item: full, series: series, fileName: "\(full.id).\(source.fileExtension)", quality: quality, userId: userId)
        record.bytesExpected = source.expectedBytes
        record.state = .downloading
        store.upsert(record)
        reload()

        var request = URLRequest(url: source.url)
        request.allowsCellularAccess = !wifiOnly
        request.allowsExpensiveNetworkAccess = !wifiOnly
        let task = session.downloadTask(with: request)
        task.taskDescription = full.id
        if let expected = source.expectedBytes { task.countOfBytesClientExpectsToReceive = expected }
        task.resume()

        await saveArtwork(for: full, series: series, jellyfin: jellyfin)
    }

    /// Every episode of a season that isn't downloaded yet.
    func download(episodes: [Item], jellyfin: JellyfinClient, quality: DownloadQuality, wifiOnly: Bool) async {
        for episode in episodes where record(episode.id) == nil {
            await download(episode, jellyfin: jellyfin, quality: quality, wifiOnly: wifiOnly)
        }
    }

    func delete(_ itemId: String) {
        cancelTask(for: itemId)
        store.remove(itemId)
        reload()
    }

    func deleteAll(userId: String?) {
        for record in records(for: userId) { cancelTask(for: record.id) }
        store.removeAll(userId: userId)
        reload()
    }

    private func cancelTask(for itemId: String) {
        session.getAllTasks { tasks in
            tasks.filter { $0.taskDescription == itemId }.forEach { $0.cancel() }
        }
    }

    /// Records left "downloading" with no task behind them (the app was killed) are marked failed
    /// so the viewer can try again.
    private func resumeInterrupted() async {
        let tasks = await session.allTasks
        let running = Set(tasks.compactMap(\.taskDescription))
        for record in store.all() where record.state == .downloading && !running.contains(record.id) {
            store.update(record.id) { $0.state = .failed }
        }
        reload()
    }

    /// Poster and backdrop saved next to the video so the Downloads page works offline.
    private func saveArtwork(for item: Item, series: Item?, jellyfin: JellyfinClient) async {
        let source = item.isEpisode ? item : (series ?? item)
        guard let url = jellyfin.landscapeURL(source, maxWidth: 640, preferEpisodeStill: item.isEpisode) ?? jellyfin.posterURL(item),
              let (data, _) = try? await URLSession.shared.data(from: url) else { return }
        let name = "\(item.id)-art.jpg"
        try? data.write(to: store.directory.appendingPathComponent(name))
        store.update(item.id) { $0.artworkFile = name }
        reload()
    }

    // MARK: watching offline

    func savePosition(_ itemId: String, seconds: Double, played: Bool) {
        store.savePosition(itemId, seconds: seconds, played: played)
        reload()
    }

    /// Positions watched offline → the server (on reconnect, after playing a download).
    func sync(with jellyfin: JellyfinClient) async {
        if await store.syncPositions(with: jellyfin) > 0 { reload() }
    }

    // MARK: delegate hops

    fileprivate func progressed(_ itemId: String, written: Int64, expected: Int64) {
        store.update(itemId) { record in
            record.bytesWritten = written
            if expected > 0 { record.bytesExpected = expected }
            record.state = .downloading
        }
        // Repainting on every chunk is wasteful; a whole-percent change is enough.
        let old = records.first { $0.id == itemId }?.fraction ?? 0
        if let new = store.record(itemId)?.fraction, Int(new * 100) != Int(old * 100) { reload() }
    }

    fileprivate func finished(_ itemId: String, bytes: Int64) {
        store.update(itemId) { record in
            record.state = .finished
            record.bytesWritten = bytes
            record.bytesExpected = bytes
        }
        reload()
    }

    fileprivate func failed(_ itemId: String) {
        store.update(itemId) { $0.state = .failed }
        reload()
    }
}

extension DownloadManager: URLSessionDownloadDelegate {
    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                                totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id = downloadTask.taskDescription else { return }
        Task { @MainActor in self.progressed(id, written: totalBytesWritten, expected: totalBytesExpectedToWrite) }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            Task { @MainActor in self.failed(id) }
            return
        }
        // The temporary file disappears when this returns, so move it now (synchronously).
        guard let record = store.record(id) else { return }
        let destination = store.fileURL(for: record)
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.moveItem(at: location, to: destination)
            let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int64) ?? 0
            Task { @MainActor in self.finished(id, bytes: size) }
        } catch {
            Task { @MainActor in self.failed(id) }
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let id = task.taskDescription else { return }
        // A cancel is the viewer deleting it; anything else failed.
        if (error as? URLError)?.code == .cancelled { return }
        Task { @MainActor in self.failed(id) }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            BackgroundDownloadEvents.completion?()
            BackgroundDownloadEvents.completion = nil
        }
    }
}

/// iOS hands the app a completion handler when it wakes it to finish background downloads; it's
/// called once the session has delivered everything.
@MainActor
enum BackgroundDownloadEvents {
    static var completion: (() -> Void)?
}
