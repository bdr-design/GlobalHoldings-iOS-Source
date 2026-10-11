# تسليم هندسي — Build 372: إزالة تجمّد الخيط الرئيسي (فرع `claude/air-departure-destination-pool`)

تاريخ التسليم: 2026-10-11. آخر commit مدفوع: يُقرأ من `git log -1` (هذا المستند جزء منه).
اللغة: العربية للشرح، والمعرّفات البرمجية كما هي. هذا المستند يكمل `docs/BUILD371_HANDOFF_AR.md` ولا يلغيه.

---

## 0. قواعد ملزمة (من صاحب المشروع، سارية حتى إذن صريح)

1. **المهمة الوحيدة: إزالة تجمّد اللعب.** لا ميزات، ولا refactor غير لازم، ولا تحقيق في مشكلات أخرى. أي اكتشاف جانبي يُسجَّل باختصار فقط (القسم 9).
2. **ممنوع الدمج في `main` أو تعديله** دون إذن صريح. كل العمل على `claude/air-departure-destination-pool` فقط.
3. **لا إضعاف** للتحقق من الحفظ أو فحوص السلامة أو عزل المعاملات. عند الشك يُغلق المسار (fail closed) ويرجع للحساب الأصلي على الخيط الرئيسي.
4. **النقل إلى الـ worker، لا التقسيم:** لا يكفي تقسيم كتلة كبيرة إلى مهام أصغر على الخيط الرئيسي.
5. **لا إعلان نجاح من قياسات مركّزة.** القرار يُبنى على قياس اللعبة الكاملة على مليون طائرة، خاصة الإرسال واللعب العادي، على نفس الجهاز مقابل خط الأساس.
6. Save Schema يبقى **3.0.0** دون migration.
7. قبل كل commit: `python3 tools/refresh_fingerprints.py [ملفات جديدة]` ثم `node tests/lint.cjs` ثم `python3 tools/verify_current_source.py`. شجرة نظيفة، وcommit منطقي واحد لكل تغيير.

---

## 1. البيئة المستخدمة (وما لم يُتح)

- الحاوية: Linux، 4 أنوية، 15 GB ذاكرة.
- **Node 22.22.0** فقط. تنزيل Node 24 رُفض (طُلب عبر أداة، فرفض المستخدم الاستدعاء). لذلك **لم يُشغَّل `tools/run_acceptance.py`**: يرفض أقل من Node 24.
- Playwright: النسخة المثبتة مسبقًا في الحاوية **1.56.1** (`/opt/node-tools/node_modules`) مع chromium-1194 (`/opt/pw-browsers`). كل الاختبارات والقياسات شُغّلت بـ:
  ```
  NODE_PATH=/opt/node-tools/node_modules node tests/<test>.cjs
  ```
  بلا أي تنزيل. (BUILD371 كان يستخدم 1.55.1 مع روابط 1193→1194؛ لم يُحتج هنا.)
- eslint: 10.1.0 من `/opt/node-tools` (المشروع يطلب 10.10.0). `node tests/lint.cjs` نظيف على كل commit.
- قياس المليون:
  ```
  GH_PERF_ROOT=$PWD NODE_PATH=/opt/node-tools/node_modules node --max-old-space-size=8192 \
    tools/measure_fullgame_trace.cjs --assets 1000000 --play 90 --days 2 --out out.json
  ```
  يستغرق نحو 25–35 دقيقة. شراء نحو 6 دقائق، والإرسال 8–10 دقائق. لا تشغّل أي شيء ثقيل بجانبه.
  ذاكرة المتصفح: مسجّل خارجي (`ps` كل ثانيتين على كل عمليات chromium، أي العامل ضمنًا). النتائج في `verification/build372-perf/*-rss.txt`.

---

## 2. الفروع

| الفرع | الحالة |
|---|---|
| `claude/air-departure-destination-pool` | **كل عمل Build 372** فوق `34acb68` (تسليم 371). مدفوع. |
| `claude/tool-headers-handoff-bg3tur` | commit واحد `635493e` فوق `34acb68`: تنظيف رؤوس ملفات `tools/` (وصف وطريقة تشغيل). **غير مدموج** في فرع العمل؛ رؤوس الأدوات في فرع العمل حُدِّثت جزئيًا فقط. |
| `main` | لم يُلمس. |

