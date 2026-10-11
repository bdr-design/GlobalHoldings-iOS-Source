#!/bin/bash
# Resident memory of the browser beside a measurement run (Build 372 tool, not an acceptance gate).
# What it does: every 2 s, while a process matching <pattern> runs, appends "epoch_s chromium_rss_mb node_rss_mb" to
# <out>: the sum over every chromium / headless_shell process (the fleet engine's worker included) and over the node
# processes whose command line holds <pattern>. Read it per phase with the startedAtS/endedAtS of each phase of
# tools/measure_fullgame_trace.cjs (verification/build372-perf/*-rss.txt were recorded this way).
# Run: tools/sample_browser_rss.sh measure_fullgame_trace.cjs /tmp/rss.txt &   (started right after the measurement)
pat="$1"; out="$2"; : > "$out"
while pgrep -f "$pat" >/dev/null; do
  c=$(ps -eo rss,comm | awk '/chrom|headless_shell/ {s+=$1} END {print int(s/1024)}')
  n=$(ps -eo rss,args | awk -v p="$pat" 'index($0,p) && /node/ {s+=$1} END {print int(s/1024)}')
  echo "$(date +%s) $c $n" >> "$out"; sleep 2
done
