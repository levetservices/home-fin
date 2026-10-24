import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import HomeFinKit

final class UnitTests: XCTestCase {
    func testServerAddresses() {
        XCTAssertEqual(normaliseServerAddress("tv.example.com")?.absoluteString, "https://tv.example.com")
        XCTAssertEqual(normaliseServerAddress(" 192.168.55.30:8096/ ")?.absoluteString, "http://192.168.55.30:8096")
        XCTAssertEqual(normaliseServerAddress("https://tv.example.com/web/")?.absoluteString, "https://tv.example.com")
        XCTAssertNil(normaliseServerAddress("   "))
    }

    func testAuthorizationHeader() {
        let device = DeviceIdentity(id: "abc", name: "Hayden's \"iPhone\"")
        XCTAssertEqual(device.authorization(token: nil), #"MediaBrowser Client="Home Fin", Device="Hayden's iPhone", DeviceId="abc", Version="1.0.0""#)
        XCTAssertTrue(device.authorization(token: "t0k").hasSuffix(#", Token="t0k""#))
    }

    func testJellyfinDates() {
        XCTAssertNotNil(HomePlanner.date("2024-05-01T10:20:30.1234567Z"))
        XCTAssertNotNil(HomePlanner.date("2024-05-01T10:20:30Z"))
        XCTAssertNil(HomePlanner.date(nil))
    }

    func testResumeAndProgress() {
        var item = Item(id: "1", type: "Movie")
        item.runTimeTicks = 600 * 10_000_000
        item.userData = UserItemData(playbackPositionTicks: 150 * 10_000_000, playedPercentage: nil, played: false)
        XCTAssertEqual(item.resumeSeconds, 150)
        XCTAssertEqual(item.progress ?? 0, 0.25, accuracy: 0.001)
        item.userData?.played = true
        XCTAssertEqual(item.resumeSeconds, 0)
    }

    private func film(_ id: String, genres: [String] = ["Drama"], rating: Double = 7, created: Date = .distantPast, backdrop: Bool = true) -> Item {
        var item = Item(id: id, name: "Film \(id)", type: "Movie")
        item.genres = genres
        item.communityRating = rating
        item.dateCreated = ISO8601DateFormatter().string(from: created)
        item.backdropImageTags = backdrop ? ["b\(id)"] : nil
        return item
    }

    func testPlanOrderAndLimits() {
        let now = Date()
        var input = HomeInputs(viewerName: "Hayden")
        input.now = now
        input.catalogue = (1...12).map { film("\($0)", genres: $0 % 2 == 0 ? ["Drama"] : ["Comedy"], rating: Double($0)) }
            + [film("new1", created: now.addingTimeInterval(-3_600)), film("new2", created: now), film("new3", created: now)]
        input.resume = [film("1", genres: ["Comedy"])]
        input.favourites = [film("2", genres: ["Comedy"]), film("3", genres: ["Comedy"])]
        input.trendingSeries = (1...4).map { var s = film("s\($0)"); s.type = "Series"; return s }
        input.trendingMovies = [film("1")]
        input.recentlyPlayed = [film("4", genres: ["Comedy"])]

        let plan = HomePlanner.plan(input)
        let ids = plan.rows.map(\.id)
        XCTAssertEqual(Array(ids.prefix(3)), ["continue", "top10-series", "mylist"])
        XCTAssertEqual(plan.rows.first?.title, "Continue Watching for Hayden")
        XCTAssertFalse(ids.contains("top10-movies"), "a Top 10 needs at least three titles")
        XCTAssertTrue(ids.contains("new"))
        // Comedy is what this viewer watches, so it comes before the (equally big) Drama row.
        let comedy = ids.firstIndex(of: "genre-Comedy") ?? 99
        let drama = ids.firstIndex(of: "genre-Drama") ?? 99
        XCTAssertLessThan(comedy, drama)
        XCTAssertEqual(plan.rows.first { $0.id == "genre-Comedy" }?.title, "Comedy Films")
        // Nothing (outside Top 10 / My List) shows more than twice.
        var counts: [String: Int] = [:]
        for row in plan.rows where row.kind != .top10 && row.id != "mylist" {
            for item in row.items { counts[item.id, default: 0] += 1 }
        }
        XCTAssertLessThanOrEqual(counts.values.max() ?? 0, 2)
    }

    func testBillboardIsStableAndExplained() {
        let now = Date()
        var input = HomeInputs(viewerName: "Alana")
        input.now = now
        input.catalogue = [film("a", rating: 6), film("b", rating: 9), film("c", rating: 5, backdrop: false)]
        var trending = film("t", rating: 6)
        trending.type = "Series"
        input.catalogue.append(trending)
        input.trendingSeries = [trending]

        let first = HomePlanner.plan(input).billboard
        XCTAssertNotNil(first)
        XCTAssertNotEqual(first?.item.id, "c", "titles without artwork are never featured")
        XCTAssertEqual(first, HomePlanner.plan(input).billboard, "same pick all day")
        if first?.item.id == "t" {
            XCTAssertEqual(first?.reasons.first, BillboardReason(kind: .top10, text: "No. 1 in Series Today"))
        }
    }

    func testDeviceProfileAsksForHLS() throws {
        let profile = AppleDeviceProfile.json(maxBitrate: 8_000_000)
        XCTAssertEqual(profile["MaxStreamingBitrate"] as? Int, 8_000_000)
        let transcoding = try XCTUnwrap((profile["TranscodingProfiles"] as? [[String: Any]])?.first)
        XCTAssertEqual(transcoding["Protocol"] as? String, "hls")
        XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: profile))
    }

    private func video(container: String, video: String, audio: String, width: Int) -> Item {
        var item = Item(id: "v1", name: "Clip", type: "Movie")
        item.runTimeTicks = 3600 * 10_000_000
        item.mediaSources = [MediaSource(id: "v1", container: container, size: 1_234_567, mediaStreams: [
            MediaStream(type: "Video", codec: video, index: 0, width: width, height: width * 9 / 16),
            MediaStream(type: "Audio", codec: audio, index: 1)
        ])]
        return item
    }

    func testDownloadSourceKeepsPlayableOriginals() throws {
        let client = JellyfinClient(server: URL(string: "http://tv.local:8096")!, device: DeviceIdentity(id: "d1", name: "t"), token: "tok", userId: "u1")

        let mp4 = client.downloadSource(for: video(container: "mov,mp4,m4a", video: "h264", audio: "aac", width: 1920), quality: .higher)
        XCTAssertTrue(mp4.isOriginal)
        XCTAssertEqual(mp4.url.path, "/Items/v1/Download")
        XCTAssertEqual(mp4.expectedBytes, 1_234_567)

        // Standard doesn't keep a big original: the server makes a 720p copy.
        let standard = client.downloadSource(for: video(container: "mp4", video: "h264", audio: "aac", width: 3840), quality: .standard)
        XCTAssertFalse(standard.isOriginal)

        let mkv = client.downloadSource(for: video(container: "mkv", video: "h264", audio: "aac", width: 1280), quality: .higher)
        XCTAssertFalse(mkv.isOriginal)
        XCTAssertEqual(mkv.url.path, "/Videos/v1/stream.mp4")
        let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: mkv.url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(query["VideoCodec"], "h264")
        XCTAssertEqual(query["AudioCodec"], "aac")
        XCTAssertEqual(query["api_key"], "tok")
        XCTAssertEqual(query["MaxWidth"], "1920")
        // An hour at 7.16 Mbps ≈ 3.2 GB.
        XCTAssertEqual(Double(mkv.expectedBytes ?? 0), 3_222_000_000, accuracy: 1_000_000)

        let dts = client.downloadSource(for: video(container: "mp4", video: "h264", audio: "dts", width: 1280), quality: .higher)
        XCTAssertFalse(dts.isOriginal, "DTS audio doesn't play on Apple devices")
    }

    func testDownloadStorePersistsAndSyncsState() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hf-downloads-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        var episode = Item(id: "e1", name: "Pilot", type: "Episode")
        episode.seriesId = "s1"
        let store = DownloadStore(directory: directory)
        var record = DownloadRecord(item: episode, series: Item(id: "s1", name: "Deep Orbit", type: "Series"),
                                    fileName: "e1.mp4", quality: .standard, userId: "u1")
        record.bytesExpected = 1000
        store.upsert(record)
        try Data(repeating: 7, count: 400).write(to: store.fileURL(for: record))
        store.update("e1") { $0.bytesWritten = 400; $0.state = .downloading }
        XCTAssertEqual(store.record("e1")?.fraction ?? 0, 0.4, accuracy: 0.001)

        store.update("e1") { $0.state = .finished }
        store.savePosition("e1", seconds: 95, played: false)
        store.upsert(DownloadRecord(item: Item(id: "m1", name: "Other", type: "Movie"), fileName: "m1.mp4", quality: .higher, userId: "u2"))

        // A fresh store reads the same index back.
        let reopened = DownloadStore(directory: directory)
        XCTAssertEqual(reopened.all(userId: "u1").map(\.id), ["e1"])
        XCTAssertEqual(reopened.all().count, 2)
        let saved = try XCTUnwrap(reopened.record("e1"))
        XCTAssertTrue(saved.needsSync)
        XCTAssertEqual(saved.playableItem.resumeSeconds, 95, accuracy: 0.01)
        XCTAssertEqual(saved.series?.name, "Deep Orbit")
        XCTAssertEqual(reopened.totalBytes(userId: "u1"), 400)

        reopened.remove("e1")
        XCTAssertNil(reopened.record("e1"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: reopened.fileURL(for: saved).path))
        reopened.removeAll()
        XCTAssertTrue(reopened.all().isEmpty)
    }

