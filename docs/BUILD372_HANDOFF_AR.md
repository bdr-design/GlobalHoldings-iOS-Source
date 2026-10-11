# تسليم هندسي متكامل — Build 372: إزالة تجمّد الخيط الرئيسي

**الفرع:** `claude/air-departure-destination-pool` (الوحيد المسموح العمل عليه). **التاريخ:** 2026-10-11.
**آخر commit مدفوع:** يُقرأ من `git log -1`. هذا المستند جزء منه.

هذا المستند **مكتفٍ بذاته**: يكفي لمطور جديد كي يبدأ دون الرجوع إلى أي محادثة. يكمل `docs/BUILD371_HANDOFF_AR.md`، الذي يشرح ما قبل هذه الجولة: سلسلة إرسال المليون، والإلغاء على مرحلتين، وعزل المعاملات.

---

## الفهرس

0. ملخص تنفيذي (اقرأه أولًا)
1. القواعد الملزمة من صاحب المشروع
2. البدء السريع: البيئة، والتشغيل، والاختبار، والقياس
3. الفروع وتاريخ الـ commits
4. المعمارية: النسخة في العامل وكيف تبقى مطابقة
5. بروتوكول الرسائل مع العامل
6. جولة في الكود (مع مواقع الأسطر)
7. الثوابت (invariants) والاختبارات التي تحرسها
8. القياسات: قبل وبعد
9. ما بقي من التجمد وتشريحه
10. خطة العمل التالية بالترتيب، مع معايير القبول
11. التحققات المطلوبة التي لم تكتمل
12. المخاطر والحدود المعروفة
13. قائمة فحص قبل أي commit وقبل أي طلب دمج
14. كيفية القياس والتشريح خطوة بخطوة
15. مسرد المصطلحات

---

## 0. ملخص تنفيذي

- **المشكلة:** تجمّد الخيط الرئيسي في لعبة بمليون طائرة (WebApp داخل WKWebView على iPhone). المصدر عمل يمرّ على كل صفوف الأسطول على الخيط الرئيسي: نسخ، ومسح، وبناء جداول أصناف.
- **الحل المعماري المتبع:** للعبة **عامل (Worker)** يحمل نسخة من مخزن الأسطول، وكان يُستخدم قبلًا لخطوات المحرك فقط. جعلنا هذه النسخة تبقى مطابقة **دون نسخ كامل**، ثم نقلنا إليها كل حساب على الأسطول كله تستطيع حمله:
  - فحص الصحة؛
  - أصناف التحقق من الحفظ؛
  - ملخص الخريطة؛
  - مسح أهلية الإرسال؛
  - بطاقات المسارات.

  الخيط الرئيسي لا يقبل نتيجة إلا إن **أثبت** أنها تصف حالته الحالية بالضبط. وإلا يحسب بنفسه كما كان.
- **النتيجة المقاسة حتى الآن** (مليون طائرة، نفس الجهاز، `7814b23` → `838569c`):

  | المرحلة | توقفات فوق 50ms | أسوأ فجوة | ملاحظة |
  |---|---|---|---|
  | الإرسال | 3882 → 982 | 1133 → 1100ms | p99 صار أسوأ: 533 → 650ms |
  | اللعب | 19 → 14 | 450 → 300ms | |
  | التقويم | 69 → 62 | 267 → 217ms | |

  ذاكرة المتصفح القصوى لم تزد.
- **لم يكتمل:**
  - آخر ثلاثة إصلاحات (`ec0031a`، `743eb2e`، `bd4ccd9`) **غير مقاسة على مليون**.
  - كتل الإرسال (حتى نحو 1.1s) باقية، وأسبابها مشخّصة.
  - القبول الكامل لم يُشغَّل (لا Node 24).
  - لا مراجعة مستقلة، ولا اختبار iPhone.
- **أول ما تفعله:** القسم 2 (البيئة)، ثم القسم 10، المهمة 1 (قياس HEAD على مليون).

---

## 1. القواعد الملزمة (من صاحب المشروع، سارية حتى إذن صريح)

1. **المهمة الوحيدة: إزالة تجمّد اللعب.** لا ميزات، ولا refactor غير لازم، ولا تحقيق في مشكلات أخرى. أي اكتشاف جانبي يُسجَّل في سطر (القسم 12) دون متابعته، إلا إن هدّد سلامة الإصلاح.
2. **ممنوع الدمج في `main` أو تعديله**، أو rebase عليه أو cherry-pick إليه، دون إذن صريح. يُسمح بفروع تطوير عند الحاجة، لكن العمل المرجعي هو `claude/air-departure-destination-pool`.
3. **لا إضعاف** للتحقق من الحفظ أو فحوص السلامة أو عزل المعاملات. عند الشك: **fail closed**، أي العودة للحساب الأصلي على الرئيسي، لا قبول نتيجة قديمة.
4. **انقل العمل إلى العامل، لا تقسّمه.** تقسيم كتلة إلى مهام أصغر على الخيط الرئيسي ليس حلًا مقبولًا.
5. **لا إعلان نجاح من قياسات مركّزة.** القرار من قياس اللعبة الكاملة على مليون طائرة: الإرسال الكبير واللعب العادي، على نفس الجهاز، مقابل خط الأساس.
6. **عند كل تغيير معماري:** اختبار تفاضلي حتمي يقارن حساب العامل بالحساب الأصلي، ويغطي: commit، وrollback، وrecovery، وsave/reload، وhard reset، والأسطول الكبير.
7. **المقاييس المطلوبة لكل قياس:** أسوأ فجوة إطار، وp95/p99، وlong tasks، والتوقفات فوق 50ms، ووقت العامل، والذاكرة، وGC، والاستجابة.
8. Save Schema يبقى **3.0.0** دون migration.
9. قبل كل commit: القسم 13.

---

## 2. البدء السريع

### 2.1 البيئة (كما استُخدمت فعلًا)
- Linux، 4 أنوية، 15 GB.
- **Node 22.22.0** و**Playwright 1.56.1** مثبتان مسبقًا في `/opt/node-tools/node_modules`، مع Chromium 1194 في `/opt/pw-browsers`.
- لا تثبّت شيئًا داخل المستودع. كل أمر يُشغَّل مع:
  ```bash
  export NODE_PATH=/opt/node-tools/node_modules
  ```
- **مطلوب ولم يتوفر هنا:** Node 24 لـ`tools/run_acceptance.py` (يرفض أقل من 24). طريقة تجهيزه وتجهيز Playwright 1.55.1 في `BUILD371_HANDOFF_AR.md` §1.

