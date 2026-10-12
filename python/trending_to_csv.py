"""Google Trends "Trending Now" to CSV, in place of pytrends' trending_searches() and
google-trends-api's dailyTrends(), which Google answers with HTTP 404.

    pip install -r requirements.txt
    export APIFY_TOKEN=...   # Apify Console > Settings > API & Integrations
    python trending_to_csv.py US GB DE --hours 24 --max-per-country 25

Writes two CSV files:
    trending.csv        one row per trending search: geo, trend, searchVolume, increasePercent,
                        startedAt, endedAt, isActive, categories, relatedSearches
    trending_news.csv   one row per news link Google shows for a trend: geo, trend, title, url, source
"""
import argparse
import csv
import os
import sys
from decimal import Decimal

from apify_client import ApifyClient

ACTOR = "hiver/google-trends-scraper"

# Google Trends "Trending Now" category ids (the Actor's trendingCategories values)
CATEGORIES = {
    "autos": "1", "beauty": "2", "business": "3", "entertainment": "4", "food": "5", "games": "6",
    "health": "7", "hobbies": "8", "jobs": "9", "law": "10", "politics": "14", "science": "15",
    "shopping": "16", "sports": "17", "technology": "18", "travel": "19", "climate": "20", "pets": "13",
}


def main() -> None:
    p = argparse.ArgumentParser(description="Google Trends Trending Now by country to CSV.")
    p.add_argument("geos", nargs="+", help="country codes such as US GB DE, or regions such as US-CA")
    p.add_argument("--hours", default="24", choices=["4", "24", "48", "168"],
                   help="how far back Trending Now looks (default 24)")
    p.add_argument("--max-per-country", type=int, default=25,
                   help="highest search volume first (default 25)")
    p.add_argument("--category", action="append", choices=sorted(CATEGORIES), default=[],
                   help="keep only this category; repeat for more (default: all)")
    p.add_argument("--no-news", action="store_true", help="skip the news links (faster)")
    p.add_argument("--max-charge", type=Decimal, default=Decimal("0.50"),
                   help="stop the run once it has cost this many USD (default 0.50)")
    p.add_argument("--out-dir", default=".")
    args = p.parse_args()

    token = os.environ.get("APIFY_TOKEN")
    if not token:
        sys.exit("Set APIFY_TOKEN (Apify Console > Settings > API & Integrations).")

    run_input = {
        "searchTerms": [],  # Trending Now only
        "trendingGeos": [g.upper() for g in args.geos],
        "trendingHours": args.hours,
        "trendingMaxItemsPerCountry": args.max_per_country,
        "trendingIncludeNews": not args.no_news,
        "maxItems": args.max_per_country * len(args.geos),
    }
    if args.category:
        run_input["trendingCategories"] = [CATEGORIES[c] for c in args.category]

    # APIFY_API_BASE_URL is only for testing against a mock server; leave it unset.
    client = ApifyClient(token, api_url=os.environ.get("APIFY_API_BASE_URL", "https://api.apify.com"))
    run = client.actor(ACTOR).call(run_input=run_input, max_total_charge_usd=args.max_charge)
    if run is None or run.status != "SUCCEEDED":
        sys.exit(f"Run did not succeed: {run.status if run else 'not started'} {run.status_message if run else ''}")

    rows = list(client.dataset(run.default_dataset_id).iterate_items())
    trends = [r for r in rows if r.get("trend") and not r.get("error")]
    failed = [r for r in rows if r.get("error")]

    with open(os.path.join(args.out_dir, "trending.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["geo", "trend", "searchVolume", "searchVolumeLabel", "increasePercent", "startedAt",
                    "endedAt", "isActive", "categories", "relatedSearches"])
        for r in trends:
            w.writerow([r.get("geo"), r["trend"], r.get("searchVolume"), r.get("searchVolumeLabel"),
                        r.get("increasePercent"), r.get("startedAt"), r.get("endedAt") or "",
                        str(r.get("isActive")).lower(), "; ".join(r.get("categories") or []),
                        "; ".join(r.get("relatedSearches") or [])])

    links = 0
    with open(os.path.join(args.out_dir, "trending_news.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["geo", "trend", "title", "url", "source"])
        for r in trends:
            for n in r.get("news") or []:
                w.writerow([r.get("geo"), r["trend"], n.get("title"), n.get("url"), n.get("source")])
                links += 1

    print(f"{len(trends)} trending searches, {links} news links, {len(failed)} countries without data "
          f"(not charged) -> trending.csv, trending_news.csv")
    for r in failed:
        print(f"  {r.get('trendingGeo')}: {r.get('error')}")
    print(f"Run {run.id}: {run.status_message}")


if __name__ == "__main__":
    main()