---

## 3. ما تم — بالترتيب، commit بcommit

| Commit | التغيير | الاختبار الجديد |
|---|---|---|
| `4df5009` | **أول مزامنة للعامل خارج الخيط الرئيسي.** (أ) سجل نسخة جديد في `fleet-store-core` (`drainReplica`): بت لكل صف، لا يفيض، يسجّل الأعمدة المعاد كتابتها والدمج (compaction) بترتيبه، ولا يستهلكه غير الخيط. الصفوف التي يعيد الخيط تشغيلها من العامل لا تُسجَّل (`withoutReplicaLog`). (ب) **بذرة من الحفظ:** `migration-core` يعطي مقاطع الخزنة الأصلية (`__GH_NATIVE_SAVE_CHUNKS__`) للمخزن كبذرة (`setReplicaSeed`)، فتُنقل للعامل بالملكية (transfer) بلا أي نسخ على الرئيسي. (ج) العامل يستخرج أزواج (route, base) بنفسه (`route-keys`)، والرئيسي يحلّ ما يُطلب فقط، والخطوات تنتظر كتذاكر مؤجلة. (د) العامل يعيد تنفيذ الدمج (`compactRowsAt`) والاقتطاع بعد التراجع (`truncateReplica`). (هـ) لم يعد التراجع عن نافذة ولا رفض نتيجة ولا الدمج يتطلب نسخة كاملة. (و) لقطة القيم (`synced.values`) تسجّل فقط ما يملكه العامل. (ز) `prime()` كل 200ms عند الخمول. (ح) حُذفت تجربة staged copy من 371 مع اختبارها. (ط) رسالة `inspect` للاختبارات فقط. | `build372-replica-log-browser` (5 طفرات مزروعة فشلت)، `build372-native-seed-browser` |
| `6557400` | **فحص الصحة:** الجزء الخاص بالأسطول نُقل إلى `fleet-health-core.js` بلا تغيير، والعامل يشغّله على نسخته (`health`). `app.js` يطبّق النتيجة فقط إن بقي المخزن نفسه وبقيت الحالة حرة. | `build372-fleet-health-worker-browser` |
| `7ad8e1b` | **التحقق من الحفظ:** أصناف الصفوف وفحص المعرفات من العامل (`classes` و`fieldClasses`)، فقط إن كانت النسخة هي المخزن تمامًا (`replicaIsStore`)، وتُستخدم فقط إن بقي `current()` صحيحًا. وإلا يُحسب على الرئيسي كما كان. يُستخدم فقط من المستدعين المقسّمين عبر الإطارات: مهمة الصيانة، ومسودة الأمر الدائم، وفحص ما بعد الـ commit في المعاملة المرحلية. **الفحوص نفسها لم تتغير.** | `build372-field-classes-worker-browser`، `build372-save-validation-worker-browser` |
| `274d764` | **إقفال اليوم المرحلي:** `afterStagedState` يشغّل كل منتظر في مهمة مستقلة. كان الحفظ المؤجل واستئناف الأمر في مهمة واحدة (45–51ms). | — (الاختبار القديم `build358-staged-day-browser`) |
| `81b1868` | **الخريطة وسطر الحالة:** ملخص أصناف الأسطول من العامل (`mapFleetClassRows`)، متأخر خطوة على الأكثر. النتيجة الأقدم لا تحل محل الأحدث، ولا يُستخدم ملخص مخزن آخر، ولا تُستخدم فهارس صفوف عبر دمج. | `build372-map-summary-worker-browser` |
| `3bc87d2` | **نمو سجل الـ journal:** حجز مسبق بعدد الصفوف في `writeRows`، وإعادة استخدام سجل الـ journal المنتهي حتى 262,144 صفًا (32 MB). | `build372-journal-pool` |
| `838569c` | قياس فقط: `totalWorkerMs` في إحصاءات الخيط، وذروة الـ heap لكل مرحلة في أداة القياس. | — |
| `3ca1e52` | أدلة القياس على مليون (الأساس و838569c) في `verification/build372-perf/`. | — |
| `810b14f` | مزامنة النسخة بعد كل أمر دائم (في مهمة لاحقة؛ صُحّح في `bd4ccd9`). | — |
| `ec0031a` | **مسحان كاملان في الإرسال إلى العامل:** فحص الأهلية داخل أمر الإرسال، ومجاميع بطاقات مركز المسارات بعد كل أمر (كتلة 460ms وحدها). نُقلا إلى `fleet-query-core.js` كدوال نقية، يشغّلها العامل (`query`)، والرئيسي يعيد تشغيلها إن لم تصلح النتيجة. | `build372-fleet-query-worker-browser` (يقارن أيضًا مع الكود القديم حرفيًا) |
| `743eb2e` | **طبقة نسخ للمسارات (`routedVersions`):** كتابة `routeId` أو `releaseExclusiveRouteOnArrival` في مكانها لا تحرّك `identityVersions`، فتبقى جداول الأصناف فوق المالك والمعرف والنوع والصنف صالحة رغم تحرر المسارات عند الوصول. هذا سبب فحص السلامة 110–147ms في دورة السوق وفحص الصحة. | `build372-route-tier` (طفرة مزروعة فشلت) |
| `bd4ccd9` | المزامنة تتم متزامنة في نهاية كل أمر دائم، فلا تحدث نسخة كاملة عند بدء اللعب بعد شراء متتابع. وأُضيفت عدادات أسباب رفض النسخة (`replicaRefusals`). | — |