### 2.2 التحقق من المصدر واللنت
```bash
python3 tools/verify_current_source.py      # يجب: "verified": true
node tests/lint.cjs                         # يجب: []
```

### 2.3 تشغيل اختبار
```bash
node tests/build372-replica-log-browser.cjs
```
الاختبارات تكتب أحيانًا في `verification/` (calendar، r4-recovery). أعدها قبل أي commit:
```bash
git checkout -- verification/ && git clean -fd verification/r4-recovery
```

### 2.4 تشغيل كل اختبارات Build 372
```bash
for t in replica-log-browser native-seed-browser fleet-health-worker-browser field-classes-worker-browser \
  save-validation-worker-browser map-summary-worker-browser journal-pool fleet-query-worker-browser route-tier; do
  node tests/build372-$t.cjs >/tmp/$t.log 2>&1; echo "$t $?"; done
```

### 2.5 القياس على مليون طائرة (25–35 دقيقة، لا تشغّل شيئًا آخر بجانبه)
```bash
GH_PERF_ROOT=$PWD node --max-old-space-size=8192 tools/measure_fullgame_trace.cjs \
  --assets 1000000 --play 90 --days 2 --out /tmp/head-1m.json > /tmp/head-1m.log 2>&1
```
التفاصيل والتشريح في القسم 14.

---

## 3. الفروع وتاريخ الـ commits

| الفرع | الحالة |
|---|---|
| `claude/air-departure-destination-pool` | كل عمل 371 و372. مدفوع. |
| `claude/tool-headers-handoff-bg3tur` | commit واحد `635493e` فوق `34acb68` لتنظيف رؤوس `tools/`. غير مدموج. |
| `main` | لم يُلمس. |

### commits جولة 372 (فوق `34acb68`)

| Commit | ماذا | لماذا | الاختبار |
|---|---|---|---|
| `4df5009` | أول نسخة للعامل من مقاطع الحفظ (بذرة) + سجل نسخة لا يفيض + route-keys في العامل + إعادة الدمج والاقتطاع في العامل + حذف تجربة staged copy | أول مزامنة كانت نسخ 128MB + GC + مسح كل الصفوف: 500–930ms | `build372-replica-log-browser`، `build372-native-seed-browser` |
| `6557400` | فحص صحة الأسطول في العامل (`fleet-health-core.js`) | 485ms في فحص الصحة الدوري | `build372-fleet-health-worker-browser` |
| `7ad8e1b` | أصناف التحقق من الحفظ من العامل (مقيّدة بالمطابقة التامة) | 402ms في التحقق من الحفظ | `build372-field-classes-worker-browser`، `build372-save-validation-worker-browser` |
| `274d764` | كل منتظر بعد الإقفال المرحلي في مهمة مستقلة | 45–51ms في نهاية إقفال اليوم (اختبار متقطع الفشل) | `build358-staged-day-browser` |
| `81b1868` | الخريطة وسطر الحالة من ملخص العامل | 236–277ms لكل رسم خريطة | `build372-map-summary-worker-browser` |
| `3bc87d2` | حجز سجل الـ journal مسبقًا وإعادة استخدامه | `growLog` 164ms | `build372-journal-pool` |
| `838569c` | قياس: `totalWorkerMs` وheap لكل مرحلة | أدلة | — |
| `3ca1e52` | أدلة قبل/بعد على مليون | أدلة | — |
| `810b14f` | مزامنة بعد كل أمر (مؤجلة؛ صُحّحت في `bd4ccd9`) | نسخة كاملة 110ms عند بدء اللعب بعد شراء متتابع | — |
| `ec0031a` | مسح أهلية الإرسال وبطاقات مركز المسارات في العامل (`fleet-query-core.js`) | مسحان كاملان في كل أمر إرسال؛ 460ms لبطاقات المسارات | `build372-fleet-query-worker-browser` |
| `743eb2e` | `routedVersions`: كتابة المسار في مكانها لا تبطل جداول الهوية | فحص السلامة 110–147ms في دورة السوق وفحص الصحة | `build372-route-tier` |
| `bd4ccd9` | المزامنة متزامنة في نهاية الأمر + عدادات أسباب الرفض | الأمر التالي كان يبدأ قبل المهمة المؤجلة | — |
| `35d16a5` وما بعده | التسليم والأدلة وأداة `cpuprofile_blocks.py` | — | — |
| `5d43a97` | ما يُكتب بعد خطوة مُعادة (أو آخر شوط نافذة) يُرسل داخلها (`syncIntoOpen`) | فحص الحفظ في الشريحة يُرفض (`written-since-step`) فيمسح مليون صف | `build372-replica-log-browser` (4c)، `build372-field-classes-worker-browser` |
| `aa13b7a` | مرحلة اسمها ينتهي بـ`-wait` تُنهي استدعاء `staged.step` | انتظارات العامل الـ1800 كانت تُستهلك في إطار واحد (نحو 1ms) فيعود الفحص للرئيسي (السبب الفعلي لكتلة 334ms، ظاهر في تتبع 62b4397) | `build372-staged-wait` |
| `065b942` | `internAt` لا يحرّك `valuesGeneration` عند الإلحاق (مثل `intern`)، و`applyValueChanges` فقط عند استبدال/حذف | كل شريحة كانت تُسقط كل جداول الأصناف: فحص السلامة يعيد بناء مليون صف كل ساعة سوق وكل فحص صحة (103–197ms)، والعامل يعيد بناءها لكل طلب | `build372-route-tier` (12 جولة إعادة) |
| `952a59d` | مجموع حالة الأسطول للتأمين اليومي (`conditionSum`) وقضايا الصحة في جولة الصيانة من العامل | 169ms و165–215ms في التقويم | `build372-fleet-query-worker-browser`، `build372-insurance-condition-worker`، `build372-maintenance-health-worker-browser` |
| `564a657` | الأعمدة المعاد كتابتها كاملة بعد الخطوة تُرسل داخلها (لقطة عمود في journal العامل) | عدّادات الطيران اليومية كانت تسبب `mass-write-since-step` ففحص الحفظ في التقويم يمسح على الرئيسي (171–280ms) | `build372-replica-log-browser`، `build372-field-classes-worker-browser` |
| `4c06ffe` | ختم حمولة كل دفعة إرسال مرة واحدة (`GH_AUTHORIZATION.seal`: نسخة مجمّدة نصّها القانوني محفوظ؛ مسار التفويض يشاركها بدل نسخها؛ ذاكرة digest بالنص نفسه) | الحمولة كانت تُرمَّز نحو 13 مرة وتُنسخ نحو 5 مرات وتُجزَّأ نيتها مرتين لكل دفعة | `build372-sealed-payload` (عالمان متطابقان: كل شيء متطابق؛ 4 طفرات فشلت)، `build358-large-fleet-dispatch-browser` (الختم مستخدم فعلًا) |
| `8e04e3d` | `materialize` يُسند الحقول بدل `defineProperty` (إلا مفاتيح `Object.prototype`) | `defineData` أكبر زمن ذاتي في سلسلة الإرسال بعد الختم | `build372-materialize-properties` (طفرة فشلت) |

