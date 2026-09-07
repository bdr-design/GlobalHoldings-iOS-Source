const fs=require('fs'); const assert=require('assert');
const s=fs.readFileSync('iOS/GlobalHoldings/GlobalGameStorage.swift','utf8');
assert(s.includes('safeRelativePath(of: url, inside: folder)'), 'staging enumeration must use canonical containment helper');
assert(s.includes('resolvingSymlinksInPath().standardizedFileURL.path'), 'canonical helper must resolve sandbox aliases/symlinks');
assert(!s.includes('guard url.path.hasPrefix(prefix)'), 'raw path-prefix staging guard must remain removed');
assert(s.includes('guard candidate.hasPrefix(prefix) else { return nil }'), 'canonical path must still enforce containment');
assert(s.includes('return isSafePath(relative) ? relative : nil'), 'canonical relative path must still pass traversal guard');
console.log('Native staging canonical path regression: PASS');
