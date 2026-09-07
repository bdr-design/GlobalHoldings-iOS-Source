const fs=require('fs'),path=require('path'),assert=require('assert');const finance=fs.readFileSync(path.join(__dirname,'..','WebApp','finance-core.js'),'utf8');
assert(finance.includes('استثمار/ذمم بين شركات المجموعة')&&finance.includes('رأس مال/ذمم بين شركات المجموعة'),'intercompany transfer double-entry journal missing');
assert(finance.includes('function bulkTransfer')&&finance.includes("transfer(s,{from:'group',to:x.company")&&finance.includes('batchId'),'bulk group transfer must reuse the same balanced intercompany transfer owner');
assert(finance.includes('function transferReserve')&&finance.includes("journal(s,p.company,e.note,[{account:dst.id,debit:a},{account:src.id,credit:a}]"),'treasury internal transfer journal missing');
console.log('Finance transfer journals Build242: PASS');