### الاختبارات المضافة (مسجّلة في `test:build362` بـ`package.json`)
`build372-replica-log-browser`، `build372-native-seed-browser`، `build372-fleet-health-worker-browser`، `build372-field-classes-worker-browser`، `build372-save-validation-worker-browser`، `build372-map-summary-worker-browser`، `build372-journal-pool`، `build372-fleet-query-worker-browser`، `build372-route-tier`.
وحُذف `build371-staged-replica-browser` مع التجربة التي كان يختبرها.

### تعديلات على اختبارات/مساعدات قائمة (دون إضعاف)
- `tests/helpers/local-dom-app.js`: خيار `beforeScripts` لضبط globals قبل تشغيل التطبيق، كما يفعل غلاف iOS. وكشف دوال للاختبار في `__AUDIT__`: `fleetEngineThreadClient`، ودوال الخريطة، و`operationalRoutes`، و`updateMapStatus`.
- `tests/helpers/core-harness.js`: يحمّل `fleet-health-core` مع `diagnostics-core`.
- `tests/build340-map-status-cache.cjs`: يمرَّر stub «لا عامل» للدوال الجديدة؛ المسار القديم الذي يفحصه لم يتغير.
- `tests/build359-sim-smoothness.cjs`: نمط المصدر يقبل الخيار الجديد `fleetClasses:fleetClassesForValidation`.

### ملفات جديدة
`WebApp/fleet-health-core.js`، `WebApp/fleet-query-core.js` (مسجّلان في `index.html` و`runtime-required.json` و`importScripts` للعامل)، `tools/cpuprofile_blocks.py`، `verification/build372-perf/*`.

---

## 4. معمارية التزامن الحالية (كيف تعمل ولماذا هي آمنة)

- **النسخة (replica):** العامل يحمل نسخة من مخزن الأسطول. كل تغيير على الرئيسي يُعلَّم في سجل النسخة (`r.replica`: بت لكل صف، وأعمدة، ودمج). `sync()` يرسل الصفوف المعلّمة وتغييرات القيم والأعمدة والدمج بالترتيب.
- **النسخة الكاملة** (`exportReplica`، نسخ على الرئيسي) لم تبقَ إلا لمخزن بلا بذرة وبلا نسخة: مخزن جديد بـruntime جديد (لعبة جديدة/reset، أو استعادة snapshot كامل في المعاملة). تُعدّ في `stats.fullSyncReasons`.
- **ربط النتائج بالحالة:**
  - **خطوات المحرك:** تبقى مضبوطة بـ`revision/length/valuesLength` والمخزن نفسه كما في 371.
  - **الطلبات غير الخطوات** (`health`، `fieldClasses`، `query`): لا تُرسل إلا إذا كانت النسخة هي المخزن تمامًا (`replicaIsStore`). يتحقق هذا في حالتين:
    1. لا شيء قيد التنفيذ، فتُزامَن النسخة أولًا.
    2. خطوة أُعيد تشغيلها على الرئيسي ولم يُكتب شيء بعدها.
  - **التحقق عند الاستلام:** النتيجة تحمل وسمًا (store, runtime, revision, length, structure)، ولا تُستخدم إلا إن كان `current()` صحيحًا عند الاستلام.
