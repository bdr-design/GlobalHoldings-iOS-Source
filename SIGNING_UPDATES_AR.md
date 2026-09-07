# توقيع تحديثات Global Holdings

من الإصدار 2.3.3، تحديثات WebApp هي **Clean Snapshot كاملة فقط**. أداة Delta/Overlay أزيلت من المستودع.

## بناء الحزمة
احتفظ بالمفتاح الخاص خارج المستودع ثم شغّل:

```bash
GH_UPDATE_SIGNING_KEY_FILE=/path/to/private-key.txt python3 scripts/build_update.py
```

الحزمة الناتجة تحمل:
- `packageType: full-web`
- `installMode: clean-snapshot-v1`
- `signaturePayloadVersion: 2`
- Ed25519 signature
- SHA-256 لكل ملف
- `filesIndexSha256`
- `operationsSha256`

التوقيع v2 يغطي أيضًا الحد الأدنى للإصدار ونوع الحزمة ونمط التثبيت حتى لا يمكن تحويل Clean Snapshot إلى وضع آخر بتعديل الـmanifest.

**لا تضع المفتاح الخاص داخل Git أو ZIP المشروع.**
