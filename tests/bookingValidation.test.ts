/**
 * 智能预约校验 —— 边界场景测试脚本（无需测试框架，直接 node 运行）
 *
 * 运行： npm run test:booking
 * 覆盖：
 *  1. countConsecutiveNoShows 仅统计预约日期及之前的 no_show
 *  2. preferredEmployeeId 仅依据历史「已完成」预约推荐（通过 validateBooking 间接验证）
 *  3. 连续项目 15 分钟消毒缓冲
 *  4. 高阶项目技能标签 + 在岗校验（无匹配则阻断）
 *  5. 套餐抵扣 vs 积分抵扣互斥择优
 *  6. 钻石会员连续爽约 2 次 → 需二次确认 + 禁用积分
 *  7. 营业时间边界提示
 *  8. store 结算按预约状态驱动：pending 不扣、confirmed/completed 扣、取消/爽约/删除回退
 */
import assert from 'node:assert';
import type {
  Appointment,
  AppointmentBilling,
  Customer,
  Employee,
  Membership,
  Schedule,
  Service,
  CustomerPackage,
  SkinAnalysis,
  Allergy,
} from '../src/types';
import {
  validateBooking,
  countConsecutiveNoShows,
  computePricing,
} from '../src/utils/bookingValidation';
import {
  appReducer,
  addAppointment,
  updateAppointment,
  deleteAppointment,
} from '../src/store';
import {
  STERILIZATION_BUFFER_MINUTES,
  NO_SHOW_CONFIRM_THRESHOLD,
  MEMBERSHIP_DISCOUNT,
} from '../src/utils/bookingRules';

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

