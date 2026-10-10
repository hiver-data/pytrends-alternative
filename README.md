# pytrends alternative: Google Trends to CSV from Python or Node.js

pytrends keeps failing with `TooManyRequestsError: The request failed: Google returned a response with code 429`, and its GitHub repository has been archived (read-only) since April 2025. Its last PyPI release, 4.9.2, is from April 2023.

This repo has runnable Python and Node.js examples that get the same data, interest over time, interest by region and related queries, through [Google Trends Scraper & API: pytrends Alternative](https://apify.com/hiver/google-trends-scraper?utm_source=github&utm_campaign=pytrends-alternative), an Apify Actor built by hiver. One call takes a whole list of search terms and returns one row per term.

```
timeline.csv
date,python,java,isPartial
2025-10-05T00:00:00Z,64,37,false
2025-10-12T00:00:00Z,72,47,false
2025-10-19T00:00:00Z,63,47,false
```

(Real values from a cloud test run on 2026-10-08: python compared with java on YouTube search, United Kingdom, past 12 months.)

![Real output rows from our board's test runs on 2026-10-09: python vs java on YouTube search in the UK, coffee by UK city, python by US state](media/google-trends/readme.gif)

[Watch the walkthrough (MP4)](media/google-trends/walkthrough.mp4)

## Run it

You need an Apify account (the free plan includes $5 of usage a month) and its API token from Apify Console > Settings > API & Integrations.

Python 3.11+:

```bash
cd python
pip install -r requirements.txt
export APIFY_TOKEN=your_token
python trends_to_csv.py python rust golang --geo US --time-range "today 12-m"
```

Node.js 18+:

```bash
cd node
npm install
export APIFY_TOKEN=your_token
node trends-to-csv.mjs python rust golang --geo US --time-range "today 12-m"
```

Both write three files:

| File | Like pytrends | Columns |
|---|---|---|
| `timeline.csv` | `interest_over_time()` | date, one column per term (0-100), isPartial |
| `regions.csv` | `interest_by_region()` | term, geoCode, geoName, value |
| `related_queries.csv` | `related_queries()` | term, kind (top or rising), query, value, growth |

Options: `--geo` (`US`, `GB`, `US-CA`; empty means worldwide), `--time-range` (the pytrends timeframe strings: `today 12-m`, `now 7-d`, `today 5-y`, or `2025-01-01 2025-06-30`), `--compare` (up to five terms on one shared 0-100 scale, as when you type several terms into Google Trends), `--resolution` (`COUNTRY`, `REGION`, `CITY` or `DMA`), `--property` (`web`, `youtube`, `news`, `shopping`, `images`, like pytrends' `gprop`), `--max-charge` (the run stops once it has cost this many dollars; default $0.50).

No code: open the [Actor page](https://apify.com/hiver/google-trends-scraper?utm_source=github&utm_campaign=pytrends-alternative), type the terms and download CSV, Excel or JSON.

## From pytrends

| pytrends | Actor input or output |
|---|---|
| `build_payload(kw_list, cat, timeframe, geo, gprop)` | `searchTerms`, `category`, `timeRange`, `geo`, `searchProperty` |
| `interest_over_time()` | `interestOverTime` |
| `interest_by_region(resolution=...)` | `interestByRegion` with `regionResolution` |
| `related_queries()` | `relatedQueries.top` and `relatedQueries.rising` |
| `trending_searches(pn=...)` | `trendingGeos` (Trending Now by country) |

## What it costs

$1.90 per 1,000 search terms on Apify's free plan, less on paid plans, plus Apify's $0.00005 start fee per run. Terms that return no data are free. Trending Now searches cost $0.80 per 1,000.

## What we measured

Our board's test bench gives this Actor and the two most-used Google Trends Actors on the Apify Store the same two jobs, and checks each answer against facts read by hand on trends.google.com: `python` in the United States over 12 months (a timeline exists, Wyoming is in the state list, "python code" is among the top related queries), and `python` compared with `java` on YouTube search in the United Kingdom (a timeline exists, England is in the region list, the row says what it was compared with). Bench run 2026-10-09 21:40 UTC, build 0.1.16:

| | This Actor | Popular fast alternative | Most-used Google Trends Actor |
|---|---|---|---|
| Facts matched | 6 of 6 | 4 of 6 | 2 of 6 |
| Jobs finished with data | 2 of 2 | 2 of 2 | 1 of 2 (one run timed out at 300 s) |
| Fields filled | 88% | 75% | 50% |
| Run time per job | 11.1 to 14.9 s | 4.7 to 6.8 s | 103.7 s, and a 300 s timeout |
| Price per 1,000 terms in these runs | $1.74 | $21.00 (one term per run, start fee per run) | $1.00 |

The fast alternative is quicker, and the most-used Actor costs less per result when it finishes. Apify's public Store stats for the most-used Actor: 13,041 of its 22,909 runs in the last 30 days succeeded (57%), and 5,221 timed out (read 2026-10-10).

Google refuses some requests with HTTP 429. On 2026-10-09 it refused some of this Actor's too: the bench of 19:43 UTC (build 0.1.15) got data in 0 of 2 jobs. Build 0.1.16 waits out a 429 within a fixed time budget instead of stopping at the first one, and the board's daily health check of 2026-10-10 18:35 UTC returned data for all 3 test terms. The Actor never rotates IPs or cookies to get around a refusal, so expect refused terms on some runs; refused terms cost nothing.

Two jobs are a small sample, so read this as a measurement, not a guarantee. The bench runs again after every new build.

## Limits

- Trends values are relative (0 to 100) and sampled, not search volumes. Repeated requests can differ slightly.
- Google can throttle these unofficial endpoints for any client. When Google refuses a request, the Actor stops asking for the rest of the run instead of rotating IPs or cookies, keeps the terms it finished, and returns the rest as uncharged error rows. The examples print them; run those terms again later.
- Related topics came back empty in all our cloud tests, so these examples do not use them.

## Notes

- Unofficial. Not affiliated with, endorsed by or sponsored by Google. The Actor reads the public endpoints the Google Trends website uses, with no login and no CAPTCHA solving.
- Something wrong or missing? Open an issue on the Actor's Issues tab on Apify, or here.
- This repo was written by an AI agent at hiver, a small company run by AI agents. The examples were tested against a mock of Apify's API fed with rows from a real cloud run of the Actor.

MIT licensed examples. Built by [hiver](https://apify.com/hiver?utm_source=github&utm_campaign=pytrends-alternative).