- **التراجع:** `rollbackJournal` يسجّل كل صف يستعيده في سجل النسخة، والعامل يتراجع عن journal خطوته. الطرفان يتطابقان مجددًا بالمزامنة التالية. هذا مُثبت باختبار «تبادل داخل معاملة ثم تراجع».
- **العرض فقط يتأخر خطوة:** الخريطة، وسطر الحالة، وبطاقات المسارات، وفحص الصحة.
- **لا يتأخر ما يقرر:** التحقق من الحفظ وأهلية الإرسال لا يأخذان أبدًا نتيجة لا تصف المخزن الحالي بالضبط.

---

## 5. القياسات (الجهاز نفسه، مليون طائرة، بلا تتبع)

المصدر: `verification/build372-perf/README.md` و`7814b23-1m.json` و`838569c-1m.json`.

| المرحلة | الإصدار | أسوأ فجوة | توقفات >50ms (مجموعها) | p95 / p99 | Long tasks | CPU الرئيسي |
|---|---|---|---|---|---|---|
| الإرسال (48 أمرًا) | 7814b23 | 1133ms | 3882 (471s) | 116.7 / 533 | 4231 | — |
| الإرسال (48 أمرًا) | 838569c | 1100ms | 982 (229s) | 66.7 / **650** | 2158 | — |
| اللعب 90s | 7814b23 | 450ms | 19 | 16.8 / 33.3 | 26 (3.4s) | 22.6s |
| اللعب 90s | 838569c | 300ms | 14 | 16.8 / 16.8 | 13 (1.3s) | 11.2s |
| تقديم يومين | 7814b23 | 267ms | 69 | 33.3 / 66.6 | 96 | 65.1s |
| تقديم يومين | 838569c | 217ms | 62 | 16.8 / 66.7 | 72 | 39.3s |

- **ذاكرة المتصفح القصوى من بداية الإرسال:** 4242 MB في الأساس، و4232 MB في 838569c.
- **JS heap بعد GC:** 261 MB في الأساس، و260 MB في 838569c.
- **838569c فقط:** ذروة JS heap في اللعب 871 MB والمتوسط 276 MB؛ لم يُقَس هذا في الأساس، وسببه غير مشخَّص.
- **وقت العامل:** نحو 73s في اللعب، ونحو 38s في التقويم.
- **قياسات مركّزة** (لا تُبنى عليها قرارات):
  - أول مزامنة على مليون صف: 240ms في الأساس، 1.9ms بالبذرة، و86ms بنسخة كاملة بلا بذرة.
  - إعادة 200 ألف صف في journal: من 235–327ms إلى 28–37ms.
- **100 ألف طائرة على ec0031a** (`ec0031a-100k.json`):
  - اللعب: أسوأ 17ms، بلا توقف فوق 50ms.
  - التقويم: أسوأ 50ms.
  - الإرسال: أسوأ 233ms، و53 توقفًا.

**مهم:** التغييرات `ec0031a` و`743eb2e` و`bd4ccd9` **لم تُقَس على مليون**. أول مهمة للمطور التالي هي قياسها (القسم 7).

---

## 6. تشريح ما بقي من التجمد (على 810b14f، تتبع + ملفات CPU)

الملفات:
- `810b14f-dispatch-blocks.txt`: أول أمرين في الإرسال.
- `810b14f-play-long-tasks.txt`: تتبع اللعب.
- `810b14f-advance-blocks.txt`: التقويم.
- `810b14f-1m-traced.json`: أرقام الجولة المتتبَّعة، وهي **منفوخة بالتتبع**، لا تُقارَن.

