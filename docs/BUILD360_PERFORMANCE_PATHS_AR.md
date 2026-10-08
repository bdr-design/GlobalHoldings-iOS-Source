# مسارات علاج الثقل والحماية — العمل المحلي بعد Build 358

تاريخ الوثيقة: 8 أكتوبر 2026
الحالة: توثيق عمل محلي غير مرفوع وغير معتمد للإصدار. لا يغيّر تعليمات التسليم في `BUILD358_HANDOFF_R2_AR.md`، ولا يثبت نجاحًا على iPhone فعلي.

## الهدف

هذه الجولة تعالج الأسباب التي ظهرت في تشخيص 30 ألف أصل: توقفات إطار المحاكاة، الحفظ الأصلي، تضخم التاريخ المالي الساخن، والتحذير الكاذب أثناء المؤتمر. لا تغيّر نتائج الاقتصاد أو ترتيب ملاك المحاكاة.

## خريطة المسارات

| المسار | سلسلة الاستدعاء | ما تغيّر | دليل التتبع |
|---|---|---|---|
| تحذير المؤتمر | `app.recordGuardedDiagnosticFrame` → `diagnostics.recorderFrame` → نافذة تقدم المحاكاة | الإطار المحروس يرسل `simulationProgressExpected:false`؛ المسجل يعيد تثبيت نافذة التقدم ويحفظ `lastExpectedPause` | `simulationProgressExpected`, `lastExpectedPause.reason` |
| خطوة المحاكاة | `simulation-core` → `realism.advanceStages` → ملاك البنك/السوق/المخاطر/البرامج… | فصل الملاك إلى مراحل مستقلة وخفض شريحة العمليات إلى 2,048 صفًا | مراحل المعاملة في التشخيص ومدة كل frame |
| صيانة الأسطول | `app.maintenanceTaskStep('fleet')` → `fleet-access.maintainStages` → `fleet-store.collectValuesStages` | تعليم القيم الحية على شرائح؛ لا sweep إذا تغيرت revision أثناء التعليم؛ إعادة المحاولة من حالة جديدة | `stale`, `restarts`, وعدد yields في اختبار السلاسة |
| تحقق الحفظ | `save-schema.validationSteps` → route-state → finance → books → authorization → document-proofs | الأقسام الثقيلة موزعة على إطارات منفصلة مع بقاء نتيجة `validate()` نفسها | أسماء `post-commit:*` في telemetry |
| الحفظ المقطّع | `persistence.commitStateSliced` → `state-codec.serializeChunkedSteps` → `uploadChunks` → `GlobalSaveVault.commitLocked` | بيانات الأسطول والنصوص المختومة وصفحات الأرشيف البارد ترفع كـchunks قبل JSON | `chunk-upload`, `nativeVaultStages`, manifest `stateCodec.chunks` |
| تنظيف chunks | `commitLocked` → `scheduleChunkGarbageLocked` → background mark → vault queue bounded sweep | لا تعداد مجلد أو قراءة ملفات أو حذف غير محدود قبل ACK؛ الحذف 8 ملفات في الدفعة مع إعادة فحص هوية كل ملف حامٍ | `chunkGcScheduleMs`, `chunkGcDeferred`, `backgroundChunkGc*` |
| الأرشيف المالي | `auditSealSelection` → `sealAuditRound` → `createColdArchivePage` → native chunk | النافذة الساخنة 90 يومًا وبحد 5,000 صف؛ الصفوف القديمة محفوظة كاملة خارج الرسم الحي | `coldArchiveStats`: pages/rows/bytes |
| البحث التاريخي | `finance.findArchivedDocument` → hot index → `findColdArchivedDocument` → `coldArchiveRows` | فك صفحة مطلوبة عند البحث فقط؛ الصفوف المفكوكة لا تُخزن في cache | اختبار إعادة إصدار الشيك واختبار lookup للفاتورة |

## عقود الوقاية

