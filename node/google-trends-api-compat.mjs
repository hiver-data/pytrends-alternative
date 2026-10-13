// JSON-envelope compatibility with google-trends-api 4.9.2. Not a Google client.
const EXPLORE = ['interestOverTime', 'interestByRegion', 'relatedQueries'];
const dateString = d => d.toISOString().slice(0, 10);
const fail = message => { throw new Error(message); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const numeric = (v, name) => typeof v === 'number' && Number.isFinite(v) ? v : fail(`Missing/invalid ${name} in Actor dataset`);
const link = (query, o) => '/trends/explore?' + new URLSearchParams({q: query, geo: o.geo, hl: o.hl});

function normalize(options, trending, clock) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('Supply an options object');
  const allowed = trending ? ['geo', 'hl', 'timezone', 'category'] :
    ['keyword', 'startTime', 'endTime', 'geo', 'hl', 'timezone', 'category', 'property', 'resolution'];
  for (const k of Object.keys(options)) if (!allowed.includes(k)) fail(`Unsupported option: ${k}. Use the Actor directly for this feature.`);
  const o = {...options, geo: options.geo ?? '', hl: options.hl ?? 'en-US', timezone: options.timezone ?? clock().getTimezoneOffset()};
  if (typeof o.geo !== 'string' || (o.geo && !/^[A-Z]{2}(?:-[A-Z0-9]+)*$/.test(o.geo))) fail('geo must be one uppercase country/region code, not an array');
  if (typeof o.hl !== 'string' || !o.hl) fail('hl must be a language string');
  try { new Intl.DateTimeFormat(o.hl); } catch { fail('Unsupported hl locale'); }
  if (!Number.isInteger(o.timezone) || Math.abs(o.timezone) > 1440) fail('timezone must be an integer offset in minutes');
  if (trending) {
    if (!o.geo) fail('Must supply a geographical location (geo)');
    o.category = o.category ?? 'all';
    // The old categories are not identical to Trending Now's taxonomy.
    if (o.category !== 'all') fail('Unsupported category for trending: only all has an equivalent; use Actor trendingCategories');
    return o;
  }
  o.keyword = Array.isArray(o.keyword) ? [...o.keyword] : [o.keyword];
  if (o.keyword.length < 1 || o.keyword.length > 5 || o.keyword.some(k => typeof k !== 'string' || !k.trim()) || new Set(o.keyword).size !== o.keyword.length) fail('keyword requires 1–5 distinct nonempty strings');
  o.property = o.property ?? '';
  if (!['', 'images', 'news', 'youtube', 'froogle'].includes(o.property)) fail('Unsupported property');
  o.category = o.category ?? 0;
  if (!Number.isInteger(o.category) || o.category < 0) fail('category must be a nonnegative integer');
  o.resolution = (o.resolution ?? (o.geo ? 'REGION' : 'COUNTRY'));
  if (typeof o.resolution !== 'string' || !['COUNTRY', 'REGION', 'CITY', 'DMA'].includes(o.resolution.toUpperCase())) fail('Unsupported resolution');
  o.resolution = o.resolution.toUpperCase();
  for (const k of ['startTime', 'endTime']) if (own(options, k) && (!(o[k] instanceof Date) || !Number.isFinite(o[k].getTime()))) fail(`${k} must be a valid Date`);
  let start = o.startTime ?? new Date('2004-01-01');
  let end = o.endTime ?? clock();
  if (start > end) [start, end] = [end, start];
  // Actor supports date ranges, not granularTimeResolution.
  o.range = `${dateString(start)} ${dateString(end)}`;
  delete o.startTime; delete o.endTime;
  return o;
}

