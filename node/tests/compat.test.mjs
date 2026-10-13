import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import googleTrends, {createGoogleTrends} from '../google-trends-api-compat.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));
const exports = fixture('6Itn82ygcUlXONkhI').rows;
const trending = fixture('ra2MPx1HO1ZfXJSEs').rows;
const references = fixture('4.9.2-readme-envelopes').responses;
const noNetwork = () => { throw new Error('Network forbidden in offline tests'); };
https.request = noNetwork; http.request = noNetwork; net.connect = noNetwork; net.createConnection = noNetwork; globalThis.fetch = noNetwork;
const clock = () => new Date('2026-10-13T00:00:00Z');
function mock(rows = exports, runStatus = 'SUCCEEDED') {
 const calls = [];
 const client = {actor(id) {assert.equal(id, 'hiver/google-trends-scraper'); return {async call(input, options) {
  calls.push({input: structuredClone(input), options}); return {status: runStatus, defaultDatasetId: 'mock', finishedAt: '2026-10-12T13:28:00Z'};
 }};}, dataset(id) {assert.equal(id,'mock'); return {async *iterateItems() {yield* structuredClone(rows);}};}};
 return {api: createGoogleTrends({client,clock}),calls};
}
const options = {keyword: ['python','java'],geo:'GB',property:'youtube',timezone:0,
 startTime:new Date('2025-10-01'),endTime:new Date('2026-10-01')};