---

## 4. المعمارية: النسخة في العامل وكيف تبقى مطابقة

```
الخيط الرئيسي (state.fleet = مخزن أعمدة 128B/صف)          العامل (fleet-engine-worker.js)
──────────────────────────────────────────────          ────────────────────────────────
كل كتابة ──► سجل النسخة r.replica (بت/صف، أعمدة، دمج)    نسخة store بنفس التخطيط
                │
   sync()/prime() ──► compact* ─► sync(صفوف+قيم) ─► columns ─►  يطبّق بالترتيب
   newReplica(): بذرة (transfer) أو نسخة كاملة ─────────────►  seed/replica ─► route-keys ─┐
   answerRouteKeys() ◄───────────────────────────────────────────────────────────────────┘
   request()/apply()  خطوات المحرك (journal مفتوح حتى settle)
   health()/fieldClasses()/query() ── فقط إن replicaIsStore ──►  حساب على النسخة ─► نتيجة + وسم
   current(result,store) ── قبول النتيجة فقط إن طابق الوسم المخزن الآن
```

### 4.1 سجل النسخة (`fleet-store-core.js`)
- لكل runtime مخزن سجل `r.replica`:
  - `bits` (بت لكل صف) و`chunks` (علم لكل chunk)؛
  - `columns` (الأعمدة المعاد كتابتها جماعيًا، حتى الهادئة)؛
  - `compactions` (قائمة الصفوف المحذوفة لكل دمج، بالترتيب).
- يُكتب من:
  - `logDirty`؛
  - `toucher` (حتى عند `suppressDirtyLog`، لأن محرك الرئيسي يكتمها عن سجله هو)؛
  - `rememberColumn`؛
  - استعادات `rollbackJournal` للصفوف والأعمدة؛
  - `compactRows` (يعيد ترقيم البتات ويضيف الدمج).
- **لا يُكتب** لصفوف أعاد الخيط تشغيلها من العامل (`withoutReplicaLog`).
- **مستهلك وحيد:** الخيط عبر `drainReplica`. هذا ما فصله عن سجل dirty القديم، الذي يستهلكه محرك الرئيسي أيضًا، وكان يضيّع على الخيط تتبّعه فيطلب نسخة كاملة.

### 4.2 البذرة من الحفظ
- **عند التحميل** (`migration-core.js` سطر 100): مقاطع الخزنة الأصلية (ArrayBuffers) تُسجَّل كبذرة للمخزن المفكوك بـ`setReplicaSeed`.
- **عند أول مزامنة** (`newReplica`): تُنقل بالملكية (transfer) إلى العامل، فلا نسخ على الرئيسي. العامل يجمعها (`case 'seed'`).
- **الكتابات منذ البذرة** في سجل النسخة، فتلحقها المزامنة التزايدية.
- **الحفظ يخزّن السعة لا الطول**، والعامل يأخذ أول `length` صف فقط.

### 4.3 النسخة الكاملة: متى ما زالت تحدث
- لمخزن بلا بذرة وبلا نسخة: runtime جديد (لعبة جديدة/reset، أو استعادة snapshot كامل).
- تُعدّ في `stats.fullSyncReasons`.
- `bd4ccd9` و`FLEET_THREAD_EARLY_ROWS=2048` يجعلان أسطولًا يُبنى داخل الجلسة يصل للعامل تدريجيًا.

### 4.4 أزواج المسارات
- بعد أي نسخة جديدة، يستخرج العامل أزواج (routeId, base) من صفوفه (`routeKeys`).
- الرئيسي يحلّ المطلوب فقط (`answerRouteKeys`).
- حتى ذلك الحين تُحجز الخطوات كتذاكر مؤجلة (`ticket.deferred` و`ticket.deferredWindow`)، ولا تفشل.

### 4.5 الطلبات غير الخطوات (`health`، `fieldClasses`، `query`)
تُرسل فقط إن كانت النسخة **هي المخزن تمامًا** (`replicaIsStore`، `fleet-engine-thread.js` سطر 174)، في حالتين:
- **(أ)** لا خطوة ولا نافذة قيد التنفيذ، فتُزامَن النسخة أولًا (`prime`).
- **(ب)** خطوة (أو آخر شوط من نافذة تقويم) أُعيد تشغيلها على الرئيسي. ما كُتب بعدها من صفوف وقيم وصفوف مُضافة يُرسَل **داخل الخطوة المفتوحة** (`syncIntoOpen`، رسالة `sync` تحمل `step` أو `window`)، فيكتبه العامل داخل journal الخطوة، ويُثبَّت أو يُتراجَع عنه معها. يبقى الرفض إن كان بعدها دمج، أو عمود أعيدت كتابته كاملًا، أو أسطول أقصر، أو تغيّر في خطط المسارات، أو نسخة تحتاج تجديدًا، أو نافذة غير مفتوحة. عندها يقرأ المستدعي المخزن بنفسه كما كان.

ثم:
- كل نتيجة تحمل وسمًا `{store, runtime, revision, length, structure}`.
- المستدعي **يجب** أن يتحقق بـ`current(result, store)` قبل الاستخدام.
- أي كتابة تحرّك الـ revision، فتُرفض النتيجة.

### 4.6 التراجع
- `rollbackJournal` يسجّل كل صف وعمود يستعيده في سجل النسخة.
- العامل يتراجع عن journal خطوته (`settle`/`window-settle`).
- المزامنة التالية تعيد التطابق.
- الحالة الوحيدة التي تُطلب فيها نسخة جديدة: نافذة **فاشلة** (`failed`)، لأنها قد تكون تباعدت.

### 4.7 طبقات النسخ لكل chunk (لصلاحية الكاشات)

