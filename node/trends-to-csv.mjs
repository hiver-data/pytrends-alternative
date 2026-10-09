// Google Trends to CSV without pytrends, via the hiver/google-trends-scraper Actor on Apify.
//
//   npm install
//   export APIFY_TOKEN=...   # Apify Console > Settings > API & Integrations
//   node trends-to-csv.mjs python rust golang --geo US --time-range "today 12-m"
//
// Writes timeline.csv (date, one column per term), regions.csv and related_queries.csv.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';

const ACTOR = 'hiver/google-trends-scraper';

const { values: opt, positionals: terms } = parseArgs({
    allowPositionals: true,
    options: {
        geo: { type: 'string', default: '' }, // US, GB, US-CA (default worldwide)
        'time-range': { type: 'string', default: 'today 12-m' }, // pytrends timeframe strings
        compare: { type: 'boolean', default: false }, // up to 5 terms on one shared 0-100 scale
        resolution: { type: 'string', default: 'REGION' }, // COUNTRY, REGION, CITY or DMA
        property: { type: 'string', default: 'web' }, // web, youtube, news, shopping, images
        'max-charge': { type: 'string', default: '0.50' }, // stop the run once it has cost this many USD
    },
});
if (!terms.length) throw new Error('Give at least one search term, e.g. python rust golang.');
if (!process.env.APIFY_TOKEN) throw new Error('Set APIFY_TOKEN (Apify Console > Settings > API & Integrations).');

const input = {
    searchTerms: terms,
    geo: opt.geo,
    timeRange: opt['time-range'],
    compareTerms: opt.compare,
    regionResolution: opt.resolution,
    searchProperty: opt.property,
    outputs: ['interestOverTime', 'interestByRegion', 'relatedQueries'],
};

// APIFY_API_BASE_URL is only for testing against a mock server; leave it unset.
const client = new ApifyClient({ token: process.env.APIFY_TOKEN, baseUrl: process.env.APIFY_API_BASE_URL });
const run = await client.actor(ACTOR).call(input, { maxTotalChargeUsd: Number(opt['max-charge']) });
if (run.status !== 'SUCCEEDED') throw new Error(`Run did not succeed: ${run.status} ${run.statusMessage ?? ''}`);

const { items } = await client.dataset(run.defaultDatasetId).listItems();
const rows = items.filter((r) => r.searchTerm && !r.error);
const failed = items.filter((r) => r.error);

const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const write = (file, header, body) => writeFileSync(file, `${[header, ...body].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`);

// timeline.csv: like pytrends interest_over_time()
const byDate = new Map();
for (const r of rows) {
    for (const p of r.interestOverTime ?? []) {
        if (!byDate.has(p.date)) byDate.set(p.date, { isPartial: p.isPartial ?? false });
        byDate.get(p.date)[r.searchTerm] = p.value;
    }
}
const names = rows.map((r) => r.searchTerm);
const dates = [...byDate.keys()].sort();
write('timeline.csv', ['date', ...names, 'isPartial'], dates.map((d) => [d, ...names.map((n) => byDate.get(d)[n]), byDate.get(d).isPartial]));

// regions.csv: like interest_by_region()
write('regions.csv', ['term', 'geoCode', 'geoName', 'value'],
    rows.flatMap((r) => (r.interestByRegion ?? []).map((g) => [r.searchTerm, g.geoCode, g.geoName, g.value])));

// related_queries.csv: like related_queries()
write('related_queries.csv', ['term', 'kind', 'query', 'value', 'growth'],
    rows.flatMap((r) => ['top', 'rising'].flatMap((kind) => (r.relatedQueries?.[kind] ?? [])
        .map((q) => [r.searchTerm, kind, q.query, q.value, q.growth ?? '']))));

console.log(`${rows.length} terms, ${dates.length} dates, ${failed.length} terms without data (not charged) -> timeline.csv, regions.csv, related_queries.csv`);
for (const r of failed) console.log(`  ${r.searchTerm}: ${r.error}`);
for (const r of rows) for (const w of r.warnings ?? []) console.log(`  ${r.searchTerm}: ${w}`);
console.log(`Run ${run.id}: ${run.statusMessage}`);
