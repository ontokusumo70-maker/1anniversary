#!/usr/bin/env node
import assert from 'node:assert/strict';
const base=process.argv[2];
const total=Number(process.argv[3]??1000);
if(!base){console.error('Usage: node tests/load-test.mjs https://worker.example 1000');process.exit(2)}
assert.ok(Number.isInteger(total)&&total>0&&total<=10000);
const start=Date.now();let ok=0,fail=0;
await Promise.all(Array.from({length:total},async()=>{try{const r=await fetch(`${base.replace(/\/$/, '')}/`,{cache:'no-store'});if(r.ok)ok++;else fail++}catch{fail++}}));
const elapsed=Date.now()-start;
console.log(JSON.stringify({total,ok,fail,elapsedMs:elapsed,requestsPerSecond:Math.round(total/(elapsed/1000||1))},null,2));
if(fail)process.exitCode=1;