| النسخ | تتحرك عند |
|---|---|
| `chunkVersions` | كل كتابة |
| `staticVersions` | كل كتابة غير المسار السريع للمحرك |
| `identityVersions` | كل كتابة، إلا الحقول المعفاة (IDENTITY_EXEMPT) في مكانها، **وإلا حقول المسار (ROUTE_TIER) في مكانها** (743eb2e) |
| `routedVersions` (جديدة) | كلما تحركت `identityVersions`، وأيضًا عند كتابة حقول المسار في مكانها |

قاعدة اختيار النسخ في كل جدول (`classScan`، `distinctRefs`، `refRowTables`):
1. حقل محرك → `chunkVersions`؛
2. وإلا حقل معفى → `staticVersions`؛
3. وإلا حقل مسار → `routedVersions`؛
4. وإلا → `identityVersions`.

### 4.8 أين يُسمح بالتأخر خطوة
- **العرض فقط:** الخريطة، وسطر الحالة، وبطاقات المسارات، وفحص الصحة.
- **لا يُسمح:** التحقق من الحفظ وأهلية الإرسال لا يأخذان نتيجة لا تطابق المخزن الحالي بالضبط.

---

## 5. بروتوكول الرسائل مع العامل

| الرسالة (رئيسي → عامل) | المحتوى | الرد |
|---|---|---|
| `replica` | نسخة كاملة (rows منقولة) + `importId` | `ready` + `route-keys` |
| `seed` | مقاطع الحفظ (منقولة) + meta + values + extras + `importId` | `ready` + `route-keys` |
| `compact` | `{dead:Int32Array, length}` | — |
| `sync` | الطول، live، structure، تغييرات القيم، الصفوف (bytes منقولة)؛ واختياريًا `step` أو `window` (معرّف المفتوح) | — (يقتطع إن قصر الطول؛ الموجّهة للمفتوح تُكتب في journal‑ه ولا تقبل أسطولًا أقصر، وغير الموجّهة تُرفض والخطوة مفتوحة) |
| `columns` | أعمدة كاملة | — |
| `routes` | خطط المسارات (`replace` أو إضافة) | — |
| `advance` / `window-*` / `settle` | خطوات المحرك (كما في 371) | `result` |
| `health` | `{simSeconds}` | `{issues}` أو `unavailable` |
| `classes` | `{fields, numeric, ids}` | `{rows:[[row,count,index,members]], ids}` |
| `query` | `{name, params, simSeconds}` (`dispatchEligible`، `routeCards`) | `{result}` (`legacy:true` إن احتاجت جدول الملكية القديم) |
| `inspect` | — (للاختبارات) | نسخة كاملة من النسخة |

---

## 6. جولة في الكود (مواقع الأسطر عند `bd4ccd9`)

| الملف:السطر | ما هو |
|---|---|
| `WebApp/fleet-store-core.js:170–184` | `markDirty`، `markRouteDirty`، `markVolatileDirty`، `markEngineDirty` (طبقات النسخ) |
| `fleet-store-core.js:215–223` | `reserveLog`، `takeLog`، `takeSeen`، `releaseJournal` (مجمّع الـ journal) |
| `fleet-store-core.js:255–260` | `newReplicaLog`، `logReplica` |
| `fleet-store-core.js:466–530` | `drainReplica`، `replicaClean`، `withoutReplicaLog`، `setReplicaSeed`، `takeReplicaSeed`، `compactRowsAt`، `truncateReplica` |
| `fleet-store-core.js:672–673` | `ROUTE_TIER`، `classScan` (اختيار النسخ) |
| `WebApp/fleet-engine-thread.js:93` | `answerRouteKeys` |
| `fleet-engine-thread.js:118` | `newReplica` (بذرة أو نسخة كاملة) |
| `fleet-engine-thread.js:138` | `replicaHolds` (لقطة القيم بعد الإعادة) |
| `fleet-engine-thread.js:146` | `sync` |
| `fleet-engine-thread.js:174` | `replicaIsStore` (البوابة + `replicaRefusals`) |
| `fleet-engine-thread.js:186` | `prime` |
| `fleet-engine-thread.js:326–346` | `health`، `current`، `fieldClasses`، `query` |
| `WebApp/fleet-engine-worker.js:26` | `routeKeys` |
| `fleet-engine-worker.js:111–190` | `seed`، `compact`، `sync`، `health`، `classes`، `query`، `inspect` |
| `WebApp/fleet-health-core.js` | فحص صحة الأسطول (منقول بلا تغيير من diagnostics-core) |
| `WebApp/fleet-query-core.js` | `dispatchEligible`، `routeCards` (منقولان بلا تغيير من app.js) |
| `WebApp/migration-core.js:100` | ضبط البذرة |
| `WebApp/save-schema.js:620` | `options.fleetClasses` في قسم الأسطول (انتظار حتى 1800 إطار، ثم `current()`) |
| `WebApp/control-plane-core.js:125` | تمرير المزوّد في المعاملة المرحلية فقط |
| `WebApp/app.js:782` | `afterStagedState` (منتظر لكل مهمة) |
| `app.js:927–948` | `validateDraftInSlices` (ينام ولا يدور أثناء الانتظار)، `fleetClassesForValidation`، `GH_FLEET_CLASSES_PROVIDER` |
| `app.js:956` | `runDurableStateCommand` (المزامنة في نهايته عبر `primeFleetThreadAfterCommand`) |
| `app.js:1808` | `fleetQuery` (العامل أو الرئيسي) |
| `app.js:1820` | `dispatchSharedInternationalNetwork` (يستخدم `dispatchEligible`) |
| `app.js:2196–2232` | `mapFleetClassRows`، `forEachMapFleetClass`، `mapFleetCount` |
| `app.js:2352` | `mapRoadRouteCount` |
| `app.js:3392` | `primeFleetThreadAfterCommand` |
| `app.js:3398` | `fleetEngineThread` (إنشاء العميل) |
| `app.js:3700–3708` | `realtimeHealthAllowed`، `runRealtimeHealth` |
| `app.js:3773` | `prime` كل 200ms في render عند الخمول + إنشاء مبكر للعميل |
| `app.js:4906` | `routeCenterLinkedSummary` (من نتيجة العامل + إعادة رسم) |

الأسطر تقريبية بعد أي تعديل؛ ابحث بالاسم.

---

## 7. الثوابت والاختبارات التي تحرسها

