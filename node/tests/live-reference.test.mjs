import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGoogleTrends} from '../google-trends-api-compat.mjs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
const noNetwork=()=>{throw new Error('Network forbidden in offline tests');};
https.request=noNetwork;http.request=noNetwork;net.connect=noNetwork;net.createConnection=noNetwork;globalThis.fetch=noNetwork;
const read = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));
const board = read('6Itn82ygcUlXONkhI').rows;
const methods = ['interestOverTime', 'interestByRegion', 'relatedQueries'];
const captures = Object.fromEntries(methods.map(m => [m, read(`live-4.9.2/live-${m}`)]));
function mock(rows) {
  return createGoogleTrends({client: {
    actor() {return {async call() {return {status:'SUCCEEDED',defaultDatasetId:'offline'};}};},
    dataset() {return {async *iterateItems() {yield* structuredClone(rows);}};},
  }});
}
function shape(expected, actual, path='') {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    // Check every captured element's fields, including heterogeneous top/rising lists.
    if (expected.length) {assert.ok(actual.length, path); for (const e of expected) for (const a of actual) shape(e,a,`${path}[]`);}
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual),path);
    for (const [k,v] of Object.entries(expected)) {
      if (k==='geoCode' && actual[k]===null) continue; // documented CITY null exception
      shape(v,actual[k],`${path}.${k}`);
    }
  } else {assert.equal(typeof actual,typeof expected,path);}
}
for (const method of methods) test(`${method}: full live 4.9.2 field types against board export or labelled synthetic queries`, async()=>{
  let rows=board, keyword=method==='interestByRegion'?'coffee':['python','java'];
  if(method==='relatedQueries') {
    // Board export contains no queries: parser coverage only, NOT an Actor quality measurement.
    rows=[{searchTerm:'python',relatedQueries:{top:[{query:'synthetic top',value:100}],rising:[{query:'synthetic rising',value:14500,breakout:true}]}}];keyword='python';
  }
  const actual=JSON.parse(await mock(rows)[method]({keyword,geo:'GB',resolution:method==='interestByRegion'?'CITY':'REGION',timezone:0}));
  // Compare ranked lists by position: top has hasData; captured rising does not.
  if(method==='relatedQueries') captures[method].response.default.rankedList.forEach((list,i)=>shape(list,actual.default.rankedList[i]));
  else shape(captures[method].response,actual);
});
// Reconstruct the Actor's retained fields from captured Google data to exercise every value.
// These are reconstructed parser inputs, not another live Actor run.
for (const method of methods) test(`${method}: every captured value survives reconstructed retained-field parser input`,async()=>{
  const capture=captures[method], response=capture.response;
  const row={searchTerm:'python'};
  if(method==='interestOverTime') row.interestOverTime=response.default.timelineData.map(p=>({timestamp:Number(p.time),label:p.formattedTime,value:p.value[0],hasData:p.hasData[0],isPartial:p.isPartial??false}));
  if(method==='interestByRegion') row.interestByRegion=response.default.geoMapData.map(p=>({geoCode:p.geoCode,geoName:p.geoName,value:p.value[0]}));
  if(method==='relatedQueries') row.relatedQueries=Object.fromEntries(['top','rising'].map((kind,i)=>[kind,response.default.rankedList[i].rankedKeyword.map(p=>({query:p.query,value:p.value,growth:p.formattedValue,breakout:p.formattedValue==='Breakout'}))]));
  const opts={keyword:'python',geo:'US',timezone:capture.options.timezone,startTime:new Date(capture.options.startTime),endTime:new Date(capture.options.endTime)};
  const out=JSON.parse(await mock([row])[method](opts));
  if(method==='relatedQueries') {
    response.default.rankedList.forEach((list,i)=>list.rankedKeyword.forEach((p,j)=>{
      const actual=out.default.rankedList[i].rankedKeyword[j];
      for(const key of ['query','value','formattedValue']) assert.deepEqual(actual[key],p[key]);
      shape(p,actual);
    }));
  } else {
    const field=method==='interestOverTime'?'timelineData':'geoMapData';
    assert.equal(out.default[field].length,response.default[field].length);
    response.default[field].forEach((p,i)=>{
      const actual=out.default[field][i];shape(p,actual);
      for(const key of Object.keys(p)) if(key!=='formattedAxisTime') assert.deepEqual(actual[key],p[key],key);
    });
  }
});