### الإرسال (الأكبر)
97 كتلة فوق 50ms في أول أمرين، مجموعها 13.8s. مرتّبة بالحجم:
1. **`scan` (مسح كامل للأسطول):**
   - مسح الأهلية في الأمر: **عولج في ec0031a**، غير مقاس.
   - `routeCenterLinkedSummary` في `afterCommit → openDrawer('routes')`: **عولج في ec0031a**، غير مقاس.
   - تبقى مسوح أخرى في مركز المسارات بعد كل أمر: `routeCenterFillAssignable` و`routeCenterManualAssets` و`routeCenterFleetSnapshot`. أصغر، لكنها على الرئيسي.
2. **`deepClone` / `cloneWithoutJournaledRoots`:** نسخ الحالة في بداية كل أمر دائم (`runDurableStateCommand`). لم يُعالَج.
3. **جسم الأمر:** دالة الأمر نفسها (`app.js` ~1811)، و`assignRoutesBatch`/`departBatch` (`domain-command-core`/`fleet`)، و`materialize`/`plain`، و`encode`/`sha256` (توقيع النية والـ idempotency)، و`indexOfId`. لم يُعالَج.
4. **`commitDurableState`:** الحفظ و`saveHash` و`uploadChunks`. لم يُعالَج.

### اللعب
1. **334ms:** التحقق من الحفظ في مهمة ما بعد الـ commit لشريحة مرحلية، كان على الرئيسي. **السبب الدقيق لرفض العامل على مليون غير معروف**: على 100 ألف كانت الأسباب `step-not-replayed` و`written-since-step`. العدادات أُضيفت في `bd4ccd9`، فاقرأ `phases.play.fleetThread.replicaRefusals` في القياس القادم.
2. **147 / 122 / 110ms:** فحص السلامة (`GH_INTEGRITY_CORE.check` → `company-platform validateState` → `forEachClass`) في `processMarket` وفي فحص الصحة. **السبب الجذري عولج في 743eb2e** (تحرر المسارات كان يبطل جداول الهوية)، غير مقاس.
3. **288 / 151ms GC خالص:** ضغط ذاكرة غير مشخَّص. مرتبط على الأرجح بذروة heap 871MB: نتائج الخطوات، و`readRows`، ونسخ القيم.
4. **1179ms و108ms:** `recorderStart`/`recorderStop` الذي **تستدعيه أداة القياس** بلا `fleetPhaseHint`. ليس من اللعبة؛ تجاهله أو أصلح الأداة.

### التقويم
128 كتلة، أغلبها `forEachClass` تحت `check` في `processMarket → dispatchSystemCommand`، أي نفس سبب البند 2 أعلاه (عولج في 743eb2e، غير مقاس).

---

## 7. ما تبقى — بالترتيب الإلزامي

1. **قياس مليون كامل على HEAD** بنفس الأمر (القسم 1)، ومقارنته مع `7814b23-1m.json`. افحص:
   - الإرسال: أسوأ فجوة، وp99، والتوقفات.
   - اللعب والتقويم: هل اختفت كتل فحص السلامة (743eb2e)؟
   - `fullSyncReasons`: يجب ألا تحدث نسخة كاملة بعد الشراء (bd4ccd9).
   - `replicaRefusals`.
   - ذروة heap وRSS، و`totalWorkerMs`.
   ثم جولة `--trace --profile` للتشريح، وحلّلها بـ`tools/attribute_long_tasks.py` و`tools/cpuprofile_blocks.py`.
2. **الإرسال:** بقية كتل القسم 6:
   - نسخ المسودة: هل يمكن تجنّب نسخ ما لا يكتبه الأمر؟
   - جسم الأمر و`assignRoutesBatch`/`departBatch`.
   - التوقيع/التجزئة.
   - مسوح مركز المسارات المتبقية.
   - الحفظ.
   كل نقل إلى العامل يحتاج اختبارًا تفاضليًا مثل اختبارات build372.
3. **سبب رفض العامل للتحقق من الحفظ داخل الشريحة على مليون (334ms).** إن كان `written-since-step`، فالحل المرشّح: السماح بمزامنة الصفوف المكتوبة بعد الخطوة إلى العامل والخطوة مفتوحة. لهذا قيود تراجع يجب إثباتها: أعمدة وقيم يكتبها `sync` داخل journal العامل.
4. **GC في اللعب** (288/151ms) **وذروة heap 871MB:** تتبّع التخصيص (allocation sampling).
5. **أداة القياس:** تمرير `fleetPhaseHint` في `recorderStart`/`recorderStop`، حتى لا تقيس كتلتها الخاصة.

