# Build 372 freeze measurements (desktop Chromium, one machine, 4 cores)

`tools/measure_fullgame_trace.cjs --assets 1000000 --play 90 --days 2` (no trace), Playwright 1.56.1, Node 22.

- `7814b23-1m.json`: baseline (tool of 34acb68, GH_PERF_ROOT at 7814b23).
- `838569c-1m.json`: Build 372 through 838569c (same tool, plus heap samples and worker time).
- `*-rss.txt`: `epoch_s chromium_rss_mb node_rss_mb` every 2 s (every browser process, the worker included). The
  baseline sampler started at the end of the purchase; read both from the dispatch on.

| phase | build | worst ms | stalls > 50 ms (total ms) | p95 / p99 ms | long tasks (ms) | main CPU s |
|---|---|---|---|---|---|---|
| dispatch (48 commands) | 7814b23 | 1133 | 3882 (471238) | 116.7 / 533.2 | 4231 (442790) | |
| dispatch (48 commands) | 838569c | 1100 | 982 (228775) | 66.7 / 650 | 2158 (202624) | |
| play 90 s | 7814b23 | 450 | 19 (2733) | 16.8 / 33.3 | 26 (3363) | 22.6 |
| play 90 s | 838569c | 300 | 14 (1450) | 16.8 / 16.8 | 13 (1268) | 11.2 |
| advance 2 days | 7814b23 | 267 | 69 (6867) | 33.3 / 66.6 | 96 (9447) | 65.1 |
| advance 2 days | 838569c | 217 | 62 (5700) | 16.8 / 66.7 | 72 (7163) | 39.3 |

Peak resident memory of the browser from the dispatch on: 4242 MB (7814b23), 4232 MB (838569c). JS heap after two
collections: 261 / 260 MB. 838569c: main-thread JS heap peak 871 MB in play (mean 276), 309 MB in the advance; worker
time about 73 s during play and 38 s during the advance. In this scenario (a fleet bought in back-to-back commands before
any slice) the first replica was still a whole copy (110 ms, was 449 ms); the next commit primes the replica after each command.

Not resolved: dispatch stalls up to 1.1 s; a 259 ms task in play and 237 ms in the advance (to be attributed).
