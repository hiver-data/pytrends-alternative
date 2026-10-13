import json
from pathlib import Path
from unittest.mock import Mock
import pytest
import pandas as pd
from pandas.testing import assert_frame_equal
from pytrends_compat import TrendReq, PN_CODES

FIX = Path(__file__).parent / 'fixtures'
ROWS = json.loads((FIX / '6Itn82ygcUlXONkhI.json').read_text())['rows']
TRENDS = json.loads((FIX / 'ra2MPx1HO1ZfXJSEs.json').read_text())['rows']

@pytest.fixture(autouse=True)
def offline(monkeypatch):
    # Any accidentally introduced HTTP request fails, not spends credit.
    import socket
    monkeypatch.setattr(socket.socket, 'connect', lambda *a: pytest.fail('network forbidden'))


def shim(terms, rows=ROWS):
    c = Mock()
    c.actor.return_value.call.return_value = {'status': 'SUCCEEDED', 'defaultDatasetId': 'offline'}
    c.dataset.return_value.iterate_items.side_effect = lambda: iter(rows)
    s = TrendReq(client=c, tz=0)
    s.build_payload(terms, geo='GB', gprop='youtube')
    return s, c


def original(terms, response, kind):
    mod = pytest.importorskip('pytrends.request')
    o = object.__new__(mod.TrendReq)  # bypass constructor cookie/network
    o.kw_list, o.tz, o.geo = terms, 0, 'GB'
    widget = {'request': {}, 'token': 'offline'}
    o.interest_over_time_widget = widget
    o.interest_by_region_widget = widget
    o.related_queries_widget_list = [
        {'request': {'restriction': {'complexKeywordsRestriction': {'keyword': [{'value': t}]}}}, 'token': 'offline'}
        for t in terms]
    o._get_data = Mock(return_value=response)
    return o


@pytest.mark.parametrize('terms', [['python', 'java'], ['coffee']])
def test_timeline_oracle(terms):
    s, c = shim(terms)
    rs = {r['searchTerm']: r for r in ROWS}
    points = rs[terms[0]]['interestOverTime']
    response = {'default': {'timelineData': [
        {'time': str(p['timestamp']), 'value': [rs[t]['interestOverTime'][i]['value'] for t in terms], 'isPartial': p['isPartial']}
        for i, p in enumerate(points)]}}
    o = original(terms, response, 'time')
    assert_frame_equal(s.interest_over_time(), o.interest_over_time())

@pytest.mark.parametrize('code', [False, True])
def test_regions_oracle(code):
    s, c = shim(['coffee'])
    regions = ROWS[2]['interestByRegion']
    # Export has geoCode=None, not original Google coordinates. Assert retained schema.
    response = {'default': {'geoMapData': [dict(p, value=[p['value']]) for p in regions]}}
    o = original(['coffee'], response, 'region')
    assert_frame_equal(s.interest_by_region('CITY', inc_geo_code=code), o.interest_by_region('CITY', inc_geo_code=code))


def test_trending_oracle():
    s, c = shim(['python'], TRENDS)
    titles = [r['trend'] for r in TRENDS if 'trend' in r]
    o = original([], {'united_states': titles}, 'trending')
    assert_frame_equal(s.trending_searches(), o.trending_searches())


def test_missing_related_oracle():
    s, c = shim(['python', 'java'])
    o = original(s.kw_list, {'default': {'rankedList': [{}, {}]}}, 'queries')
    assert s.related_queries() == o.related_queries()


def test_related_parser_nonempty():
    # Synthetic parser edge, explicitly NOT a cloud observation.
    qs = {'top': [{'query': 'python code', 'value': 100}], 'rising': [{'query': 'python 3', 'value': 5000, 'growth': 'Breakout'}]}
    row = dict(ROWS[0], relatedQueries=qs)
    s, c = shim(['python'], [row])
    o = original(['python'], {'default': {'rankedList': [{'rankedKeyword': qs[p]} for p in ['top', 'rising']]}}, 'queries')
    for p in qs:
        assert_frame_equal(s.related_queries()['python'][p], o.related_queries()['python'][p])