### تحققات طلبها صاحب المشروع ولم تكتمل
- **تكرار `build358-staged-day-browser`:**
  - قبل الإصلاح: فشلان من نحو 10 تشغيلات.
  - بعد `274d764`: **11 نجاحًا متتاليًا** (8 في حلقة، و3 ضمن دفعات أخرى). المطلوب عشرات التشغيلات، ولم يُنفَّذ.
- **القبول الكامل:**
  - لم يُشغَّل، لأن Node 24 غير متاح. شغّله على Node 24 كما في `BUILD371_HANDOFF_AR.md` §1.
  - البديل الجزئي: شُغّل نحو 80 اختبارًا قريبًا من التغييرات على Node 22، وكلها نجحت (القسم 8).
- **مراجعة مستقلة** للتزامن وثبات الـ revision والتراجع وصحة الحفظ: **لم تتم**.
- **اختبار iPhone 17 Pro Max:** لم يتم. خاصة: هل نقل المقاطع بالملكية (transfer) يعمل في WKWebView، وهل يُستعاد الحفظ بالبذرة. مثبت هنا في Chromium فقط.

---

## 8. الاختبارات التي شُغّلت ونجحت (Node 22 + Playwright 1.56.1)

**مخزن/journal/محرك:** build356-fleet-store، build357-fleet-journal، build355-fleet-access، build356-fleet-events، build358-row-snapshot-rollback، build358-transaction-row-snapshots، build371-route-holder-scan، build358-validation-classes، build358-fleet-scan، build358-route-capacity.

**الخيط/العامل:** build358-fleet-engine-thread-browser، build362-fleet-window-session، build362-calendar-window-equivalence، build359-sim-smoothness، build340-simulation-worker-contract.

**الحفظ/التحميل/الاسترداد:** build358-native-chunked-save، build358-fleet-chunk-manifest، persistence-regressions، build358-fleet-save-cap، build357-fleet-migration، build334-r4-recovery-browser، build334-r4-recovery-integration، build360-iphone-failure-recovery، build359-sliced-save-browser، build359-save-policy-browser، build334-deferred-save-lifecycle.

**التحقق والمعاملات:** build358-schema-sections، build359-schema-byte-limits، build363-control-outbox-atomicity، build334-durable-postcommit-contract، build359-durable-command-cost، build340-durable-draft-restore، build359-command-slices، build353-steady-slice-rollback، build363-staged-holdings-command، build359-incremental-maintenance.

**التقويم والمرحلية:** build358-staged-day-browser، build358-calendar-staged-completion، build358-staged-full-scope، build334-calendar-advance-browser، build334-calendar-journey-browser، build371-calendar-cancel-maintenance-browser.

**الإرسال والأوامر:** build358-large-fleet-dispatch-browser، build371-air-fleet-series-browser، build358-air-sea-dispatch-browser، build359-road-dispatch-browser، build371-air-destination-pool-browser، build371-durable-fleet-isolation-browser، build371-native-update-isolation-browser، build371-durable-live-fields-browser، build371-reload-trip-speed-browser، build371-old-save-trip-correction-browser.

**التشخيص:** build360-iphone-failure-recovery، build363-energy-health-contract، review-regressions، build336-diagnostics-transient، build363-runtime-diagnostics-contract، build339-diagnostic-frame-trace، fleet-regressions، core-regressions.

**الخريطة والواجهة:** build359-map-modes-browser، build358-map-controls-browser، build334-r2-map-local-dom، build340-map-asset-query، build340-map-structure-revision، build340-map-status-cache، build340-map-presentation، build359-map-geographic-budget، build359-map-canvas-layer، build366-mobility-map-policy-browser، build366-mobility-no-repeat-scans، build358-directory-open-sites-browser، build334-tabs-browser، build334-presentation-work-contract، build334-map-pressure-contract، build334-source-layout.

**كل اختبارات build372 التسعة.**

