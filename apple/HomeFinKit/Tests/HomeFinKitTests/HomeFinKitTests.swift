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
