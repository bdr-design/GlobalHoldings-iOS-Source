'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'app.js'), 'utf8');
const adv = fs.readFileSync(path.join(__dirname, '..', 'WebApp', 'advanced-core.js'), 'utf8');

// 1) لوحظ في تسجيل شاشة حقيقي أن قاعدة طيران/بحرية (airport-base/port-base) تظهر كنقطة
// انطلاق ممكنة لمسار شاحنات بري - خلط بين شركات لا معنى تشغيليًا له ومربك للاعب.
assert(!/roadFacilityOptions\(\)\{[\s\S]{0,120}'port-base','airport-base'/.test(app), 'road route endpoints must not include airport-base/port-base facilities from other companies');
assert(app.includes("['depot','logistics'].includes(f.kind)&&companyOfFacility(f)==='road'"), 'road route endpoints must be restricted to actual road-company depot/logistics facilities');

// 2) لوحظ في نفس التسجيل تراكم 40 طلب AI معلّق خلال دقيقة واحدة من اللعب على شركة واحدة تقريبًا
// فارغة من الأصول والمنشآت - كل ساعة محاكاة كانت تقترح مطارًا/ميناءً مختلفًا لم يُقترح من قبل
// دون أي سقف عملي معقول على إجمالي التراكم بمرور الوقت.
assert(adv.includes('room=Math.max(0,3-pending.length)'), 'the per-company pending AI-suggestion cap must be lowered from the old value of 10 to keep the queue manageable');
assert(adv.includes("data-gh-action=\"ai-reject-all-pending\""), 'a bulk-reject action must exist so an already-accumulated backlog (old saves, or before this fix) can be cleared quickly');
assert(adv.includes("id==='ai-reject-all-pending'"), 'the bulk-reject action must actually be handled');

console.log('Road-route facility filter + AI suggestion backlog cap (from user screen recording) BUILD268: PASS');

// 3) لوحظ في تسجيل شاشة حقيقي: زر "شراء يدوي" لا ينفذ الشراء إطلاقًا بعد فتح قاعدة عالمية،
// رغم أن الشركة القابضة تملك سيولة ضخمة - لأن فتح القاعدة يموَّل تلقائيًا (BUILD267) لكن شراء
// الأصول لا يزال يفحص رصيد الشركة التابعة فقط دون اللجوء للقابضة عند العجز.
assert(app.includes("canCompanySpend(type,upfront,'capex')&&type!=='group'"), 'buyAsset must check the subsidiary\u2019s own capex budget before attempting to auto-fund a shortfall');
assert(app.includes("تمويل شراء أصول يدوي"), 'buyAsset must auto-fund a subsidiary shortfall from the group, exactly like awardConstruction already does, so a well-funded holding company never silently blocks a manual purchase');

// 4) لوحظ أيضًا: عنوان صفحة "الشراء اليدوي للأصول" كان لا يزال يعرض اسم اللوحة الميتة
// المحذوفة في BUILD260 ("منظومة الأصول الذكية")، رغم أن محتوى الصفحة صحيح فعليًا - عنوان
// متبقٍ من التنظيف السابق يعطي انطباعًا مربكًا بأن نظام AI القديم عاد.
assert(!adv.includes("procurement:['التشغيل والأصول','منظومة الأصول الذكية']"), 'the procurement page title must not still show the name of the AI system removed in BUILD260');
assert(adv.includes("procurement:['التشغيل والأصول','الشراء اليدوي للأصول']"), 'the procurement page title must accurately reflect its current manual-purchase content');