def test_cache_mapping_and_reset():
    s, c = shim(['python', 'java'])
    assert c.actor.return_value.call.call_count == 0
    a = s.interest_over_time()
    assert list(a.columns) == ['python', 'java', 'isPartial']
    assert a.index.name == 'date' and a.isPartial.dtype == bool
    s.interest_by_region(); s.related_queries()
    with pytest.raises(NotImplementedError, match='relatedTopics'):
        s.related_topics()
    assert c.actor.return_value.call.call_count == 1
    call = c.actor.return_value.call.call_args.kwargs
    assert call['max_total_charge_usd'] == 1.0
    p = call['run_input']
    assert p['compareTerms'] and len(p['outputs']) == 4
    assert p['searchProperty'] == 'youtube' and p['timezoneOffsetMinutes'] == 0
    s.build_payload(['coffee'], cat=71, timeframe='2025-01-01 2025-06-30', gprop='froogle')
    assert s._payload['customTimeRange'] == '2025-01-01 2025-06-30'
    assert s._payload['category'] == '71' and s._payload['searchProperty'] == 'shopping'
    s.interest_over_time()
    assert c.actor.return_value.call.call_count == 2


def test_region_options_before_first_call():
    s,c = shim(['coffee'])
    assert not s.interest_by_region('CITY', True, True).empty
    assert c.actor.return_value.call.call_args.kwargs['run_input']['includeLowVolumeRegions']
    s.interest_by_region('CITY', True, False)
    with pytest.raises(NotImplementedError, match='regionResolution'):
        s.interest_by_region('REGION')
    assert c.actor.return_value.call.call_count == 1


def test_trending_cache_country_mapping():
    s,c = shim(['python'], TRENDS)
    a=s.trending_searches(); a.iloc[0,0]='mutated'
    assert s.trending_searches().iloc[0,0] != 'mutated'
    assert c.actor.return_value.call.call_count == 1
    s.trending_searches('united_kingdom')
    assert c.actor.return_value.call.call_args.kwargs['run_input']['trendingGeos'] == ['GB']
    assert PN_CODES['south_korea']=='KR'
    with pytest.raises(NotImplementedError, match='trendingGeos'):
        s.trending_searches('not_a_country')

@pytest.mark.parametrize('name', ['today_searches','realtime_trending_searches','top_charts','suggestions','categories','multirange_interest_over_time','get_historical_interest'])
def test_unsupported(name):
    s,c = shim(['python'])
    with pytest.raises(NotImplementedError, match='Actor'):
        getattr(s,name)()
    c.actor.assert_not_called()


def test_errors_not_silently_empty():
    s,c = shim(['python'], [{'searchTerm':'python','error':'Google refusal'}])
    with pytest.raises(RuntimeError, match='Google refusal'):
        s.interest_over_time()
    s,c = shim(['python'], [])
    with pytest.raises(RuntimeError, match='missing'):
        s.related_queries()
    c.actor.return_value.call.return_value={'status':'FAILED'}
    with pytest.raises(RuntimeError, match='succeed'):
        s.interest_over_time()


def test_empty_oracle():
    s,c = shim(['python'], [{'searchTerm':'python','interestOverTime':[], 'interestByRegion':[]}])
    o=original(['python'], {'default': {'timelineData':[], 'geoMapData':[]}}, 'empty')
    assert_frame_equal(s.interest_over_time(), o.interest_over_time())
    assert_frame_equal(s.interest_by_region(), o.interest_by_region())


@pytest.mark.parametrize('key', ['time:python,java', 'time:coffee', 'region:False', 'region:True', 'trending'])
def test_frozen_pytrends_signatures(key):
    from generate_signatures import signature
    expected = json.loads((FIX / 'pytrends-4.9.2-signatures.json').read_text())
    if key.startswith('time:'):
        s,c = shim(key.split(':')[1].split(','))
        result = s.interest_over_time()
    elif key.startswith('region:'):
        s,c = shim(['coffee'])
        result = s.interest_by_region('CITY', inc_geo_code=key.endswith('True'))
    else:
        s,c = shim(['python'], TRENDS)
        result = s.trending_searches()
    assert signature(result) == expected[key]


def test_constructor_legacy_and_charge():
    s=TrendReq(retries=2, backoff_factor=1, proxies=['ignored'], requests_args={'verify':False}, timeout=5, max_total_charge_usd=.25, client=Mock())
    s.build_payload(['python'])
    assert s._payload['searchProperty']=='web' and s._payload['timezoneOffsetMinutes']==360
    assert s.max_total_charge_usd==.25
