'use strict';
// BUILD282: يمنع رجوع انهيار محرك المحاكاة عند حدود الساعة/اليوم.
// الجذر: realism-core.js businessCases() كان يعرّف npv بـ const ثم يجمع عليه داخل حلقة NPV،
// فيرمي TypeError عند أول حدود ساعة تقبل القسمة على 12 (ومع كل حدود يوم)، بشرط وجود
// طلب اعتماد AI واحد بحالة "بانتظار". النتيجة كانت تجمّد simSeconds وتصفير speed نهائيًا.
// هذا الاختبار يفشل على الكود قبل الإصلاح ويعدّي بعده.
const assert = require('assert');
const { harness, minimal } = require('./helpers/core-harness.js');

const { s } = harness(['realism-core']);

function stateWithPendingRequest() {
  const st = minimal();
  st.advanced = {
    ai: {
      requests: [{
        id: 'REQ-NPV-GUARD-1',
        status: 'بانتظار الاعتماد',
        cost: 1000000,
        company: 'group',
        title: 'اختبار حماية NPV',
        reason: 'يجب أن تُحسب دراسة الجدوى بلا انهيار'
      }]
    }
  };
  return st;
}

// 1) حدود الساعة التي تقبل القسمة على 12 هي نقطة الانفجار الأصلية.
{
  const st = stateWithPendingRequest();
  assert.doesNotThrow(
    () => s.GH_REALISM.onHour(st, 12),
    'onHour at an hour%12===0 boundary must not throw while an AI request is pending'
  );
}

// 2) كل حدود يوم تستدعي businessCases بلا شرط.
{
  const st = stateWithPendingRequest();
  assert.doesNotThrow(
    () => s.GH_REALISM.onDay(st, 1),
    'onDay must not throw while an AI request is pending'
  );
}

// 3) الدراسة تُكتب فعلًا ولا تكون مجرد "لم تنفجر": NPV/IRR/Payback أرقام منتهية.
{
  const st = stateWithPendingRequest();
  s.GH_REALISM.onDay(st, 1);
  const study = st.realism && st.realism.ai && st.realism.ai.businessCases
    ? st.realism.ai.businessCases['REQ-NPV-GUARD-1']
    : null;
  assert.ok(study, 'a business case must be produced for the pending request');
  for (const key of ['npv', 'irr', 'payback', 'annualBenefit', 'score']) {
    assert.ok(Number.isFinite(Number(study[key])), `business case ${key} must be a finite number, got ${study[key]}`);
  }
  // NPV = -cost + مجموع 5 سنوات مخصومة؛ حلقة الخصم كانت هي ما ينفجر،
  // فلو انكسرت بصمت مستقبلًا سيبقى npv مساويًا لـ -cost بالضبط.
  assert.notStrictEqual(
    Number(study.npv), -Number(study.cost),
    'the 5-year discount loop must actually run - npv equal to -cost means the loop never executed'
  );
}

// 4) المحاكاة تتقدم عبر عدة حدود متتالية بلا انهيار (12h -> 24h -> 36h).
{
  const st = stateWithPendingRequest();
  for (const hour of [12, 24, 36, 48]) {
    assert.doesNotThrow(
      () => s.GH_REALISM.onHour(st, hour),
      `onHour(${hour}) must stay stable across consecutive 12-hour boundaries`
    );
  }
  for (const day of [1, 2, 3]) {
    assert.doesNotThrow(
      () => s.GH_REALISM.onDay(st, day),
      `onDay(${day}) must stay stable across consecutive day boundaries`
    );
  }
}

console.log('ai-business-case-npv-build282-test: ok');