    func testScopesFilterHome() {
        var input = HomeInputs(viewerName: "Sam")
        var episode = Item(id: "e1", name: "Pilot", type: "Episode")
        episode.seriesId = "s1"
        input.resume = [episode, film("f1")]
        input.catalogue = (1...6).map { film("m\($0)") } + (1...6).map { Item(id: "s\($0)", name: "Series \($0)", type: "Series") }
        input.trendingMovies = [film("m1"), film("m2"), film("m3")]

        let films = HomePlanner.plan(input.scoped(to: .films))
        XCTAssertTrue(films.rows.flatMap(\.items).allSatisfy(\.isMovie))
        XCTAssertEqual(films.rows.first?.items.map(\.id), ["f1"])
        XCTAssertTrue(films.rows.contains { $0.id == "top10-movies" })

        let series = HomePlanner.plan(input.scoped(to: .series))
        XCTAssertTrue(series.rows.flatMap(\.items).allSatisfy { $0.isSeries || $0.isEpisode })
        XCTAssertFalse(series.rows.contains { $0.id == "top10-movies" })
    }

    func testRibbons() {
        let now = HomePlanner.date("2026-10-24T12:00:00Z")!
        var film = Item(id: "f", name: "New Film", type: "Movie")
        film.dateCreated = "2026-10-20T09:00:00.1234567Z"
        XCTAssertEqual(film.ribbon(now: now), "Recently Added")
        var series = Item(id: "s", name: "Old Show", type: "Series")
        series.dateCreated = "2025-01-01T00:00:00Z"
        series.dateLastMediaAdded = "2026-10-22T00:00:00Z"
        XCTAssertEqual(series.ribbon(now: now), "New Episodes")
        series.dateLastMediaAdded = "2026-08-01T00:00:00Z"
        XCTAssertNil(series.ribbon(now: now))
    }

