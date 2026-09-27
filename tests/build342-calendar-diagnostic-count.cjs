'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['diagnostics-core']);
const state=minimal();
let simulation={manualFailures:0,lastAdvanceFailure:null,frames:0,slices:0};
s.GH_DIAGNOSTICS.recorderStart(state,simulation,{nowMs:1000});

simulation={...simulation,manualFailures:1,lastAdvanceFailure:{reason:'CALENDAR_ADVANCE_FAILED',stage:'commit',from:100,to:100}};
s.GH_DIAGNOSTICS.recorderSample(state,simulation,{nowMs:1100});
let recorder=s.GH_DIAGNOSTICS.recorderSnapshot(state,{includeHistory:true});
assert.equal(recorder.counts.CALENDAR_ADVANCE_FAILED,1,'a single manual failure creates one event');

simulation={...simulation,lastAdvanceFailure:{reason:'changed-detail-without-counter'}};
s.GH_DIAGNOSTICS.recorderSample(state,simulation,{nowMs:1200});
recorder=s.GH_DIAGNOSTICS.recorderSnapshot(state,{includeHistory:true});
assert.equal(recorder.counts.CALENDAR_ADVANCE_FAILED,1,'changing failure metadata without incrementing manualFailures must not duplicate the event');

simulation={...simulation,manualFailures:3,lastAdvanceFailure:{reason:'CALENDAR_ADVANCE_FAILED',stage:'validate',from:200,to:200}};
s.GH_DIAGNOSTICS.recorderSample(state,simulation,{nowMs:1300});
recorder=s.GH_DIAGNOSTICS.recorderSnapshot(state,{includeHistory:true});
assert.equal(recorder.counts.CALENDAR_ADVANCE_FAILED,3,'the event count tracks every newly observed manual failure');
assert.equal(recorder.events.filter(row=>row.type==='CALENDAR_ADVANCE_FAILED').length,3);
assert.deepEqual(Array.from(recorder.events,row=>row.detail.observedFailure),[3,2,1]);

console.log('Build342 calendar diagnostics: CALENDAR_ADVANCE_FAILED count matches manualFailures deltas PASS');
