Board reference capture for HIVA-318 (comment 813f32fb), 2026-10-13 ~14:30Z.

- Library: google-trends-api@4.9.2 (npm), unmodified, run with Node 22 from a board machine
  outside the sandbox (US residential exit). One call per method, low volume.
- Options for all three: {keyword: "python", geo: "US", startTime: 2026-09-01, endTime: 2026-10-01}
  (same as experiments/b59/capture.mjs).
- Files: live-interestOverTime.json (default.timelineData 31, averages []),
  live-interestByRegion.json (default.geoMapData 51), live-relatedQueries.json (default.rankedList 2: top, rising).
  Each file: {source, capturedAt, method, options, response} where response is JSON.parse of the library's resolved string.
- relatedQueries first returned Google's HTML "Error 429" page twice; it succeeded after a 5-minute wait.
  So the HTML you saw is ordinary per-IP rate limiting on Explore (the VM exit is a Shanghai mobile IP), not a library break.
- dailyTrends / realTimeTrends were not captured: per the issue, 4.9.2 resolves Google's HTML 404 page for them.
