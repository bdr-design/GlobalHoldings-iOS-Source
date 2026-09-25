(() => {
  'use strict';

  const VERSION = '3.0.0';

  function result(name, checks) {
    const blocked = checks.filter(check => !check.ok && check.blocking !== false);
    const warnings = checks.filter(check => !check.ok && check.blocking === false);
    return { policy: name, approved: blocked.length === 0, blocked, warnings, checks, at: Date.now() };
  }

  function procurement(facts = {}) {
    return result('ProcurementPolicy', [
      { id: 'catalog', ok: !!facts.item, blocking: true, message: 'الأصل يجب أن يكون موجودًا في الكتالوج.' },
      { id: 'base', ok: !!facts.base, blocking: true, message: 'يجب وجود منشأة تسليم مملوكة ومتوافقة.' },
      { id: 'qty', ok: Number(facts.qty) > 0 && Number.isInteger(Number(facts.qty)), blocking: true, message: 'الكمية يجب أن تكون عددًا صحيحًا موجبًا.' },
      { id: 'capacity', ok: Number(facts.freeCapacity) >= Number(facts.qty), blocking: true, message: 'السعة المتاحة أقل من الكمية المطلوبة.' },
      { id: 'funding', ok: Number(facts.fundingGap) <= 0, blocking: true, message: 'توجد فجوة تمويل غير مغلقة.' }
    ]);
  }

  function delivery(facts = {}) {
    return result('DeliveryPolicy', [
      { id: 'destination', ok: !!facts.base, blocking: true, message: 'وجهة التسليم المملوكة غير متاحة.' },
      { id: 'payment', ok: !!facts.payment, blocking: true, message: 'دليل دفع الشراء غير موجود.' },
      { id: 'asset', ok: !!facts.asset, blocking: true, message: 'بيانات الأصل المطلوب تسليمه غير مكتملة.' }
    ]);
  }

  function evaluate(name, facts) {
    if (name === 'procurement') return procurement(facts);
    if (name === 'delivery') return delivery(facts);
    return result(name, []);
  }

  const API = Object.freeze({ VERSION, evaluate, procurement, delivery });
  globalThis.GH_POLICY_CORE = API;
  if (globalThis.window && globalThis.window !== globalThis) globalThis.window.GH_POLICY_CORE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