    func testQualityBadges() {
        var item = video(container: "mkv", video: "hevc", audio: "eac3", width: 3840)
        XCTAssertEqual(item.badges.resolution, "4K")
        item.mediaSources?[0].mediaStreams?[0].videoRangeType = "DOVIWithHDR10"
        item.mediaSources?[0].mediaStreams?.append(MediaStream(type: "Subtitle", codec: "subrip", index: 2))
        XCTAssertTrue(item.badges.dolbyVision)
        XCTAssertFalse(item.badges.hdr)
        XCTAssertTrue(item.badges.subtitles)
        XCTAssertEqual(video(container: "mp4", video: "h264", audio: "aac", width: 1280).badges.resolution, "HD")
        XCTAssertNil(video(container: "mp4", video: "h264", audio: "aac", width: 720).badges.resolution)
    }
}

/// Runs against a real Jellyfin + Home Fin accounts service when HOMEFIN_IT_SERVER is set, e.g.
/// HOMEFIN_IT_SERVER=http://127.0.0.1:8097 HOMEFIN_IT_USER=admin HOMEFIN_IT_PASS=… swift test
final class IntegrationTests: XCTestCase {
    var server: URL!
    let device = DeviceIdentity(id: "homefinkit-tests", name: "HomeFinKit tests")

    override func setUpWithError() throws {
        guard let value = ProcessInfo.processInfo.environment["HOMEFIN_IT_SERVER"], let url = URL(string: value) else {
            throw XCTSkip("set HOMEFIN_IT_SERVER to run against a real server")
        }
        server = url
    }

    func env(_ key: String) throws -> String {
        guard let value = ProcessInfo.processInfo.environment[key] else { throw XCTSkip("set \(key)") }
        return value
    }

    func signedInJellyfin() async throws -> JellyfinClient {
        let client = JellyfinClient(server: server, device: device)
        let auth = try await client.authenticate(username: try env("HOMEFIN_IT_USER"), password: try env("HOMEFIN_IT_PASS"))
        return client.signedIn(token: auth.accessToken, userId: auth.user.id)
    }

