"""pytrends-shaped pandas results from hiver/google-trends-scraper.
No pytrends dependency. Requires pandas and apify-client; APIFY_TOKEN authenticates.
"""
import os
import pandas as pd

# Google daily-trends country names accepted by pytrends (explicit, no guessing).
PN_CODES = dict(zip(
    'united_states united_kingdom argentina australia austria belgium brazil canada chile colombia czech_republic denmark egypt finland france germany greece hong_kong hungary india indonesia ireland israel italy japan kenya malaysia mexico netherlands new_zealand nigeria norway philippines poland portugal romania russia saudi_arabia singapore south_africa south_korea spain sweden switzerland taiwan thailand turkey ukraine vietnam'.split(),
    'US GB AR AU AT BE BR CA CL CO CZ DK EG FI FR DE GR HK HU IN ID IE IL IT JP KE MY MX NL NZ NG NO PH PL PT RO RU SA SG ZA KR ES SE CH TW TH TR UA VN'.split()))


class TrendReq:
    def __init__(self, hl='en-US', tz=360, geo='', timeout=(2, 5), proxies='',
                 retries=0, backoff_factor=0, requests_args=None, *,
                 client=None, token=None, max_total_charge_usd=1.00,
                 region_resolution='COUNTRY', include_low_volume_regions=False):
        # Legacy HTTP settings intentionally ignored: the Actor owns transport.
        self.hl, self.tz, self.geo = hl, tz, geo
        self._client, self._token = client, token
        self.max_total_charge_usd = max_total_charge_usd
        self._region = (region_resolution, bool(include_low_volume_regions))
        self._payload = None
        self._rows = None
        self._trending = {}
        self.kw_list = []

    def build_payload(self, kw_list, cat=0, timeframe='today 5-y', geo='', gprop=''):
        if gprop not in ('', 'images', 'news', 'youtube', 'froogle'):
            raise ValueError('gprop must be empty, images, news, youtube or froogle')
        if not 1 <= len(kw_list) <= 5 or len(set(kw_list)) != len(kw_list):
            raise ValueError('kw_list requires 1 to 5 distinct terms')
        if not isinstance(timeframe, str):
            raise NotImplementedError('Use Actor customTimeRange for a single date range')
        self.kw_list, self.geo = list(kw_list), geo
        self._payload = {
            'searchTerms': list(kw_list), 'compareTerms': True, 'category': str(cat),
            'timeRange': timeframe, 'geo': geo,
            'searchProperty': {'': 'web', 'froogle': 'shopping'}.get(gprop, gprop),
            'language': self.hl, 'timezoneOffsetMinutes': self.tz,
            'outputs': ['interestOverTime', 'interestByRegion', 'relatedQueries', 'relatedTopics'],
            'regionResolution': self._region[0], 'includeLowVolumeRegions': self._region[1],
            'trendingGeos': [], 'maxItems': len(kw_list),
        }
        if len(timeframe.split()) == 2 and timeframe[:4].isdigit():
            self._payload['customTimeRange'] = timeframe
            self._payload['timeRange'] = 'today 12-m'
        self._rows = None

    def _run(self, payload):
        if self._client is None:
            from apify_client import ApifyClient
            token = self._token or os.environ.get('APIFY_TOKEN')
            if not token:
                raise ValueError('Set APIFY_TOKEN or supply token/client')
            self._client = ApifyClient(token)
        run = self._client.actor('hiver/google-trends-scraper').call(
            run_input=payload, max_total_charge_usd=self.max_total_charge_usd)
        if not run or run.get('status') != 'SUCCEEDED':
            raise RuntimeError('Actor run did not succeed; inspect its Apify log')
        rows = list(self._client.dataset(run['defaultDatasetId']).iterate_items())
        failures = [r for r in rows if r.get('error') or r.get('success') is False]
        if failures:
            raise RuntimeError('Actor returned error rows: ' + str(failures[0].get('error', 'see run log')))
        return rows

    def _load(self):
        if self._payload is None:
            raise ValueError('Call build_payload first')
        if self._rows is None:
            rows = self._run(dict(self._payload))
            self._rows = {r['searchTerm']: r for r in rows if r.get('searchTerm') in self.kw_list}
            if set(self._rows) != set(self.kw_list):
                self._rows = None
                raise RuntimeError('Actor dataset missing requested terms; inspect the run log')
        return self._rows

    def interest_over_time(self):
        rows = self._load()
        points = {k: {p['timestamp']: p for p in rows[k].get('interestOverTime', [])} for k in self.kw_list}
        stamps = sorted(set().union(*(set(p) for p in points.values())))
        if not stamps:
            return pd.DataFrame()
        if any(set(p) != set(stamps) for p in points.values()):
            raise RuntimeError('Compared timelines are not aligned; cannot invent missing values')
        # Match pytrends' float seconds conversion, including datetime64[ns].
        index = pd.DatetimeIndex(pd.to_datetime(pd.Series(stamps, dtype='float64'), unit='s'), name='date')
        df = pd.DataFrame({k: [points[k][t]['value'] for t in stamps] for k in self.kw_list}, index=index).astype('int')
        df['isPartial'] = [any(bool(points[k][t].get('isPartial', False)) for k in self.kw_list) for t in stamps]
        return df

    def interest_by_region(self, resolution='COUNTRY', inc_low_vol=False, inc_geo_code=False):
        config = (resolution, bool(inc_low_vol))
        if self._rows is not None and config != self._region:
            raise NotImplementedError('Use Actor regionResolution/includeLowVolumeRegions before the first data call (or a new build_payload)')
        self._region = config
        if self._payload is not None:
            self._payload.update(regionResolution=resolution, includeLowVolumeRegions=bool(inc_low_vol))
        rows = self._load()
        maps = {k: {p['geoName']: p for p in rows[k].get('interestByRegion', [])} for k in self.kw_list}
        names = sorted(set().union(*(set(m) for m in maps.values())))
        if not names:
            return pd.DataFrame()
        if any(set(m) != set(names) for m in maps.values()):
            raise RuntimeError('Compared regions are not aligned; cannot invent missing values')
        index = pd.Index(names, name='geoName')
        df = pd.DataFrame(index=index)
        if inc_geo_code:
            # Actor CITY output retains geoCode=None; original coordinates are unavailable.
            df['geoCode'] = [maps[self.kw_list[0]][n].get('geoCode') for n in names]
        for k in self.kw_list:
            df[k] = pd.Series([maps[k][n]['value'] for n in names], index=index, dtype='int')
        # pytrends starts with integer-valued column labels, then appends names;
        # this preserves an object column Index even with pandas 3 string inference.
        df.columns = pd.Index(list(df.columns), dtype=object)
        return df

    def related_queries(self):
        rows = self._load()
        return {k: {part: (pd.DataFrame(rows[k].get('relatedQueries', {}).get(part, []))[['query', 'value']]
                           if rows[k].get('relatedQueries', {}).get(part) else None)
                    for part in ('top', 'rising')} for k in self.kw_list}

    def related_topics(self):
        rows = self._load()
        if not any(rows[k].get('relatedTopics', {}).get(p) for k in self.kw_list for p in ('top', 'rising')):
            raise NotImplementedError('Use Actor outputs=["relatedTopics"] directly; cloud output is currently empty/unverified')
        return {k: {p: (pd.json_normalize(rows[k].get('relatedTopics', {}).get(p), sep='_')
                        if rows[k].get('relatedTopics', {}).get(p) else None)
                    for p in ('top', 'rising')} for k in self.kw_list}

    def trending_searches(self, pn='united_states'):
        if pn not in PN_CODES:
            raise NotImplementedError('Use Actor trendingGeos with an ISO country code for this pn')
        if pn not in self._trending:
            rows = self._run({'searchTerms': [], 'trendingGeos': [PN_CODES[pn]],
                             'trendingHours': '24', 'trendingIncludeNews': False,
                             'trendingMaxItemsPerCountry': 50, 'maxItems': 50,
                             'language': self.hl, 'timezoneOffsetMinutes': self.tz})
            self._trending[pn] = pd.DataFrame([r['trend'] for r in rows if r.get('trend')])
        return self._trending[pn].copy(deep=True)


def _unsupported(name, hint):
    def method(self, *args, **kwargs):
        raise NotImplementedError(name + ': use Actor ' + hint)
    method.__name__ = name
    return method


for _name, _hint in {
    'today_searches': 'trendingGeos (Trending Now, not the old daily list)',
    'realtime_trending_searches': 'trendingGeos/trendingHours',
    'top_charts': 'trendingGeos (no historical top charts)',
    'suggestions': 'searchTerms (no suggestions output)',
    'categories': 'category (no category-list output)',
    'multirange_interest_over_time': 'customTimeRange in separate runs',
    'get_historical_interest': 'timeRange/customTimeRange in separate runs',
}.items():
    setattr(TrendReq, _name, _unsupported(_name, _hint))