| الثابت | الاختبار |
|---|---|
| نسخة العامل = المخزن بايتًا ببايت بعد كل نوع تغيير: بذرة، commit، rollback، discard، محرك على الرئيسي، أعمدة، تبادل داخل معاملة ثم تراجع، كتابات بعد خطوة أو شوط نافذة تُرسل داخلها (داخلها، وبعد commit وrollback قبل أي تبادل جديد)، دمجان، استعادة القيم، النوافذ، reset | `build372-replica-log-browser` (5 طفرات مزروعة فشلت؛ سيناريو 4c جديد ناجح، وطفرة مزروعة فيه فشلت) |
| حفظ → فتح من الخزنة → بذرة بلا نسخ كامل، النسخة مطابقة، اللعب كله على العامل، حفظ → فتح | `build372-native-seed-browser` |
| مشكلات صحة الأسطول من العامل = من الرئيسي، بكل أنواع الأعطال وتراجعها؛ رفض أثناء خطوة؛ النتيجة تسمّي مخزنها | `build372-fleet-health-worker-browser` |
| أصناف العامل = أصناف الرئيسي (NaN، extras، حذف)؛ البوابة: خطوة غير مُعادة (رفض)، ثم مُعادة، ثم مكتوب بعدها (يُرسل داخلها ويطابق)، ثم عمود كامل بعدها (رفض)؛ القِدم | `build372-field-classes-worker-browser` (معدّل، ناجح) |
| التحقق الكامل بأصناف العامل = `validate()` الأصلي، سليمًا ومع كل عطل؛ النتيجة القديمة لا تُستخدم | `build372-save-validation-worker-browser` |
| كل أعداد الخريطة وسطر الحالة من الملخص = حساب الرئيسي؛ الأحدث يحل محل الأقدم؛ لا فهارس عبر دمج | `build372-map-summary-worker-browser` |
| التراجع يستعيد المخزن تمامًا رغم إعادة استخدام سجل الـ journal | `build372-journal-pool` (طفرة فشلت) |
| مسحا الإرسال والبطاقات من العامل = الرئيسي = الكود القديم حرفيًا؛ رفض الملكية القديمة | `build372-fleet-query-worker-browser` |
| كل كاش (أصناف، distinct، جداول المسارات، المعرفات) = مخزن بلا كاش، بعد 60 جولة كتابات عشوائية | `build372-route-tier` (طفرة فشلت) |
| لا long task عند إقفال اليوم المرحلي | `build358-staged-day-browser` (قديم) |

---

## 8. القياسات (الأدلة في `verification/build372-perf/`)

### 8.1 مليون طائرة، بلا تتبع، نفس الجهاز

| المرحلة | الإصدار | أسوأ فجوة | توقفات >50ms (مجموع) | p95 / p99 | Long tasks | CPU الرئيسي |
|---|---|---|---|---|---|---|
| الإرسال (48 أمرًا) | 7814b23 | 1133ms | 3882 (471s) | 116.7 / 533 | 4231 | — |
| الإرسال (48 أمرًا) | 838569c | 1100ms | 982 (229s) | 66.7 / **650** | 2158 | — |
| اللعب 90s | 7814b23 | 450ms | 19 (2.7s) | 16.8 / 33.3 | 26 (3.4s) | 22.6s |
| اللعب 90s | 838569c | 300ms | 14 (1.5s) | 16.8 / 16.8 | 13 (1.3s) | 11.2s |
| تقديم يومين | 7814b23 | 267ms | 69 (6.9s) | 33.3 / 66.6 | 96 | 65.1s |
| تقديم يومين | 838569c | 217ms | 62 (5.7s) | 16.8 / 66.7 | 72 | 39.3s |

- **ذاكرة المتصفح القصوى من الإرسال فما بعد:** 4242 MB في الأساس، و4232 MB في 838569c.
- **JS heap بعد GC:** 261 MB مقابل 260 MB.
- **838569c فقط:**
  - ذروة heap في اللعب 871 MB، والمتوسط 276 MB. لم تُقَس في الأساس، فلا نعرف إن كانت جديدة.
  - وقت العامل: نحو 73s في اللعب، و38s في التقويم.

### 8.2 قياسات مركّزة (للتطوير فقط، لا للقرار)
- **أول مزامنة على مليون صف** (`tools/bench_first_sync.cjs`): 240ms في الأساس، و1.9ms بالبذرة، و86ms بنسخة كاملة بلا بذرة.
- **إعادة 200 ألف صف في journal:** من 235–327ms إلى 28–37ms.
- **100 ألف طائرة على ec0031a** (`ec0031a-100k.json`): اللعب أسوأ 17ms، والتقويم أسوأ 50ms، والإرسال أسوأ 233ms.

### 8.3 غير مقاس على مليون
`ec0031a` و`743eb2e` و`bd4ccd9`.

---

## 9. ما بقي من التجمد وتشريحه (جولة متتبَّعة على 810b14f)

الملفات:
- `810b14f-dispatch-blocks.txt`، `810b14f-advance-blocks.txt` (من `tools/cpuprofile_blocks.py`)؛
- `810b14f-play-long-tasks.txt` (من `tools/attribute_long_tasks.py`)؛
- `810b14f-1m-traced.json`: أرقامه منفوخة بالتتبع، لا تُقارَن.

| المكان | الكتلة | السبب | الحالة |
|---|---|---|---|
| الإرسال | `scan` لكل الأسطول: مسح الأهلية في الأمر | مسح على الرئيسي | **عولج ec0031a، غير مقاس** |
| الإرسال | `openDrawer('routes') → routeCenterLinkedSummary` (460ms) | إعادة رسم المركز بعد كل أمر | **عولج ec0031a، غير مقاس** |
| الإرسال | `routeCenterFillAssignable` / `routeCenterManualAssets` / `routeCenterFleetSnapshot` | مسوح عرض أصغر | **باقٍ** |
| الإرسال | `deepClone` / `cloneWithoutJournaledRoots` | نسخ الحالة في بداية كل أمر دائم | **باقٍ** |
| الإرسال | جسم الأمر (`app.js` ~1811)، `assignRoutesBatch`/`departBatch`، `materialize`/`plain`، `encode`/`sha256`، `indexOfId` | عمل الأمر نفسه على الرئيسي | **باقٍ** |
| الإرسال | `commitDurableState`/`saveHash`/`uploadChunks` | الحفظ | **باقٍ** |
| اللعب | 334ms: `runCriticalTask → validationSteps → forEachSaveAssetClass` | فحص الحفظ بعد التثبيت داخل معاملة الشريحة المرحلية: الخطوة مُعادة ومفتوحة، والشريحة كتبت بعدها (`written-since-step`/`values-since-step`) | **عولج 5d43a97 (syncIntoOpen)، مُختبر، غير مقاس على مليون** |
| التقويم | 239 / 205ms: نفس المسار داخل نافذة التقويم بعد آخر شوط | نفس السبب (`windowSession` مفتوحة وكُتب بعدها) | **عولج 5d43a97 (syncIntoOpen للنوافذ)، مُختبر، غير مقاس على مليون** |
| اللعب والتقويم | 110–147ms: `GH_INTEGRITY_CORE.check → validateState → forEachClass` (دورة السوق وفحص الصحة) | تحرر المسارات كان يبطل جداول الهوية | **عولج 743eb2e، غير مقاس** |
| اللعب | 288 / 151ms GC خالص | ضغط تخصيص غير مشخَّص (ذروة heap 871MB) | **باقٍ** |
| اللعب | 1179ms / 108ms `recorderStart`/`recorderStop` | **من أداة القياس** (بلا `fleetPhaseHint`)، ليس من اللعبة | أصلح الأداة أو تجاهله |
| اللعب (سيناريو الأداة) | نسخة كاملة 110ms عند بدء اللعب | شراء متتابع قبل أي شريحة | **عولج bd4ccd9، غير مقاس** |