    func testServerAndJellyfinSignIn() async throws {
        let info = try await JellyfinClient(server: server, device: device).publicInfo()
        XCTAssertNotNil(info.version)
        let jellyfin = try await signedInJellyfin()
        let me = try await jellyfin.currentUser()
        let expected = try env("HOMEFIN_IT_USER")
        XCTAssertEqual(me.name, expected)

        do {
            _ = try await JellyfinClient(server: server, device: device).authenticate(username: "nobody", password: "wrong")
            XCTFail("bad sign-in should throw")
        } catch let error as HomeFinError {
            XCTAssertEqual(error.status, 401)
        }
    }

    func testHomePlanFromTheServer() async throws {
        let jellyfin = try await signedInJellyfin()
        let accounts = AccountsClient(server: server, jellyfinToken: jellyfin.token)
        let plan = try await HomeLoader(jellyfin: jellyfin, accounts: accounts).load(viewerName: "Tester")
        XCTAssertFalse(plan.rows.isEmpty)
        XCTAssertNotNil(plan.billboard)
        let item = try XCTUnwrap(plan.rows.first?.items.first)
        XCTAssertNotNil(jellyfin.landscapeURL(item))
        print("rows:", plan.rows.map { "\($0.title) (\($0.items.count))" })
    }

    func testPlaybackPlanStreamsAndReportsProgress() async throws {
        let jellyfin = try await signedInJellyfin()
        let films = try await jellyfin.items(["IncludeItemTypes": "Movie", "Limit": "1", "SortBy": "SortName"])
        let film = try XCTUnwrap(films.first)
        let plan = try await jellyfin.playbackPlan(for: film, maxBitrate: 8_000_000, startSeconds: 0)
        print("playback:", plan.playMethod, plan.url.absoluteString.prefix(120))

        // The URL AVPlayer would open must actually serve something.
        var request = URLRequest(url: plan.url)
        request.setValue("bytes=0-1023", forHTTPHeaderField: "Range")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        XCTAssertTrue((200..<300).contains(status), "stream answered \(status)")
        XCTAssertFalse(data.isEmpty)
        if plan.playMethod == "Transcode" {
            XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("#EXTM3U"), "HLS playlist expected")
        }