// ---- 固定测试数据（确定性，不用随机 mock）----
const iso = (d: Date) => d.toISOString();
// 使用本地时间构造，与引擎内 getHours()（营业时间判断）保持一致
const at = (dayOffset: number, hour = 10) => {
  const d = new Date(2026, 5, 15, 0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const services: Service[] = [
  { id: 'S001', name: '深层清洁', category: '面部护理', duration: 60, price: 400, description: '', suitableSkin: ['油性'], effectDescription: '', imageUrl: '', status: 'active' },
  { id: 'S003', name: '美白焕肤', category: '面部护理', duration: 90, price: 600, description: '', suitableSkin: ['中性'], effectDescription: '', imageUrl: '', status: 'active' },
  { id: 'S015', name: '美甲', category: '美甲', duration: 45, price: 120, description: '', suitableSkin: ['中性'], effectDescription: '', imageUrl: '', status: 'active' },
];

// 引擎按 UTC 日期查排班，而本地/UTC 日期可能跨天；覆盖 前后各一天 以消除时区影响
const scheduleFor = (employeeId: string, date: Date): Schedule[] =>
  [-1, 0, 1].map((off) => {
    const d = new Date(date);
    d.setDate(d.getDate() + off);
    return {
      id: `SC-${employeeId}-${d.toISOString().slice(0, 10)}`,
      employeeId,
      date: d.toISOString().split('T')[0],
      shiftType: 'full_day' as const,
      startTime: '00:00',
      endTime: '23:59',
    };
  });

const customers: Customer[] = [
  { id: 'C1', name: '甲', phone: '1', birthday: '', gender: 'female', avatar: '', address: '', skinType: '油性', notes: '', createdAt: '' },
  { id: 'C2', name: '乙(钻石)', phone: '2', birthday: '', gender: 'female', avatar: '', address: '', skinType: '中性', notes: '', createdAt: '' },
];

const baseData = (overrides: {
  employees?: Employee[];
  appointments?: Appointment[];
  memberships?: Membership[];
  customerPackages?: CustomerPackage[];
  schedules?: Schedule[];
}) => ({
  services,
  employees: overrides.employees ?? [],
  appointments: overrides.appointments ?? [],
  schedules: overrides.schedules ?? [],
  memberships: overrides.memberships ?? [],
  customerPackages: overrides.customerPackages ?? [],
  skinAnalyses: [] as SkinAnalysis[],
  allergies: [] as Allergy[],
  customers,
});

const emp = (id: string, skills: string[]): Employee => ({
  id, name: id, role: 'beautician', phone: '', avatar: '', hireDate: '', baseSalary: 0, commissionRate: 0, skills, status: 'active',
});

console.log('booking validation boundary tests');

// ---- 1. countConsecutiveNoShows: 仅统计参考日期及之前 ----
check('countConsecutiveNoShows 忽略晚于参考日期的 no_show', () => {
  const appts: Appointment[] = [
    // 晚于参考日 (day+5) 的 no_show —— 不应计入
    { id: 'a-future', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(5)), endTime: iso(at(5, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
    // 参考日之前的两次 no_show
    { id: 'a1', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-1)), endTime: iso(at(-1, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
    { id: 'a2', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-2)), endTime: iso(at(-2, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
  ];
  const ref = at(0);
  assert.strictEqual(countConsecutiveNoShows('C2', appts, ref), 2, '参考日前应为 2 次');
  // 不传参考日则统计全部（含未来），得 3
  assert.strictEqual(countConsecutiveNoShows('C2', appts), 3, '无参考日应统计全部');
});

check('countConsecutiveNoShows 遇到已完成即中断连续', () => {
  const appts: Appointment[] = [
    { id: 'b1', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-1)), endTime: iso(at(-1, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
    { id: 'b2', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-2)), endTime: iso(at(-2, 11)), duration: 60, status: 'completed', source: 'phone', notes: '', reminderSent: false },
    { id: 'b3', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-3)), endTime: iso(at(-3, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
  ];
  assert.strictEqual(countConsecutiveNoShows('C2', appts, at(0)), 1, '完成记录应中断连续统计');
});

check('countConsecutiveNoShows: cancelled / pending / confirmed 也中断连续', () => {
  const mk = (id: string, status: Appointment['status'], day: number): Appointment => ({
    id, customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(day)), endTime: iso(at(day, 11)), duration: 60, status, source: 'phone', notes: '', reminderSent: false,
  });
  // 最近一条 cancelled → 打断，连续爽约=0
  assert.strictEqual(
    countConsecutiveNoShows('C2', [mk('c1', 'cancelled', -1), mk('c2', 'no_show', -2), mk('c3', 'no_show', -3)], at(0)),
    0,
    'cancelled 应中断'
  );
  // 最近一条 pending → 打断
  assert.strictEqual(
    countConsecutiveNoShows('C2', [mk('p1', 'pending', -1), mk('p2', 'no_show', -2)], at(0)),
    0,
    'pending 应中断'
  );
  // 最近一条 confirmed → 打断
  assert.strictEqual(
    countConsecutiveNoShows('C2', [mk('f1', 'confirmed', -1), mk('f2', 'no_show', -2)], at(0)),
    0,
    'confirmed 应中断'
  );
  // 顶部两条 no_show，第三条 cancelled → 只数到 2
  assert.strictEqual(
    countConsecutiveNoShows('C2', [mk('n1', 'no_show', -1), mk('n2', 'no_show', -2), mk('n3', 'cancelled', -3), mk('n4', 'no_show', -4)], at(0)),
    2,
    '中间 cancelled 应截断累计'
  );
});

// ---- 2. preferredEmployeeId: 仅依据「已完成」预约 ----
check('优先美容师仅取历史已完成预约（忽略 cancelled/pending）', () => {
  const start = at(0, 10);
  const appts: Appointment[] = [
    // 最近的一条是 cancelled -> 不应作为优先依据
    { id: 'p1', customerId: 'C1', serviceId: 'S001', employeeId: 'E2', startTime: iso(at(-1)), endTime: iso(at(-1, 11)), duration: 60, status: 'cancelled', source: 'phone', notes: '', reminderSent: false },
    // 更早的一条是 completed，由 E1 完成 -> 应优先 E1
    { id: 'p2', customerId: 'C1', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-3)), endTime: iso(at(-3, 11)), duration: 60, status: 'completed', source: 'phone', notes: '', reminderSent: false },
  ];
  const employees = [emp('E1', ['S001']), emp('E2', ['S001'])];
  const res = validateBooking({
    customerId: 'C1',
    serviceIds: ['S001'],
    startTime: start,
    data: baseData({ employees, appointments: appts, schedules: [...scheduleFor("E1", start), ...scheduleFor("E2", start)] }),
  });
  assert.strictEqual(res.schedule[0].employeeId, 'E1', '应优先安排历史已完成的 E1');
});

// ---- 3. 连续项目 15 分钟缓冲 ----
check(`连续项目间自动留 ${STERILIZATION_BUFFER_MINUTES} 分钟消毒缓冲`, () => {
  const start = at(0, 10);
  const employees = [emp('E1', ['S001', 'S003'])];
  const res = validateBooking({
    customerId: 'C1',
    serviceIds: ['S001', 'S003'],
    startTime: start,
    data: baseData({ employees, schedules: [...scheduleFor("E1", start)] }),
  });
  const gapMin = (new Date(res.schedule[1].startTime).getTime() - new Date(res.schedule[0].endTime).getTime()) / 60000;
  assert.strictEqual(gapMin, STERILIZATION_BUFFER_MINUTES, '两项目间隔应等于缓冲时间');
  assert.strictEqual(res.schedule[1].bufferBefore, STERILIZATION_BUFFER_MINUTES);
});

// ---- 4. 高阶项目技能标签 + 在岗校验 ----
check('高阶项目无技能匹配 → 阻断', () => {
  const start = at(0, 10);
  const employees = [emp('E1', ['S015'])]; // 只会美甲，不会面部护理
  const res = validateBooking({
    customerId: 'C1',
    serviceIds: ['S001'],
    startTime: start,
    data: baseData({ employees, schedules: [...scheduleFor("E1", start)] }),
  });
  assert.strictEqual(res.canProceed, false, '应阻断');
  assert.ok(res.issues.some((i) => i.level === 'block' && i.code === 'NO_EMPLOYEE'));
});

check('高阶项目有技能且在岗 → 通过', () => {
  const start = at(0, 10);
  const employees = [emp('E1', ['S001'])];
  const res = validateBooking({
    customerId: 'C1',
    serviceIds: ['S001'],
    startTime: start,
    data: baseData({ employees, schedules: [...scheduleFor("E1", start)] }),
  });
  assert.strictEqual(res.canProceed, true);
  assert.strictEqual(res.schedule[0].employeeId, 'E1');
});

check('有技能但不在岗（off）→ 阻断', () => {
  const start = at(0, 10);
  const employees = [emp('E1', ['S001'])];
  const offShift: Schedule = { id: 'off', employeeId: 'E1', date: start.toISOString().split('T')[0], shiftType: 'off', startTime: '--', endTime: '--' };
  const res = validateBooking({
    customerId: 'C1',
    serviceIds: ['S001'],
    startTime: start,
    data: baseData({ employees, schedules: [offShift] }),
  });
  assert.strictEqual(res.canProceed, false, '不在岗应阻断');
});

// ---- 5. 套餐 vs 积分互斥择优 ----
check('套餐命中更划算 → 推荐 package', () => {
  const membership: Membership = { id: 'M1', customerId: 'C1', level: 'gold', points: 100000, totalSpent: 0, joinDate: '', expireDate: '2027-01-01' };
  const cp: CustomerPackage = {
    id: 'CP1', customerId: 'C1', packageId: 'P1', purchaseDate: '2026-01-01', expireDate: '2027-01-01', status: 'active',
    items: [{ serviceId: 'S001', totalCount: 3, remainingCount: 2 }],
  };
  const pricing = computePricing({ customerId: 'C1', serviceIds: ['S001'], membership, services, customerPackages: [cp], pointsDisabled: false });
  assert.strictEqual(pricing.recommendedKey, 'package');
  const pkg = pricing.plans.find((p) => p.key === 'package')!;
  assert.strictEqual(pkg.finalCash, 0, '套餐命中该项目应免现金');
});

check('会员折扣按等级生效（gold）', () => {
  const membership: Membership = { id: 'M1', customerId: 'C1', level: 'gold', points: 0, totalSpent: 0, joinDate: '', expireDate: '2027-01-01' };
  const pricing = computePricing({ customerId: 'C1', serviceIds: ['S001'], membership, services, customerPackages: [], pointsDisabled: false });
  assert.strictEqual(pricing.membershipDiscount, MEMBERSHIP_DISCOUNT.gold);
  const points = pricing.plans.find((p) => p.key === 'points')!;
  assert.strictEqual(points.subtotal, Math.round(400 * MEMBERSHIP_DISCOUNT.gold));
});

// ---- 6. 钻石会员连续爽约 2 次 → 二次确认 + 禁用积分 ----
check(`钻石连续爽约 ${NO_SHOW_CONFIRM_THRESHOLD} 次 → requiresConfirm + 禁用积分`, () => {
  const start = at(0, 10);
  const membership: Membership = { id: 'M2', customerId: 'C2', level: 'diamond', points: 100000, totalSpent: 0, joinDate: '', expireDate: '2027-01-01' };
  const appts: Appointment[] = [
    { id: 'n1', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-1)), endTime: iso(at(-1, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
    { id: 'n2', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-2)), endTime: iso(at(-2, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
  ];
  const employees = [emp('E1', ['S001'])];
  const res = validateBooking({
    customerId: 'C2',
    serviceIds: ['S001'],
    startTime: start,
    data: baseData({ employees, appointments: appts, memberships: [membership], schedules: [...scheduleFor("E1", start)] }),
  });
  assert.strictEqual(res.requiresReceptionistConfirm, true, '应需二次确认');
  assert.strictEqual(res.pricing.pointsDisabled, true, '应禁用积分');
  const points = res.pricing.plans.find((p) => p.key === 'points')!;
  assert.strictEqual(points.pointsDeductAmount, 0, '禁用后积分抵扣应为 0');
  assert.strictEqual(points.finalCash, points.subtotal, '禁用后最终现金=小计');
});

check('钻石仅爽约 1 次 → 不触发二次确认', () => {
  const start = at(0, 10);
  const membership: Membership = { id: 'M2', customerId: 'C2', level: 'diamond', points: 100000, totalSpent: 0, joinDate: '', expireDate: '2027-01-01' };
  const appts: Appointment[] = [
    { id: 'n1', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-1)), endTime: iso(at(-1, 11)), duration: 60, status: 'no_show', source: 'phone', notes: '', reminderSent: false },
    { id: 'n0', customerId: 'C2', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(-2)), endTime: iso(at(-2, 11)), duration: 60, status: 'completed', source: 'phone', notes: '', reminderSent: false },
  ];
  const employees = [emp('E1', ['S001'])];
  const res = validateBooking({
    customerId: 'C2',
    serviceIds: ['S001'],
    startTime: start,
    data: baseData({ employees, appointments: appts, memberships: [membership], schedules: [...scheduleFor("E1", start)] }),
  });
  assert.strictEqual(res.requiresReceptionistConfirm, false);
  assert.strictEqual(res.pricing.pointsDisabled, false);
});

// ---- 7. 营业时间边界提示 ----
check('超出营业时间给出 OUT_OF_HOURS 提示', () => {
  const start = at(0, 20); // 20:00 开始 60 分钟且叠加项目会跨过 21:00
  const employees = [emp('E1', ['S001', 'S003'])];
  const res = validateBooking({
    customerId: 'C1',
    serviceIds: ['S001', 'S003'],
    startTime: start,
    data: baseData({ employees, schedules: [...scheduleFor("E1", start)] }),
  });
  assert.ok(res.issues.some((i) => i.code === 'OUT_OF_HOURS'), '应提示超出营业时间');
});

// ---- 8. store 结算按预约状态驱动（pending 不扣、confirmed 扣、取消/爽约回退）----
type AppSlice = ReturnType<typeof appReducer>;

// 构造一份最小化 state（复用 reducer 初始 state，替换成确定性数据）
const makeState = (): AppSlice => {
  const base = appReducer(undefined, { type: '@@INIT' });
  return {
    ...base,
    appointments: [],
    memberships: [
      { id: 'M1', customerId: 'C1', level: 'gold', points: 1000, totalSpent: 0, joinDate: '', expireDate: '2027-01-01' },
    ],
    customerPackages: [
      { id: 'CP1', customerId: 'C1', packageId: 'P1', purchaseDate: '2026-01-01', expireDate: '2027-01-01', status: 'active', items: [{ serviceId: 'S001', totalCount: 3, remainingCount: 2 }] },
    ],
  };
};

const pkgAppt = (id: string, status: Appointment['status']): Appointment => {
  const billing: AppointmentBilling = {
    plan: 'package', membershipDiscount: 0.95, listPrice: 400, coveredByPackage: true, customerPackageId: 'CP1', pointsUsed: 0, pointsDeductAmount: 0, finalAmount: 0,
  };
  return { id, customerId: 'C1', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(0)), endTime: iso(at(0, 11)), duration: 60, status, source: 'walk_in', notes: '', reminderSent: false, billing };
};

const pointsAppt = (id: string, status: Appointment['status']): Appointment => {
  const billing: AppointmentBilling = {
    plan: 'points', membershipDiscount: 0.95, listPrice: 400, coveredByPackage: false, pointsUsed: 200, pointsDeductAmount: 2, finalAmount: 378,
  };
  return { id, customerId: 'C1', serviceId: 'S001', employeeId: 'E1', startTime: iso(at(0)), endTime: iso(at(0, 11)), duration: 60, status, source: 'walk_in', notes: '', reminderSent: false, billing };
};

const remaining = (s: AppSlice) => s.customerPackages[0].items[0].remainingCount;
const points = (s: AppSlice) => s.memberships[0].points;

check('pending 状态创建预约 → 不扣套餐/积分', () => {
  const s0 = makeState();
  const s1 = appReducer(s0, addAppointment(pkgAppt('ap1', 'pending')));
  assert.strictEqual(remaining(s1), 2, 'pending 不应扣套餐次数');
  assert.strictEqual(s1.appointments[0].billing?.settled, undefined, 'pending 不应标记 settled');
});

check('confirmed 状态创建预约 → 立即扣套餐次数', () => {
  const s0 = makeState();
  const s1 = appReducer(s0, addAppointment(pkgAppt('ap2', 'confirmed')));
  assert.strictEqual(remaining(s1), 1, 'confirmed 应扣 1 次');
  assert.strictEqual(s1.appointments[0].billing?.settled, true);
});

check('pending → confirmed 补扣，且不会重复扣', () => {
  let s = makeState();
  s = appReducer(s, addAppointment(pkgAppt('ap3', 'pending')));
  assert.strictEqual(remaining(s), 2, '仍为 pending 未扣');
  // 转 confirmed
  s = appReducer(s, updateAppointment({ ...s.appointments[0], status: 'confirmed' }));
  assert.strictEqual(remaining(s), 1, 'confirmed 后扣 1 次');
  // 再次 update（如改备注）不应重复扣
  s = appReducer(s, updateAppointment({ ...s.appointments[0], notes: '备注' }));
  assert.strictEqual(remaining(s), 1, '重复 update 不应二次扣减');
});

check('confirmed → cancelled 回退套餐次数', () => {
  let s = makeState();
  s = appReducer(s, addAppointment(pkgAppt('ap4', 'confirmed')));
  assert.strictEqual(remaining(s), 1);
  s = appReducer(s, updateAppointment({ ...s.appointments[0], status: 'cancelled' }));
  assert.strictEqual(remaining(s), 2, '取消应回退套餐次数');
  assert.strictEqual(s.appointments[0].billing?.settled, false);
});

check('confirmed → no_show 回退套餐次数', () => {
  let s = makeState();
  s = appReducer(s, addAppointment(pkgAppt('ap5', 'confirmed')));
  s = appReducer(s, updateAppointment({ ...s.appointments[0], status: 'no_show' }));
  assert.strictEqual(remaining(s), 2, '爽约应回退套餐次数');
});

check('用尽套餐后回退 → 状态从 used_up 恢复 active', () => {
  let s = makeState();
  // 先把剩余次数打到 1，再确认一单用掉最后一次
  s.customerPackages[0].items[0].remainingCount = 1;
  s = appReducer(s, addAppointment(pkgAppt('ap6', 'confirmed')));
  assert.strictEqual(remaining(s), 0);
  assert.strictEqual(s.customerPackages[0].status, 'used_up', '用尽应置为 used_up');
  s = appReducer(s, updateAppointment({ ...s.appointments[0], status: 'cancelled' }));
  assert.strictEqual(remaining(s), 1);
  assert.strictEqual(s.customerPackages[0].status, 'active', '回退后应恢复 active');
});

check('积分方案：pending 不扣分，confirmed 扣分，取消回退', () => {
  let s = makeState();
  s = appReducer(s, addAppointment(pointsAppt('pa1', 'pending')));
  assert.strictEqual(points(s), 1000, 'pending 不扣积分');
  s = appReducer(s, updateAppointment({ ...s.appointments[0], status: 'confirmed' }));
  assert.strictEqual(points(s), 800, 'confirmed 扣 200 积分');
  s = appReducer(s, updateAppointment({ ...s.appointments[0], status: 'cancelled' }));
  assert.strictEqual(points(s), 1000, '取消回退积分');
});

check('删除已结算预约 → 回退占用', () => {
  let s = makeState();
  s = appReducer(s, addAppointment(pkgAppt('pa2', 'confirmed')));
  assert.strictEqual(remaining(s), 1);
  s = appReducer(s, deleteAppointment('pa2'));
  assert.strictEqual(remaining(s), 2, '删除应回退套餐次数');
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED ✅');
}