1. لا تُحذف صفحة مالية قبل إنشاء bytes محمية بالـchecksum وإدخالها في نفس معاملة `finance/documentProofs/coldArchive`.
2. فشل الختم يعيد الجذور الثلاثة كما كانت. صفحة أنشئت ثم تراجعت المعاملة لا تبقى في الحالة.
3. الحفظ الأصلي يرفض أي chunk مفقود. تحميل الصفحة يرفض تغيير الطول أو checksum أو التكرار أو id غير المدرج.
4. نسخ durable draft وrollback وreset تورّث ملكية bytes عبر `inheritColdArchive` من دون فك الصفوف إلى كائنات دائمة.
5. تنظيف Native لا يحذف ملفًا إذا تغيرت مجموعة ملفات JSON الحامية أو هوياتها أثناء الفحص. الملف غير المقروء يؤدي إلى تأجيل التنظيف.
6. أي chunk رُفع خلال فترة السماح يبقى محميًا حتى لو ظهر بعد لقطة بداية الفحص.
7. صيانة قيم Fleet لا تنفذ sweep على علامة قديمة؛ تغير revision أو generation يعيد المحاولة.

## القياس والتشخيص

- `stateByteProfile.rootBytes`: حجم الرسم الساخن القابل للتسلسل.
- `stateByteProfile.externalBytes`: bytes صفحات الأرشيف البارد خارج الرسم الساخن.
- `stateByteProfile.residentBytes`: مجموع الاثنين لأغراض المقارنة.
- `stateByteProfile.targeted.coldArchive`: عدد الصفحات والصفوف والبايتات وحالة السلامة.
- `nativeVaultStages.chunkGcMs` يجب أن يساوي صفرًا، و`chunkGcDeferred` يساوي 1.
- نتيجة آخر تنظيف مكتمل تظهر في مفاتيح `backgroundChunkGcGeneration/Ms/ScannedBytes/Candidates/Protected/Deleted/Aborted` في ACK لاحق.

## اختبارات الحماية المضافة أو الموسعة

- `tests/build360-cold-archive.cjs`: export ذاتي، native chunks، النسخ، القياس، والاستبدال/النقص/التكرار/التلف.
- `tests/build358-native-chunked-save.cjs`: رفع صفحة مالية مرة واحدة، حفظ sliced، bootstrap، وفقد chunk.
- `tests/build359-archive-seal.cjs`: 90 يومًا/5,000 صف، استرجاع كامل، lookup بارد، ومنع تكرار الشيك.
- `tests/build359-document-seal.cjs`: rollback دقيق بعد إنشاء صفحة باردة.
- `tests/build359-sim-smoothness.cjs`: صيانة Fleet على شرائح ورفض sweep القديم.
- `tests/build339-diagnostic-frame-trace.cjs`: لا تحذير كاذب أثناء guard المؤتمر، ثم عودة كشف التوقف الحقيقي.
- اختبارات Native المولدة تنتظر `drainChunkGarbageAsync` قبل فحص الملفات المحذوفة.

## التحقق الحالي

- `npm test`: ناجح كاملًا محليًا في Linux/Chromium بتاريخ الوثيقة.
- `npm run lint`: ناجح.
- توليد حزمة اختبارات Native من `tests/native/prepare_native_tests.py`: ناجح.
- بناء Swift وتشغيل اختبارات Native وقياس iPhone فعلي: غير متاح في هذه البيئة، ويبقى بوابة P0 قبل اعتماد الإصدار.

## تنظيف مساحة العمل قبل التسليم

أزل `node_modules/` إذا ثُبت بـ`npm install --no-save`، وكل `__pycache__/` وملفات القياس المؤقتة. لا تحدّث `RUNTIME_SOURCE_MANIFEST.json` أو `SOURCE_INTEGRITY_SHA256.txt` أو `RELEASE_GATE.json` إلا بعد اكتمال كل أعمال التحديث واختيار المالك لنقطة التسليم.
