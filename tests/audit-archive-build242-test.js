const fs=require('fs'),vm=require('vm'),assert=require('assert');
const app=fs.readFileSync('WebApp/app.js','utf8');
assert(!app.includes('state.finance.periods=state.finance.periods.slice(0,120)'),'tax periods must never be silently truncated before audit archive compaction');
assert(app.includes("archiveTrim(state.finance?.periods,240,'taxPeriods')"),'tax periods must flow through audit archive');
const schemaSrc=fs.readFileSync('WebApp/save-schema.js','utf8');
assert(schemaSrc.includes('finance-audit-archive')&&schemaSrc.includes('finance-audit-digest'),'save schema must validate audit archive');
const integrity=fs.readFileSync('WebApp/integrity-core.js','utf8');
assert(integrity.includes('FINANCE_AUDIT_ARCHIVE_INVALID')&&integrity.includes('FINANCE_AUDIT_DIGEST_INVALID'),'integrity core must validate audit archive');
console.log('audit-archive-build242-test: PASS');
