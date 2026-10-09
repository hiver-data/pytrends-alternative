"""Google Trends to CSV without pytrends, via the hiver/google-trends-scraper Actor on Apify.

    pip install -r requirements.txt
    export APIFY_TOKEN=...   # Apify Console > Settings > API & Integrations
    python trends_to_csv.py python rust golang --geo US --time-range "today 12-m"

Writes three CSV files, like pytrends' interest_over_time(), interest_by_region() and related_queries():
    timeline.csv          date, one column per term (0-100)
    regions.csv           term, geoCode, geoName, value
    related_queries.csv   term, kind (top|rising), query, value, growth
"""
import argparse
import csv
import os
import sys
from decimal import Decimal

from apify_client import ApifyClient

ACTOR = "hiver/google-trends-scraper"


def main() -> None:
    p = argparse.ArgumentParser(description="Google Trends interest over time, by region and related queries to CSV.")
    p.add_argument("terms", nargs="+", help="search terms, e.g. python rust golang")
    p.add_argument("--geo", default="", help="country or region code: US, GB, US-CA (default worldwide)")
    p.add_argument("--time-range", default="today 12-m", help="pytrends timeframe strings: 'today 12-m', 'now 7-d', 'today 5-y'")
    p.add_argument("--compare", action="store_true", help="put up to 5 terms on one shared 0-100 scale")
    p.add_argument("--resolution", default="REGION", choices=["COUNTRY", "REGION", "CITY", "DMA"],
                   help="interest by region granularity (default REGION)")
    p.add_argument("--property", default="web", choices=["web", "youtube", "news", "shopping", "images"],
                   help="Google property, like pytrends gprop (default web)")
    p.add_argument("--max-charge", type=Decimal, default=Decimal("0.50"),
                   help="stop the run once it has cost this many USD (default 0.50)")
    p.add_argument("--out-dir", default=".")
    args = p.parse_args()

    token = os.environ.get("APIFY_TOKEN")
    if not token:
        sys.exit("Set APIFY_TOKEN (Apify Console > Settings > API & Integrations).")

    run_input = {
        "searchTerms": args.terms,
        "geo": args.geo,
        "timeRange": args.time_range,
        "compareTerms": args.compare,
        "regionResolution": args.resolution,
        "searchProperty": args.property,
        "outputs": ["interestOverTime", "interestByRegion", "relatedQueries"],
    }

    # APIFY_API_BASE_URL is only for testing against a mock server; leave it unset.
    client = ApifyClient(token, api_url=os.environ.get("APIFY_API_BASE_URL", "https://api.apify.com"))
    run = client.actor(ACTOR).call(run_input=run_input, max_total_charge_usd=args.max_charge)
    if run is None or run.status != "SUCCEEDED":
        sys.exit(f"Run did not succeed: {run.status if run else 'not started'} {run.status_message if run else ''}")

    rows = list(client.dataset(run.default_dataset_id).iterate_items())
    terms = [r for r in rows if r.get("searchTerm") and not r.get("error")]
    failed = [r for r in rows if r.get("error")]

    # timeline.csv: one row per date, one column per term (like interest_over_time())
    dates, table = [], {}
    for r in terms:
        for pt in r.get("interestOverTime") or []:
            if pt["date"] not in table:
                dates.append(pt["date"])
                table[pt["date"]] = {"date": pt["date"], "isPartial": str(pt.get("isPartial", False)).lower()}
            table[pt["date"]][r["searchTerm"]] = pt["value"]
    names = [r["searchTerm"] for r in terms]
    with open(os.path.join(args.out_dir, "timeline.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["date", *names, "isPartial"])
        w.writeheader()
        w.writerows(table[d] for d in sorted(dates))

    # regions.csv (like interest_by_region())
    with open(os.path.join(args.out_dir, "regions.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["term", "geoCode", "geoName", "value"])
        for r in terms:
            for g in r.get("interestByRegion") or []:
                w.writerow([r["searchTerm"], g.get("geoCode"), g.get("geoName"), g.get("value")])

    # related_queries.csv (like related_queries())
    with open(os.path.join(args.out_dir, "related_queries.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["term", "kind", "query", "value", "growth"])
        for r in terms:
            rq = r.get("relatedQueries") or {}
            for kind in ("top", "rising"):
                for q in rq.get(kind) or []:
                    w.writerow([r["searchTerm"], kind, q.get("query"), q.get("value"), q.get("growth", "")])

    print(f"{len(terms)} terms, {len(dates)} dates, {len(failed)} terms without data (not charged) -> "
          f"timeline.csv, regions.csv, related_queries.csv")
    for r in failed:
        print(f"  {r.get('searchTerm')}: {r.get('error')}")
    for r in terms:
        for warning in r.get("warnings") or []:
            print(f"  {r['searchTerm']}: {warning}")
    print(f"Run {run.id}: {run.status_message}")


if __name__ == "__main__":
    main()