function matchesTypePaths(expected, actual, path = '') {
 if (Array.isArray(expected)) { assert.ok(Array.isArray(actual),path); if (expected.length) {
  assert.ok(actual.length > 0,path); actual.forEach(p => matchesTypePaths(expected[0],p,`${path}[]`));
 } return; }
 if (expected && typeof expected === 'object') {assert.ok(actual && typeof actual === 'object',path);
  for (const [k,v] of Object.entries(expected)) {
   // Unavailable legacy pagination marker is explicitly null, never fabricated.
   if (k === 'endDateForNextRequest' || (k === 'geoCode' && actual[k] === null)) {assert.equal(actual[k],null);continue;}
   matchesTypePaths(v,actual[k],`${path}.${k}`);
  } return;
 }
 assert.equal(typeof actual,typeof expected,path);
}
for (const method of ['interestOverTime','interestByRegion']) test(`${method}: README reference key paths/types plus every compared board value`,async () => {
 const {api}=mock();const opts = method === 'interestByRegion' ? {...options,keyword:'coffee',resolution:'CITY'} : options;
 const terms = Array.isArray(opts.keyword) ? opts.keyword : [opts.keyword];
 const value=await api[method](opts);assert.equal(typeof value,'string');const response=JSON.parse(value);
 matchesTypePaths(references[method],response);
 const field=method==='interestOverTime'?'interestOverTime':'interestByRegion';
 const key=method==='interestOverTime'?'timestamp':'geoName';
 const points=response.default[method==='interestOverTime'?'timelineData':'geoMapData'];
 const source=terms.map(k=>exports.find(r=>r.searchTerm===k));
 assert.equal(points.length,source[0][field].length);
 for(const point of points) {
  const id=method==='interestOverTime'?Number(point.time):point.geoName;
  assert.deepEqual(point.value,source.map(r=>r[field].find(p=>p[key]===id).value));
  assert.deepEqual(point.formattedValue,point.value.map(String));
  assert.ok(point.hasData.every(v=>typeof v==='boolean'));
 }
});
test('mapping, laziness, cache across methods/options order and concurrent requests',async()=>{
 const {api,calls}=mock();assert.equal(calls.length,0);
 await Promise.all([api.interestOverTime(options),api.interestByRegion({...options}),api.relatedQueries(Object.fromEntries(Object.entries(options).reverse()))]);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].input,{searchTerms:['python','java'],compareTerms:true,geo:'GB',category:'0',searchProperty:'youtube',timeRange:'all',customTimeRange:'2025-10-01 2026-10-01',language:'en-US',timezoneOffsetMinutes:0,regionResolution:'REGION',includeLowVolumeRegions:false,outputs:['interestOverTime','interestByRegion','relatedQueries'],trendingGeos:[],maxItems:2});
 assert.deepEqual(calls[0].options,{maxTotalChargeUsd:1});
 await api.interestOverTime({...options,property:'news'});assert.equal(calls.length,2);
 assert.ok(options.startTime instanceof Date);
});
test('keyword string, date order, defaults, all mapped options and distinct resolution',async()=>{
 const {api,calls}=mock();await api.interestOverTime({keyword:'python',category:71,hl:'de',timezone:-480,property:'froogle',resolution:'country',startTime:new Date('2026-10-01'),endTime:new Date('2025-10-01')});
 const input=calls[0].input;assert.equal(input.customTimeRange,'2025-10-01 2026-10-01');assert.equal(input.searchProperty,'shopping');assert.equal(input.category,'71');assert.equal(input.language,'de');assert.equal(input.timezoneOffsetMinutes,-480);assert.equal(input.regionResolution,'COUNTRY');
 await api.interestOverTime({keyword:'python'});assert.equal(calls[1].input.customTimeRange,'2004-01-01 2026-10-13');
});
test('CITY preserves known nulls instead of inventing codes or coordinates',async()=>{
 const {api}=mock();const out=JSON.parse(await api.interestByRegion({keyword:'coffee',geo:'GB',category:71,resolution:'CITY'}));
 assert.ok(out.default.geoMapData.length>0);for(const p of out.default.geoMapData){assert.equal(p.coordinates,null);assert.equal(p.geoCode,null);}
});
test('relatedQueries empty on real exports, first keyword like original widget selector',async()=>{
 const {api}=mock();assert.deepEqual(JSON.parse(await api.relatedQueries(options)),{default:{rankedList:[{rankedKeyword:[]},{rankedKeyword:[]}]}});
});
test('relatedQueries populated synthetic parser case, numeric values and Breakout',async()=>{
 const row={searchTerm:'python',relatedQueries:{top:[{query:'dog show 2016',value:100}],rising:[{query:'dog show 2016',value:836500,breakout:true,growth:'Breakout'}]}};
 const {api}=mock([row]);const out=JSON.parse(await api.relatedQueries({keyword:'python'}));matchesTypePaths(references.relatedQueries,out);
 assert.equal(out.default.rankedList[1].rankedKeyword[0].formattedValue,'Breakout');
});
for(const method of ['dailyTrends','realTimeTrends']) test(`${method}: README envelope types, all three real trends and nine news links`,async()=>{
 const {api,calls}=mock(trending);const out=JSON.parse(await api[method]({geo:'US',timezone:0}));matchesTypePaths(references[method],out);
 const items=method==='dailyTrends'?out.default.trendingSearchesDays[0].trendingSearches:out.storySummaries.trendingStories;
 const source=trending.filter(r=>r.trend);assert.equal(items.length,3);
 items.forEach((r,i)=>{assert.equal(method==='dailyTrends'?r.title.query:r.title,source[i].trend);assert.deepEqual(r.articles.map(n=>[n.title,n.url,n.source]),source[i].news.map(n=>[n.title,n.url,n.source]));assert.equal(r.image,null);r.articles.forEach(n=>assert.equal(n.image,null));});
 assert.equal(calls[0].input.trendingIncludeNews,true);assert.deepEqual(calls[0].input.trendingGeos,['US']);
 if(method==='dailyTrends') {assert.equal(out.default.trendingSearchesDays[0].date,'20261012');assert.equal(out.default.endDateForNextRequest,null);} else {assert.equal(out.date,'2026-10-12');assert.equal(out.hideAllImages,true);}
});
test('daily and realtime same-country options share a single cached run',async()=>{
 const {api,calls}=mock(trending);await Promise.all([api.dailyTrends({geo:'US'}),api.realTimeTrends({geo:'US'})]);assert.equal(calls.length,1);
 await api.dailyTrends({geo:'GB'});assert.equal(calls.length,2);
});
test('callback success and error forms do not leave an unhandled rejection',async()=>{
 const {api}=mock();await new Promise((resolve,reject)=>{
  const ret=api.interestOverTime(options,(err,res)=>{if(err)return reject(err);assert.equal(typeof res,'string');resolve();});assert.equal(ret,undefined);
 });
 await new Promise(resolve=>api.dailyTrends({geo:'US',trendDate:new Date()},err=>{assert.match(err.message,/Unsupported option: trendDate/);resolve();}));
});
for(const [opts,pattern] of [[{keyword:'python',agent:{}},/Unsupported option/],[{keyword:'python',granularTimeResolution:true},/Unsupported option/],[{keyword:'python',geo:['US']},/geo/],[{keyword:[]},/keyword/],[{keyword:['python','python']},/keyword/],[{keyword:'python',startTime:'2025-01-01'},/Date/],[{keyword:'python',property:'web'},/property/],[{keyword:'python',resolution:'bogus'},/resolution/],[{keyword:'python',category:'71'},/category/],[{keyword:'python',timezone:1.5},/timezone/],[{keyword:'python',hl:'!'},/hl/]]) test(`reject before run: ${JSON.stringify(opts)}`,async()=>{
 const {api,calls}=mock();await assert.rejects(api.interestOverTime(opts),pattern);assert.equal(calls.length,0);
});
test('unsupported trending filters/history and methods fail clearly',async()=>{
 const {api,calls}=mock();for(const opts of [{},{geo:'US',category:'s'},{geo:'US',ns:20},{geo:'US',trendDate:new Date()}]) await assert.rejects(api.dailyTrends(opts));
 await assert.rejects(api.autoComplete({keyword:'python'}),/unsupported/);await assert.rejects(api.relatedTopics({keyword:'python'}),/unsupported/);assert.equal(calls.length,0);
});
for(const [rows,status,message] of [[[{error:'429'}],'SUCCEEDED',/error rows/],[[], 'FAILED',/did not succeed/],[[],'SUCCEEDED',/missing/]]) test(`fail instead of success: ${status}/${message}`,async()=>{
 const {api,calls}=mock(rows,status);await assert.rejects(api.interestOverTime(options),message);await assert.rejects(api.interestOverTime(options),message);assert.equal(calls.length,2);
});
test('unaligned comparison fails instead of fabricating a value',async()=>{
 const rows=structuredClone(exports);rows.find(r=>r.searchTerm==='java').interestOverTime.pop();const {api}=mock(rows);await assert.rejects(api.interestOverTime(options),/unaligned/);
});
test('default import provides the five methods without google-trends-api installed',()=>{
 for(const k of Object.keys(references))assert.equal(typeof googleTrends[k],'function');
});
let original;
try {original=createRequire(import.meta.url)('google-trends-api');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('optional google-trends-api@4.9.2 reference passthrough parser on frozen README envelopes', {skip: !original},async()=>{
 assert.equal(createRequire(import.meta.url)('google-trends-api/package.json').version,'4.9.2');
 const widgets={widgets:['TIMESERIES','GEO_MAP','RELATED_QUERIES'].map(id=>({id,token:'offline',request:{requestOptions:{}}}))};
 for(const method of Object.keys(references)) {
  https.request=(opts,handler)=>{
   const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{
    const res=new EventEmitter();res.statusCode=200;res.headers={};handler(res);
    const explore=opts.path.startsWith('/trends/api/explore?');res.emit('data',(explore?')]},':")]},\n")+JSON.stringify(explore?widgets:references[method]));res.emit('end');
   });return req;
  };
  try {const out=JSON.parse(await original[method]({keyword:'python',geo:'US'}));assert.deepEqual(out,references[method]);}finally{https.request=noNetwork;}
 }
});
