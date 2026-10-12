// Google Trends "Trending Now" to CSV, in place of google-trends-api's dailyTrends() and
// realTimeTrends() (Google answers both with an HTML 404 page, so JSON.parse throws
// "Unexpected token '<'"), via the hiver/google-trends-scraper Actor on Apify.
//
//   npm install
//   export APIFY_TOKEN=...   # Apify Console > Settings > API & Integrations
//   node trending-to-csv.mjs US GB DE --hours 24 --max-per-country 25
//
// Writes trending.csv (one row per trending search) and trending_news.csv (one row per news link).
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';

const ACTOR = 'hiver/google-trends-scraper';
const CATEGORIES = {
    autos: '1', beauty: '2', business: '3', entertainment: '4', food: '5', games: '6', health: '7',
    hobbies: '8', jobs: '9', law: '10', politics: '14', science: '15', shopping: '16', sports: '17',
    technology: '18', travel: '19', climate: '20', pets: '13',
};

const { values: opt, positionals: geos } = parseArgs({
    allowPositionals: true,
    options: {
        hours: { type: 'string', default: '24' }, // 4, 24, 48 or 168
        'max-per-country': { type: 'string', default: '25' }, // highest search volume first
        category: { type: 'string', multiple: true, default: [] }, // sports, technology, ... (default all)
        'no-news': { type: 'boolean', default: false }, // skip the news links (faster)
        'max-charge': { type: 'string', default: '0.50' }, // stop the run once it has cost this many USD
    },
});
if (!geos.length) throw new Error('Give at least one country code, e.g. US GB DE.');
if (!['4', '24', '48', '168'].includes(opt.hours)) throw new Error('--hours must be 4, 24, 48 or 168.');
for (const c of opt.category) if (!CATEGORIES[c]) throw new Error(`Unknown category ${c}: ${Object.keys(CATEGORIES).join(', ')}`);
if (!process.env.APIFY_TOKEN) throw new Error('Set APIFY_TOKEN (Apify Console > Settings > API & Integrations).');

const perCountry = Number(opt['max-per-country']);
const input = {
    searchTerms: [], // Trending Now only
    trendingGeos: geos.map((g) => g.toUpperCase()),
    trendingHours: opt.hours,
    trendingMaxItemsPerCountry: perCountry,
    trendingIncludeNews: !opt['no-news'],
    maxItems: perCountry * geos.length,
};
if (opt.category.length) input.trendingCategories = opt.category.map((c) => CATEGORIES[c]);

// APIFY_API_BASE_URL is only for testing against a mock server; leave it unset.
const client = new ApifyClient({ token: process.env.APIFY_TOKEN, baseUrl: process.env.APIFY_API_BASE_URL });
const run = await client.actor(ACTOR).call(input, { maxTotalChargeUsd: Number(opt['max-charge']) });
if (run.status !== 'SUCCEEDED') throw new Error(`Run did not succeed: ${run.status} ${run.statusMessage ?? ''}`);

const { items } = await client.dataset(run.defaultDatasetId).listItems();
const trends = items.filter((r) => r.trend && !r.error);
const failed = items.filter((r) => r.error);

const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const write = (file, header, body) => writeFileSync(file, `${[header, ...body].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`);

write('trending.csv',
    ['geo', 'trend', 'searchVolume', 'searchVolumeLabel', 'increasePercent', 'startedAt', 'endedAt', 'isActive', 'categories', 'relatedSearches'],
    trends.map((r) => [r.geo, r.trend, r.searchVolume, r.searchVolumeLabel, r.increasePercent, r.startedAt, r.endedAt ?? '',
        String(r.isActive).toLowerCase(), (r.categories ?? []).join('; '), (r.relatedSearches ?? []).join('; ')]));

const news = trends.flatMap((r) => (r.news ?? []).map((n) => [r.geo, r.trend, n.title, n.url, n.source]));
write('trending_news.csv', ['geo', 'trend', 'title', 'url', 'source'], news);

console.log(`${trends.length} trending searches, ${news.length} news links, ${failed.length} countries without data (not charged) -> trending.csv, trending_news.csv`);
for (const r of failed) console.log(`  ${r.trendingGeo}: ${r.error}`);
console.log(`Run ${run.id}: ${run.statusMessage}`);