---

### 9.1 تحديث 2026-10-11 (جولة متتبَّعة على 62b4397، الأدلة غير محفوظة في المستودع لحجمها)
- **رفض العامل:** في اللعب `step-not-replayed` فقط (58، طلبات عرض أثناء خطوة)؛ في التقويم 256 منها و6 `mass-write-since-step` (عولج `564a657`). نسخة كاملة واحدة (`stale`) لأسطول اشتُري داخل الجلسة بلا بذرة.
- **عولج بعد هذا التتبع، غير مقاس على مليون:** كتلة 329ms (`aa13b7a`)، فحص السلامة 103–197ms (`065b942`)، صحة الصيانة (`952a59d`)، التأمين (`952a59d`)، فحص الحفظ في التقويم (`564a657`).
- **باقٍ:**
  - **الإرسال، بعد `4c06ffe` و`8e04e3d`** (إرسال 60 ألف طائرة، نفس الجهاز، مقابل `564a657`): سلسلة الإرسال 11090 → 9336ms، و`applyMs` 7896 → 6038، والتوقفات فوق 50ms 86 → 40، ومجموعها 7434 → 4118ms. الباقي في كل دفعة: تحويل الصفوف إلى كائنات على الرئيسي (`materialize`/`plain`/`jsonCopy`/`commit`)، ومشي النتائج بحثًا عن الوثائق (`collectResultDocuments`، `proofRefs`)، وثلاث تجزئات لازمة (مفتاح التكرار، والنية، والبصمة) وتجزئة الإيصال. تقليصها أكثر يمس عقد الأمر: الإيصالات كأصول كاملة، وربط الوثائق الموجودة في النتيجة بإثبات التفويض. قرار لصاحب المشروع.
  - **الإرسال (قبل ما سبق)** (أسوأ 1.6s متتبَّعًا): كل دفعة 500 طائرة نحو 300ms. نحو 35% توقيع الأمر (`encode`/`sha256` بجافاسكربت، و`stable`، و`defineData`، و`commandIntent`)، والباقي منطق الأمر لكل أصل (`assignRoutesBatch`، `departBatch`، `materialize`/`plain` للإيصالات، `indexOfId`/`loadLabel`). النقل للعامل يعني إعادة تصميم مسار الأمر: خطة وإيصالات وتوقيع في العامل، وتطبيق صفوف على الرئيسي، مع إثبات أن التوقيع والتحقق لا يضعفان. لم يُبدأ.
  - **التحقق من الإثباتات** في فحص الحفظ بالتقويم (163–222ms): تحقق أول مرة من سجلات مؤرشفة جديدة (sha256). يحتاج نسخة وثائق في عامل، وليس مسحًا للأسطول.
  - **مرور الأسطول اليومي** (`fleetDayPass`، 162ms لمرحلة واحدة): منطق المالكين والعمليات والصيانة لكل صف.
  - **GC** في اللعب (410ms) وذروة heap.
  - كتل `recorderStart`/`recorderStop` (574/114ms) من أداة القياس.

## 10. خطة العمل التالية بالترتيب، مع معايير القبول

### المهمة 1 — قياس HEAD على مليون (إلزامي قبل أي تغيير)
- **التنفيذ:** القسم 14، جولة بلا تتبع ثم جولة `--trace --profile`.
- **القبول:** ملف JSON محفوظ في `verification/build372-perf/<commit>-1m.json`، وجدول مقارنة مع `7814b23-1m.json` في README المجلد. افحص تحديدًا:
  - `fullSyncReasons`: هل اختفت النسخة الكاملة عند بدء اللعب؟
  - `replicaRefusals`: لماذا يرفض العامل في اللعب؟
  - هل اختفت كتل `GH_INTEGRITY_CORE.check` (743eb2e)؟
  - هل انخفضت كتل الإرسال (ec0031a)؟

### المهمة 2 — رفض العامل للتحقق داخل الشريحة (334ms)
- **إن كان السبب `written-since-step`**، أي كتابات على الأسطول بعد إعادة الخطوة داخل نفس المعاملة: الحل المرشح هو السماح بمزامنة تلك الصفوف إلى العامل والخطوة مفتوحة، فتدخل journal العامل وتتراجع معه.
- **احذر من:**
  - `applyValueChanges` و`writeColumns` لا يسجّلان في journal العامل. إثبات التطابق بعد التراجع ضروري، والمزامنة التالية تصحح، لكن يجب اختبار ذلك.
  - رسالة `sync` في العامل ترفض الآن إن كانت خطوة مفتوحة (`sync-while-step-open`).
- **القبول:** اختبار تفاضلي يضيف إلى `build372-replica-log-browser` سيناريو «خطوة + كتابات بعدها + تبادل + commit/rollback»، وغياب كتلة 334ms في قياس مليون.

