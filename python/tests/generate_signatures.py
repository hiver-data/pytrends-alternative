"""Frozen output signatures produced by pytrends 4.9.2's own methods, offline.
Run with pytrends installed to regenerate; never calls Google or Apify.
"""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from test_compat import ROWS, TRENDS, original


def signature(df):
    return {'index_name': df.index.name, 'index_dtype': str(df.index.dtype),
            'column_dtype': str(df.columns.dtype), 'columns': list(df.columns),
            'dtypes': [str(t) for t in df.dtypes],
            'index': [str(i) for i in df.index],
            'values': df.astype(object).where(df.notna(), None).values.tolist()}


def generate():
    out = {}
    rs = {r['searchTerm']: r for r in ROWS}
    for terms in [['python','java'], ['coffee']]:
        points = rs[terms[0]]['interestOverTime']
        raw = {'default': {'timelineData': [{'time': str(p['timestamp']), 'value': [rs[t]['interestOverTime'][i]['value'] for t in terms], 'isPartial': p['isPartial']} for i,p in enumerate(points)]}}
        out['time:'+','.join(terms)] = signature(original(terms,raw,'time').interest_over_time())
    for code in [False, True]:
        raw = {'default': {'geoMapData': [dict(p,value=[p['value']]) for p in rs['coffee']['interestByRegion']]}}
        out['region:'+str(code)] = signature(original(['coffee'],raw,'region').interest_by_region('CITY',inc_geo_code=code))
    titles = [r['trend'] for r in TRENDS if 'trend' in r]
    out['trending'] = signature(original([],{'united_states':titles},'trending').trending_searches())
    out['provenance'] = 'pytrends 4.9.2 parsing methods; pandas 3.0.6; board export rows, not live API'
    return out

if __name__ == '__main__':
    print(json.dumps(generate(), indent=2))