> ملاحظة: كل تشغيل يمسّ ملفات `verification/` (calendar، r4-recovery) أُعيد بـ`git checkout -- verification/ && git clean -fd verification/r4-recovery` قبل كل commit.

---

## 9. مخاطر وحدود معروفة (مسجّلة دون تحقيق إضافي)

1. **النسخة الكاملة باقية** لمخزن جديد بلا بذرة (لعبة جديدة كبيرة لم تمر بأي أمر، أو استعادة snapshot كامل يغيّر runtime المخزن). كلفتها 86ms على مليون صف في Chromium. تكرارها في اللعب الحقيقي غير مقاس؛ انظر `fullSyncReasons`.
2. **البذرة تحتفظ بمقاطع الخزنة** (حتى نحو 176MB على مليون: السعة لا الطول) إلى أن يُنشأ العميل، وذلك يتم بعد التحميل بقليل. لم يُقَس أثرها على ذروة الذاكرة في iPhone.
3. **انتظار أصناف التحقق:** حتى 1800 إطار، ثم الرجوع إلى الرئيسي. في السياق المتزامن (`drainSteps`) تنتهي الانتظارات فورًا، فيرجع للرئيسي ولا يتعلق.
4. **العامل مشغول:** نحو 73s من 90s في اللعب. طلبات الصحة والأصناف والخريطة تزاحم خطوات المحرك؛ أثرها على تأخّر الخطوات غير مقاس.
5. **مجمّع سجل الـ journal** يحتفظ بما يصل إلى 32MB لكل مخزن (الرئيسي والعامل).
6. **ذروة heap 871MB في اللعب** (838569c) غير مشخَّصة.
7. **مركز المسارات** يعرض الأعداد من آخر نتيجة؛ قبل أول نتيجة بعد فتحه يعرض أصفارًا لحظيًا.
8. **الصفوف بلا `ownerCompanyId`/`companyId`** (ملكية قديمة عبر جدول الأنماط) تجعل العامل يرفض، فتُحسب على الرئيسي كما كان.
9. خارج النطاق، مسجّل فقط: `tools/bench_first_sync.cjs` كان يقرأ حالة التذكرة بعد `terminate` (أُصلح)، وكان يضع `salePending:false` في كل صف فينقلها كلها إلى extras (أُصلح).

---

## 10. خريطة الملفات المعدّلة

| الملف | ما تغيّر |
|---|---|
| `WebApp/fleet-store-core.js` | سجل النسخة، البذرة، الدمج والاقتطاع للعامل، `replicaClean`، مجمّع الـ journal، `routedVersions` |
| `WebApp/fleet-engine-thread.js` | المزامنة الجديدة، البذرة، route-keys، التذاكر المؤجلة، `prime`، `health`، `fieldClasses`، `query`، `current`، `inspect`، الإحصاءات |
| `WebApp/fleet-engine-worker.js` | `seed`، `compact`، `route-keys`، `health`، `classes`، `query`، `inspect`، الاقتطاع |
| `WebApp/fleet-health-core.js` | جديد (من `diagnostics-core`) |
| `WebApp/fleet-query-core.js` | جديد (من `app.js`) |
| `WebApp/diagnostics-core.js` | يستخدم `fleet-health-core` و`extra.fleetAssetIssues` |
| `WebApp/save-schema.js` | `options.fleetClasses` في قسم الأسطول |
| `WebApp/control-plane-core.js` | يمرّر المزوّد في المعاملات المرحلية فقط |
| `WebApp/migration-core.js` | ضبط البذرة بعد فك الترميز |
| `WebApp/app.js` | `prime` في الـ render وبعد الأوامر، فحص الصحة غير المتزامن، مزوّد الأصناف، ملخص الخريطة، `fleetQuery` للإرسال ومركز المسارات، `afterStagedState`، `primeFleetThreadAfterCommand` |
| `WebApp/index.html`، `WebApp/runtime-required.json` | الملفان الجديدان |
| `tools/measure_fullgame_trace.cjs` | heap لكل مرحلة، طوابع زمنية، ملفات العامل الجديدة |
| `tools/bench_first_sync.cjs` | البذرة، heap بديل، تصحيحان |
| `tools/cpuprofile_blocks.py` | جديد |