### المهمة 3 — بقية كتل الإرسال
1. **نسخ المسودة:** حدّد بالملف ما الذي يُنسخ (`transactionCore.deepClone(state,{shareJournaledRoots:true})`)، وهل يمكن تشارك جذور لا يكتبها الأمر.
2. **جسم الأمر و`assignRoutesBatch`/`departBatch`:** هل يمكن حساب الخطة في العامل وإرجاع قائمة صفوف وقيم يطبّقها الرئيسي؟ (نمط `fleet-query-core`.)
3. **`encode`/`sha256` للنية والـ idempotency:** هل يمكن حسابه في العامل على نفس المدخلات؟
4. **مسوح مركز المسارات المتبقية.**
5. **الحفظ:** `saveHash` و`uploadChunks`.
- **القبول:** لكل نقل اختبار تفاضلي على نمط اختبارات build372. وفي قياس مليون: لا كتلة فوق 100ms في الإرسال، وp99 أقل من خط الأساس.

### المهمة 4 — GC وذروة heap في اللعب
- allocation sampling (CDP `HeapProfiler.startSampling`) أثناء اللعب.
- المشتبه بهم: `readRows`/`bytes` نتائج الخطوات، و`synced.values.slice()`، ونتائج `classes` و`query`، و`exportReplica`.
- **القبول:** لا مهمة GC فوق 50ms في اللعب، وذروة heap معروفة السبب.

### المهمة 5 — أداة القياس
- تمرير `fleetPhaseHint` في `recorderStart`/`recorderStop` داخل `tools/measure_fullgame_trace.cjs`، حتى لا تظهر كتلتها في النتائج.

### الهدف النهائي (من صاحب المشروع)
لا توقفات متكررة فوق 50ms، و60 FPS ثابتة في الإرسال الكبير واللعب، مثبتة بقياس كامل مقابل خط الأساس.

---

## 11. التحققات المطلوبة التي لم تكتمل

1. **تكرار `build358-staged-day-browser`:**
   - قبل الإصلاح: فشلان من نحو 10 تشغيلات.
   - بعد `274d764`: 11 نجاحًا متتاليًا.
   - **المطلوب:** عشرات التشغيلات، مثلًا:
     ```bash
     for i in $(seq 50); do node tests/build358-staged-day-browser.cjs >/dev/null 2>&1; echo -n "$? "; done
     ```
2. **القبول الكامل:** `tools/run_acceptance.py` على Node 24 (طريقته في `BUILD371_HANDOFF_AR.md` §1). نُفّذ بديل جزئي: نحو 80 اختبارًا قريبًا من التغييرات على Node 22، كلها نجحت (الملحق أ).
3. **مراجعة مستقلة** للتزامن وثبات الـ revision والتراجع وصحة الحفظ: لم تتم. ابدأ بالقسمين 4 و7.
4. **iPhone 17 Pro Max:**
   - هل نقل المقاطع بالملكية (transfer) وجمعها يعمل في WKWebView، ومع `fetch` من `gh://app/save-chunk/`؟
   - التوقيت والذاكرة والحرارة.
   - مثبت هنا في Chromium فقط.

---

## 12. المخاطر والحدود المعروفة

1. **النسخة الكاملة باقية** لمخزن جديد بلا بذرة. كلفتها 86ms على مليون صف في Chromium. تكرارها الفعلي غير مقاس؛ راقب `fullSyncReasons`.
2. **البذرة تحتفظ بمقاطع الخزنة** (حتى نحو 176MB على مليون: السعة لا الطول) حتى إنشاء العميل بعد التحميل بقليل. أثرها على ذروة الذاكرة في iPhone غير مقاس.
3. **انتظار أصناف التحقق:** حتى 1800 إطار، ثم العودة للرئيسي. في سياق متزامن (`drainSteps`) تنتهي الانتظارات فورًا، فيعود للرئيسي ولا يتعلق.
4. **العامل مشغول نحو 81% في اللعب** (73s من 90s). طلبات الصحة والأصناف والخريطة تزاحم خطوات المحرك، وأثرها على تأخر الخطوات غير مقاس.
5. **مجمّع سجل الـ journal** يحتفظ بما يصل إلى 32MB لكل مخزن، على الرئيسي وفي العامل.
6. **ذروة heap 871MB في اللعب** غير مشخَّصة.
7. **مركز المسارات** يعرض أصفارًا لحظيًا قبل أول نتيجة بعد فتحه.
8. **الملكية القديمة:** الصفوف بلا `ownerCompanyId`/`companyId` تجعل العامل يرفض، فيُحسب على الرئيسي كما كان.
9. **فحص الصحة غير متزامن الآن:** يُطبَّق عند وصول النتيجة إن بقيت الحالة حرة، وإلا يُعاد بعد نحو ثانية.
10. **اكتشافات جانبية سُجّلت فقط وأُصلحت لأنها في أداة القياس نفسها:** `bench_first_sync` كان يقرأ حالة التذكرة بعد `terminate`، وكان يضع `salePending:false` في كل صف فينقلها كلها إلى extras.

---

## 13. قائمة فحص

### قبل كل commit
- [ ] `python3 tools/refresh_fingerprints.py [ملفات-جديدة-متتبعة]`
- [ ] `node tests/lint.cjs` يعطي `[]`
- [ ] `python3 tools/verify_current_source.py` يعطي `verified: true`
- [ ] `git checkout -- verification/ && git clean -fd verification/r4-recovery` (إن مسّتها الاختبارات)
- [ ] اختبار تفاضلي جديد للتغيير، مسجّل في `test:build362` بـ`package.json`، مع طفرة مزروعة تُفشله
- [ ] الاختبارات القريبة تنجح (الملحق أ)
- [ ] commit واحد منطقي برسالة تشرح لماذا، وكم تغيّر القياس، وأي اختبار

### قبل أي طلب دمج (لا يتم دون إذن صاحب المشروع)
- [ ] قياس مليون كامل مقابل الأساس على نفس الجهاز
- [ ] القبول الكامل على Node 24 ناجح، وكل استثناء موثّق بدليل
- [ ] مراجعة مستقلة
- [ ] اختبار iPhone 17 Pro Max

---

## 14. كيفية القياس والتشريح خطوة بخطوة

1. **قياس بلا تتبع (للأرقام):**
   ```bash
   S=/tmp/perf; mkdir -p $S
   GH_PERF_ROOT=$PWD node --max-old-space-size=8192 tools/measure_fullgame_trace.cjs \
     --assets 1000000 --play 90 --days 2 --out $S/head-1m.json > $S/head-1m.log 2>&1 &
   ```