function exploreEnvelope(method, rows, o) {
  const selected = o.keyword.map(k => rows.find(r => r.searchTerm === k) ?? fail(`Actor dataset missing requested term: ${k}`));
  if (method === 'relatedQueries') {
    // 4.9.2 selects the first RELATED_QUERIES widget for an array of keywords.
    const q = selected[0].relatedQueries ?? {top: [], rising: []};
    return {default: {rankedList: ['top', 'rising'].map(part => ({rankedKeyword: (q[part] ?? []).map(p => ({
      query: p.query, value: numeric(p.value, 'query value'),
      formattedValue: part === 'rising' ? (p.breakout ? 'Breakout' : p.growth ?? `${p.value}%`) : String(p.value),
      hasData: true, link: link(p.query, o),
    }))}))}};
  }
  const timeline = method === 'interestOverTime';
  const field = timeline ? 'interestOverTime' : 'interestByRegion';
  const key = timeline ? 'timestamp' : 'geoName';
  const maps = selected.map(r => new Map((r[field] ?? []).map(p => [p[key], p])));
  const keys = [...maps[0].keys()];
  if (maps.some(m => m.size !== keys.length || keys.some(k => !m.has(k)))) fail('Compared data are unaligned; cannot invent missing values');
  if (timeline) keys.sort((a, b) => a - b);
  const points = keys.map(k => {
    const ps = maps.map(m => m.get(k));
    const values = ps.map(p => numeric(p.value, field));
    const shared = {value: values, formattedValue: values.map(String), hasData: ps.map(p => timeline ? Boolean(p.hasData) : true)};
    if (timeline) return {...shared, time: String(numeric(k, 'timestamp')), formattedTime: ps[0].label ?? null,
      formattedAxisTime: new Intl.DateTimeFormat(o.hl, {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(new Date(k * 1000)),
      isPartial: ps.some(p => Boolean(p.isPartial))};
    return {...shared, geoCode: ps[0].geoCode ?? null, geoName: k, maxValueIndex: values.indexOf(Math.max(...values)),
      ...(o.resolution === 'CITY' ? {coordinates: null} : {})};
  });
  if (!timeline) points.sort((a, b) => b.value[0] - a.value[0]);
  return {default: timeline ? {timelineData: points, averages: o.keyword.length > 1 && points.length ? o.keyword.map((_, i) => Math.round(points.reduce((s, p) => s + p.value[i], 0) / points.length)) : []} : {geoMapData: points}};
}

function trendingEnvelope(method, rows, o, fetchedAt) {
  const trends = rows.filter(r => r.trend && r.geo === o.geo);
  const day = new Date(new Date(fetchedAt).getTime() - o.timezone * 60000);
  const dayLabel = new Intl.DateTimeFormat(o.hl, {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(day);
  const articles = r => (r.news ?? []).map(n => ({title: n.title, url: n.url, source: n.source, image: null, snippet: null, timeAgo: null}));
  if (method === 'dailyTrends') return {default: {
    trendingSearchesDays: [{date: dateString(day).replaceAll('-', ''), formattedDate: dayLabel,
      trendingSearches: trends.map(r => ({title: {query: r.trend, exploreLink: link(r.trend, o)}, formattedTraffic: r.searchVolumeLabel ?? null,
        relatedQueries: (r.relatedSearches ?? []).map(query => ({query, exploreLink: link(query, o)})), articles: articles(r), image: null, shareUrl: null}))}],
    endDateForNextRequest: null, rssFeedPageUrl: `https://trends.google.com/trending/rss?geo=${encodeURIComponent(o.geo)}`,
  }};
  return {featuredStoryIds: [], trendingStoryIds: trends.map(() => null), storySummaries: {featuredStories: [],
    trendingStories: trends.map(r => ({id: null, title: r.trend, entityNames: [r.trend, ...(r.relatedSearches ?? [])], articles: articles(r), image: null}))},
    date: dateString(day), hideAllImages: true};
}

export function createGoogleTrends({client, token, maxTotalChargeUsd = 1, clock = () => new Date()} = {}) {
  if (typeof maxTotalChargeUsd !== 'number' || !Number.isFinite(maxTotalChargeUsd) || maxTotalChargeUsd <= 0) fail('maxTotalChargeUsd must be positive');
  const cache = new Map();
  async function load(o, trending) {
    const input = trending ? {searchTerms: [], trendingGeos: [o.geo], trendingHours: '24', trendingIncludeNews: true,
      trendingMaxItemsPerCountry: 50, maxItems: 50, language: o.hl, timezoneOffsetMinutes: o.timezone} :
      {searchTerms: o.keyword, compareTerms: true, geo: o.geo, category: String(o.category), searchProperty: {'': 'web', froogle: 'shopping'}[o.property] ?? o.property,
        timeRange: 'all', customTimeRange: o.range, language: o.hl, timezoneOffsetMinutes: o.timezone,
        regionResolution: o.resolution, includeLowVolumeRegions: false, outputs: EXPLORE, trendingGeos: [], maxItems: o.keyword.length};
    const key = JSON.stringify(input);
    if (!cache.has(key)) {
      const promise = (async () => {
        if (!client) {
          const auth = token ?? process.env.APIFY_TOKEN;
          if (!auth) fail('Set APIFY_TOKEN or supply token/client');
          const {ApifyClient} = await import('apify-client');
          client = new ApifyClient({token: auth});
        }
        const run = await client.actor('hiver/google-trends-scraper').call(input, {maxTotalChargeUsd});
        if (run?.status !== 'SUCCEEDED' || !run.defaultDatasetId) fail('Actor run did not succeed; inspect its Apify log');
        const rows = [];
        for await (const row of client.dataset(run.defaultDatasetId).iterateItems()) rows.push(row);
        if (rows.some(r => r.error || r.success === false)) fail('Actor returned error rows; inspect its Apify log');
        if (!trending && o.keyword.some(k => !rows.some(r => r.searchTerm === k))) fail('Actor dataset missing requested terms');
        return {rows, fetchedAt: run.finishedAt ?? clock().toISOString()};
      })();
      cache.set(key, promise);
      promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });
    }
    return cache.get(key);
  }
  const api = {};
  for (const method of [...EXPLORE, 'dailyTrends', 'realTimeTrends']) {
    api[method] = (options, callback) => {
      const promise = (async () => {
        if (callback !== undefined && typeof callback !== 'function') fail('Callback must be a function');
        const trending = !EXPLORE.includes(method);
        const o = normalize(options, trending, clock);
        const {rows, fetchedAt} = await load(o, trending);
        return JSON.stringify(trending ? trendingEnvelope(method, rows, o, fetchedAt) : exploreEnvelope(method, rows, o));
      })();
      if (typeof callback === 'function') { promise.then(value => callback(null, value), error => callback(error)); return undefined; }
      return promise;
    };
  }
  for (const method of ['autoComplete', 'relatedTopics']) api[method] = (options, callback) => {
    const error = new Error(`${method} is unsupported by this shim; use the Actor directly (no autocomplete output; topics unverified)`);
    if (typeof callback === 'function') { queueMicrotask(() => callback(error)); return undefined; }
    return Promise.reject(error);
  };
  return api;
}
export default createGoogleTrends();