        // Jellyfin shows what this device is playing while it reports progress. (Resume points
        // themselves are only kept for titles over 5 minutes, which test clips aren't.)
        await jellyfin.reportStart(plan, seconds: 0)
        await jellyfin.reportProgress(plan, seconds: 4, paused: false)
        struct Session: Decodable {
            var NowPlayingItem: Item?
            var PlayState: [String: AnyCodable]?
        }
        struct AnyCodable: Decodable {}
        let playing: [Session] = try await jellyfin.get("/Sessions", ["deviceId": device.id])
        XCTAssertEqual(playing.first?.NowPlayingItem?.id, film.id, "Jellyfin sees this device playing the film")
        await jellyfin.reportStopped(plan, seconds: 4)
        let stopped: [Session] = try await jellyfin.get("/Sessions", ["deviceId": device.id])
        XCTAssertNil(stopped.first?.NowPlayingItem, "and stopping clears it")
    }

    func testDownloadsAndOfflineSync() async throws {
        let jellyfin = try await signedInJellyfin()
        let films = try await jellyfin.items(["IncludeItemTypes": "Movie", "Limit": "1", "SortBy": "SortName"])
        let film = try await jellyfin.item(try XCTUnwrap(films.first).id)
        XCTAssertNotNil(film.mediaSources?.first?.video, "item(_:) brings media streams")

        // Whichever way the file comes, the first bytes are a real MP4 / MOV (or the original container).
        for quality in DownloadQuality.allCases {
            let source = jellyfin.downloadSource(for: film, quality: quality)
            var request = URLRequest(url: source.url)
            request.timeoutInterval = 60
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            XCTAssertEqual(status, 200, "\(quality) download answered \(status)")
            XCTAssertGreaterThan(data.count, 10_000)
            if !source.isOriginal {
                XCTAssertEqual(String(decoding: data[4..<8], as: UTF8.self), "ftyp", "converted downloads are MP4")
            }
            print("download \(quality):", source.isOriginal ? "original" : "converted", data.count, "bytes")
        }

        // Watching offline, then syncing, sets the server's resume point; position 0 clears it.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hf-it-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DownloadStore(directory: directory)
        store.upsert(DownloadRecord(item: film, fileName: "f.mp4", quality: .standard, userId: try XCTUnwrap(jellyfin.userId)))
        store.savePosition(film.id, seconds: 4, played: false)
        let synced = await store.syncPositions(with: jellyfin)
        XCTAssertEqual(synced, 1)
        XCTAssertFalse(try XCTUnwrap(store.record(film.id)).needsSync)
        let after = try await jellyfin.item(film.id)
        XCTAssertEqual(after.userData?.playbackPositionTicks, 40_000_000)
        try await jellyfin.removeFromContinueWatching(after)
        let cleared = try await jellyfin.item(film.id)
        XCTAssertEqual(cleared.userData?.playbackPositionTicks ?? 0, 0)
    }

    func testLibraryExtras() async throws {
        let jellyfin = try await signedInJellyfin()
        let genres = try await jellyfin.genres()
        XCTAssertFalse(genres.isEmpty)
        let inGenre = try await jellyfin.items(inGenre: genres[0])
        XCTAssertTrue(inGenre.allSatisfy { $0.genres?.contains(genres[0]) == true })
        let filmsOnly = try await jellyfin.items(inGenre: genres[0], scope: .films)
        XCTAssertTrue(filmsOnly.allSatisfy(\.isMovie))

        let someSeries = try await jellyfin.items(["IncludeItemTypes": "Series", "Limit": "1"])
        let any = try XCTUnwrap(someSeries.first)
        try await jellyfin.setRating(any.id, likes: true)
        let liked = try await jellyfin.liked()
        XCTAssertTrue(liked.contains { $0.id == any.id })
        try await jellyfin.setRating(any.id, likes: nil)

        let arrivals = try await jellyfin.arrivals(days: 3650)
        XCTAssertFalse(arrivals.isEmpty)
        XCTAssertTrue(arrivals.allSatisfy { $0.isMovie || $0.isSeries })

        let series = try await HomeLoader(jellyfin: jellyfin, accounts: nil).load(viewerName: "T", scope: .series)
        XCTAssertTrue(series.rows.flatMap(\.items).allSatisfy { $0.isSeries || $0.isEpisode })

        // Artwork comes without signing in (the profile picker uses this).
        let (_, response) = try await URLSession.shared.data(from: jellyfin.untaggedImageURL(any.id, .primary, maxWidth: 200))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertTrue(jellyfin.webURL(for: any).absoluteString.hasSuffix("/web/#/details?id=\(any.id)"))

        // The plan lists the source's tracks for the Audio & Subtitles menu.
        let someFilms = try await jellyfin.items(["IncludeItemTypes": "Movie", "Limit": "1"])
        let film = try await jellyfin.item(try XCTUnwrap(someFilms.first).id)
        let plan = try await jellyfin.playbackPlan(for: film, startSeconds: 0)
        XCTAssertFalse(plan.audioStreams.isEmpty)
        XCTAssertEqual(plan.subtitleStreamIndex, -1)
    }

    func testAccountsSignInProfilesAndRequests() async throws {
        let email = try env("HOMEFIN_IT_EMAIL")
        let password = try env("HOMEFIN_IT_EMAIL_PASS")
        let configuration = URLSessionConfiguration.ephemeral
        let session = URLSession(configuration: configuration)
        let accounts = AccountsClient(server: server, session: session)

        let config = try await accounts.config()
        XCTAssertTrue(config.enabled)
        let me = try await accounts.login(email: email, password: password)
        let profile = try XCTUnwrap(me.profiles.first(where: { !$0.locked }))
        let again = try await accounts.me()
        XCTAssertEqual(again.account.email, email, "the cookie keeps us signed in")
        let avatars = try await accounts.avatars()
        XCTAssertFalse(avatars.isEmpty)

        let auth = try await accounts.profileSession(profileId: profile.id, device: device)
        XCTAssertEqual(auth.user.id, profile.jellyfinUserId)
        let jellyfin = JellyfinClient(server: server, device: device).signedIn(token: auth.accessToken, userId: auth.user.id)
        let current = try await jellyfin.currentUser()
        XCTAssertEqual(current.id, profile.jellyfinUserId)

        let viewer = accounts.with(jellyfinToken: auth.accessToken)
        let requestsConfig = try await viewer.requestsConfig()
        if requestsConfig.enabled {
            let results = try await viewer.searchRequests("matrix")
            XCTAssertFalse(results.isEmpty)
            _ = try await viewer.requests()
        }
        await accounts.logout()
        do {
            _ = try await accounts.me()
            XCTFail("signed out")
        } catch let error as HomeFinError {
            XCTAssertEqual(error.status, 401)
        }
    }
}