2. **ذاكرة المتصفح بجانبه:** `tools/sample_browser_rss.sh measure_fullgame_trace.cjs $S/rss.txt &` مباشرة بعد بدء القياس (كل ثانيتين، كل عمليات chromium بما فيها العامل). القيم في `verification/build372-perf/*-rss.txt` أُخذت بهذه الأداة.
3. **الخط الأساسي للمقارنة:** `verification/build372-perf/7814b23-1m.json`. لإعادته على جهاز آخر:
   ```bash
   git worktree add /tmp/base 7814b23
   git show 34acb68:tools/measure_fullgame_trace.cjs > /tmp/base/tools/zz_trace.cjs
   ```
   ثم شغّله بـ`GH_PERF_ROOT=/tmp/base`.
4. **التشريح** (الأرقام منفوخة؛ لا تقارنها):
   ```bash
   ... tools/measure_fullgame_trace.cjs ... --trace $S/play.trace.json --profile $S/dispatch.cpuprofile
   python3 tools/attribute_long_tasks.py $S/play.trace.json 15
   python3 tools/cpuprofile_blocks.py $S/dispatch.cpuprofile 8
   python3 tools/cpuprofile_blocks.py $S/dispatch-advance.cpuprofile 8
   ```
   تجاهل كتلة `CpuProfiler::StartProfiling` (نحو 1.6s) في أول التتبع، وكتل `recorderStart`/`recorderStop`.
5. **قراءة الحقول المهمة** في JSON كل مرحلة:
   - `worstMs`، `over50`، `stalls50TotalMs`، `p95`، `p99`؛
   - `longTasks.top`؛
   - `cpu.mainThreadTaskSeconds`؛
   - `heap.peakMB`؛
   - `fleetThread.{fullSyncReasons,seedSyncs,replicaRefusals,totalWorkerMs,classRequests,queryRequests,maxSyncMs}`.

---

## 15. مسرد

| المصطلح | المعنى |
|---|---|
| **المخزن (store)** | أسطول بصيغة أعمدة: صف 128 بايت لكل أصل، وجدول قيم مُدمجة (values)، وextras |
| **runtime المخزن** | فهارس وكاشات تُبنى من المخزن. مخزن مُستعاد أو مفكوك يحصل على runtime جديد (`uid` جديد) |
| **النسخة (replica)** | نسخة المخزن داخل العامل |
| **البذرة (seed)** | مقاطع الحفظ التي فُكّ منها المخزن، تُنقل للعامل كأول نسخة |
| **سجل النسخة** | علامات ما تغيّر منذ آخر مزامنة، مستهلكه الخيط وحده |
| **revision** | عدّاد يتحرك مع كل كتابة. الوسم `{store,runtime,revision,length,structure}` يثبت أن نتيجة ما تصف المخزن الآن |
| **خطوة (step) / نافذة (window)** | تقديم محرك الأسطول في العامل، يُعاد تشغيله على الرئيسي داخل معاملة الشريحة (apply)، ويُغلق بـsettle |
| **الإقفال المرحلي (staged)** | معاملة تُنفَّذ على أجزاء عبر الإطارات، مثل إقفال اليوم |
| **أمر دائم (durable command)** | أمر لاعب يعمل على مسودة، ثم يُحفظ ويُنشر |

---

## الملحق أ — الاختبارات التي شُغّلت ونجحت (Node 22 + Playwright 1.56.1)

**مخزن/journal/محرك:** build356-fleet-store، build357-fleet-journal، build355-fleet-access، build356-fleet-events، build358-row-snapshot-rollback، build358-transaction-row-snapshots، build371-route-holder-scan، build358-validation-classes، build358-fleet-scan، build358-route-capacity.

**الخيط/العامل:** build358-fleet-engine-thread-browser، build362-fleet-window-session، build362-calendar-window-equivalence، build359-sim-smoothness، build340-simulation-worker-contract.

**الحفظ/التحميل/الاسترداد:** build358-native-chunked-save، build358-fleet-chunk-manifest، persistence-regressions، build358-fleet-save-cap، build357-fleet-migration، build334-r4-recovery-browser، build334-r4-recovery-integration، build360-iphone-failure-recovery، build359-sliced-save-browser، build359-save-policy-browser، build334-deferred-save-lifecycle.

**التحقق والمعاملات:** build358-schema-sections، build359-schema-byte-limits، build363-control-outbox-atomicity، build334-durable-postcommit-contract، build359-durable-command-cost، build340-durable-draft-restore، build359-command-slices، build353-steady-slice-rollback، build363-staged-holdings-command، build359-incremental-maintenance.

**التقويم والمرحلية:** build358-staged-day-browser، build358-calendar-staged-completion، build358-staged-full-scope، build334-calendar-advance-browser، build334-calendar-journey-browser، build371-calendar-cancel-maintenance-browser.

**الإرسال والأوامر:** build358-large-fleet-dispatch-browser، build371-air-fleet-series-browser، build358-air-sea-dispatch-browser، build359-road-dispatch-browser، build371-air-destination-pool-browser، build371-durable-fleet-isolation-browser، build371-native-update-isolation-browser، build371-durable-live-fields-browser، build371-reload-trip-speed-browser، build371-old-save-trip-correction-browser.

**التشخيص:** build363-energy-health-contract، review-regressions، build336-diagnostics-transient، build363-runtime-diagnostics-contract، build339-diagnostic-frame-trace، fleet-regressions، core-regressions.

**الخريطة والواجهة:** build359-map-modes-browser، build358-map-controls-browser، build334-r2-map-local-dom، build340-map-asset-query، build340-map-structure-revision، build340-map-status-cache، build340-map-presentation، build359-map-geographic-budget، build359-map-canvas-layer، build366-mobility-map-policy-browser، build366-mobility-no-repeat-scans، build358-directory-open-sites-browser، build334-tabs-browser، build334-presentation-work-contract، build334-map-pressure-contract، build334-source-layout.

**كل اختبارات build372 التسعة.**

## الملحق ب — تعديلات على اختبارات/مساعدات قائمة (لا إضعاف)

- `tests/helpers/local-dom-app.js`: خيار `beforeScripts` (globals قبل تشغيل التطبيق، كغلاف iOS)، وكشف دوال للاختبار في `__AUDIT__`.
- `tests/helpers/core-harness.js`: تحميل `fleet-health-core` مع `diagnostics-core`.
- `tests/build340-map-status-cache.cjs`: stub «لا عامل» للدوال الجديدة؛ المسار المفحوص لم يتغير.
- `tests/build359-sim-smoothness.cjs`: نمط المصدر يقبل الخيار الجديد `fleetClasses:fleetClassesForValidation`.
- حُذف `tests/build371-staged-replica-browser.cjs` مع التجربة التي يختبرها.
