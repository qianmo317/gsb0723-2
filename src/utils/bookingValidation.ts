import type {
  Appointment,
  Customer,
  CustomerPackage,
  Employee,
  Membership,
  Schedule,
  Service,
  SkinAnalysis,
  Allergy,
} from '../types';
import {
  MEMBERSHIP_DISCOUNT,
  POINTS_PER_YUAN,
  MAX_POINTS_DEDUCT_RATIO,
  ADVANCED_CATEGORIES,
  STERILIZATION_BUFFER_MINUTES,
  NO_SHOW_CONFIRM_THRESHOLD,
  NO_SHOW_RULE_LEVEL,
  ABNORMAL_SKIN_KEYWORDS,
  RECENT_SKIN_ANALYSIS_DAYS,
  BUSINESS_HOURS,
} from './bookingRules';

/** 校验提示级别：block=阻断，confirm=需前台二次确认，warning=提醒（不阻断） */
export type IssueLevel = 'block' | 'confirm' | 'warning';

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface ScheduledItem {
  serviceId: string;
  serviceName: string;
  isAdvanced: boolean;
  employeeId: string | null;
  employeeName: string | null;
  startTime: string; // ISO
  endTime: string; // ISO
  bufferBefore: number; // 该项目前的消毒缓冲分钟数
  unassignedReason?: string;
}

/** 单个项目的计价与抵扣方案明细 */
export interface PricingLine {
  serviceId: string;
  serviceName: string;
  listPrice: number; // 单次原价
  coveredByPackage: boolean; // 该方案下是否由套餐抵扣
  customerPackageId?: string; // 命中的顾客套餐
  cashPrice: number; // 该方案下需现金支付（已含会员折扣）
}

export interface PricingPlan {
  key: 'package' | 'points';
  label: string;
  lines: PricingLine[];
  subtotal: number; // 折扣后现金小计（未计积分抵扣）
  pointsUsed: number; // 使用的积分
  pointsDeductAmount: number; // 积分抵扣金额
  finalCash: number; // 最终现金
  available: boolean; // 该方案是否可用
  note?: string;
}

export interface PricingResult {
  membershipDiscount: number;
  plans: PricingPlan[];
  recommendedKey: PricingPlan['key'];
  pointsDisabled: boolean; // 是否因爽约规则禁用积分
}

export interface ValidationResult {
  schedule: ScheduledItem[];
  totalDuration: number; // 含缓冲的总时长（分钟）
  issues: ValidationIssue[];
  pricing: PricingResult;
  requiresReceptionistConfirm: boolean;
  canProceed: boolean; // 无 block 级问题即可继续
}

const MS_PER_MIN = 60 * 1000;

export const isServiceAdvanced = (service: Service): boolean =>
  ADVANCED_CATEGORIES.includes(service.category);

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

/** 员工在指定时间窗内是否在岗（有非休息排班且时间落在班次内） */
const isOnShift = (
  employeeId: string,
  dateStr: string,
  startMs: number,
  endMs: number,
  schedules: Schedule[]
): boolean => {
  const shift = schedules.find((s) => s.employeeId === employeeId && s.date === dateStr);
  if (!shift || shift.shiftType === 'off' || shift.startTime === '--') return false;
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  const base = new Date(dateStr + 'T00:00:00');
  const shiftStart = new Date(base).setHours(sh, sm, 0, 0);
  const shiftEnd = new Date(base).setHours(eh, em, 0, 0);
  return startMs >= shiftStart && endMs <= shiftEnd;
};

/** 员工在指定时间窗内是否空闲（不与现有未取消预约冲突） */
const isFree = (
  employeeId: string,
  startMs: number,
  endMs: number,
  appointments: Appointment[]
): boolean => {
  return !appointments.some((a) => {
    if (a.employeeId !== employeeId) return false;
    if (a.status === 'cancelled' || a.status === 'no_show') return false;
    return overlaps(startMs, endMs, new Date(a.startTime).getTime(), new Date(a.endTime).getTime());
  });
};

/** 找出该顾客最近“已完成”预约跟进过的美容师（优先安排同一人） */
const preferredEmployeeId = (customerId: string, appointments: Appointment[]): string | null => {
  const past = appointments
    .filter((a) => a.customerId === customerId && a.status === 'completed')
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return past[0]?.employeeId ?? null;
};

/**
 * 计算某顾客“最近连续爽约”次数（按开始时间倒序，统计开头连续的 no_show）。
 *
 * 仅统计发生在 referenceDate（当前预约日期）及之前的记录，避免把晚于本次预约的爽约计入。
 *
 * 中断条件：只要遇到任何**非 no_show** 状态（completed / confirmed / pending / cancelled）
 * 就视为连续爽约被打断，立即停止累计——即“最近一次不是爽约”就不算连续爽约。
 */
export const countConsecutiveNoShows = (
  customerId: string,
  appointments: Appointment[],
  referenceDate?: Date
): number => {
  const refMs = referenceDate ? referenceDate.getTime() : Infinity;
  const history = appointments
    .filter((a) => a.customerId === customerId && new Date(a.startTime).getTime() <= refMs)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  let count = 0;
  for (const a of history) {
    if (a.status === 'no_show') count++;
    else break; // completed / confirmed / pending / cancelled 均中断连续爽约
  }
  return count;
};

interface EngineInput {
  customerId: string;
  serviceIds: string[]; // 顾客本次预约的多个连续项目（有序）
  startTime: Date; // 第一个项目的开始时间
  data: {
    services: Service[];
    employees: Employee[];
    appointments: Appointment[];
    schedules: Schedule[];
    memberships: Membership[];
    customerPackages: CustomerPackage[];
    skinAnalyses: SkinAnalysis[];
    allergies: Allergy[];
    customers: Customer[];
  };
}

/**
 * 智能预约校验主入口（纯函数，不触碰 store）。
 */
export const validateBooking = (input: EngineInput): ValidationResult => {
  const { customerId, serviceIds, startTime, data } = input;
  const issues: ValidationIssue[] = [];

  const membership = data.memberships.find((m) => m.customerId === customerId);
  const dateStr = startTime.toISOString().split('T')[0];
  const prefEmpId = preferredEmployeeId(customerId, data.appointments);

  // 已在本次排期中占用的员工时间窗（避免同一顾客的连续项目排给同一人却时间重叠）
  const tentative: { employeeId: string; startMs: number; endMs: number }[] = [];

  const schedule: ScheduledItem[] = [];
  let cursor = startTime.getTime();

  serviceIds.forEach((serviceId, index) => {
    const service = data.services.find((s) => s.id === serviceId);
    const buffer = index === 0 ? 0 : STERILIZATION_BUFFER_MINUTES;
    cursor += buffer * MS_PER_MIN;

    if (!service) {
      schedule.push({
        serviceId,
        serviceName: serviceId,
        isAdvanced: false,
        employeeId: null,
        employeeName: null,
        startTime: new Date(cursor).toISOString(),
        endTime: new Date(cursor).toISOString(),
        bufferBefore: buffer,
        unassignedReason: '项目不存在',
      });
      return;
    }

    const startMs = cursor;
    const endMs = cursor + service.duration * MS_PER_MIN;
    const advanced = isServiceAdvanced(service);

    const busyInTentative = (empId: string) =>
      tentative.some((t) => t.employeeId === empId && overlaps(startMs, endMs, t.startMs, t.endMs));

    // 候选员工：在岗 + 空闲 + 未在本次排期占用
    const candidates = data.employees.filter((e) => {
      if (e.status !== 'active') return false;
      if (e.role !== 'beautician' && e.role !== 'technician') return false;
      if (!isOnShift(e.id, dateStr, startMs, endMs, data.schedules)) return false;
      if (!isFree(e.id, startMs, endMs, data.appointments)) return false;
      if (busyInTentative(e.id)) return false;
      return true;
    });

    // 高阶项目必须有技能标签
    const skilled = candidates.filter((e) => e.skills.includes(serviceId));
    const pool = advanced ? skilled : candidates;

    let chosen: Employee | undefined;
    // 优先同一美容师（需满足该项目的资格约束）
    if (prefEmpId) {
      chosen = pool.find((e) => e.id === prefEmpId);
    }
    if (!chosen) chosen = pool[0];

    if (!chosen) {
      let reason = '该时段无可用美容师';
      if (advanced && candidates.length > 0 && skilled.length === 0) {
        reason = '高阶项目：在岗美容师均无对应技能标签';
      } else if (candidates.length === 0) {
        reason = '该时段无在岗且空闲的美容师';
      }
      issues.push({
        level: 'block',
        code: 'NO_EMPLOYEE',
        message: `「${service.name}」${reason}`,
      });
      schedule.push({
        serviceId,
        serviceName: service.name,
        isAdvanced: advanced,
        employeeId: null,
        employeeName: null,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        bufferBefore: buffer,
        unassignedReason: reason,
      });
    } else {
      if (advanced && prefEmpId && chosen.id !== prefEmpId) {
        issues.push({
          level: 'warning',
          code: 'PREFERRED_UNAVAILABLE',
          message: `「${service.name}」为高阶项目，常跟进美容师无对应技能或不在岗，已改由 ${chosen.name} 承接`,
        });
      }
      tentative.push({ employeeId: chosen.id, startMs, endMs });
      schedule.push({
        serviceId,
        serviceName: service.name,
        isAdvanced: advanced,
        employeeId: chosen.id,
        employeeName: chosen.name,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        bufferBefore: buffer,
      });
    }

    cursor = endMs;
  });

  const totalDuration = Math.round((cursor - startTime.getTime()) / MS_PER_MIN);

  // 营业时间边界提示
  if (startTime.getHours() < BUSINESS_HOURS.start || new Date(cursor).getHours() >= BUSINESS_HOURS.end) {
    issues.push({
      level: 'warning',
      code: 'OUT_OF_HOURS',
      message: `连续项目预计 ${startTime.getHours()}:00 开始、约 ${totalDuration} 分钟，可能超出营业时间（${BUSINESS_HOURS.start}:00-${BUSINESS_HOURS.end}:00）`,
    });
  }

  // ---- 项目禁忌 / 皮肤与过敏提醒（提醒，不禁止）----
  const customer = data.customers.find((c) => c.id === customerId);
  const custAllergies = data.allergies.filter((a) => a.customerId === customerId);
  if (custAllergies.length > 0) {
    const severe = custAllergies.filter((a) => a.severity === 'severe');
    const list = custAllergies.map((a) => a.allergen).join('、');
    issues.push({
      level: 'warning',
      code: 'ALLERGY',
      message: `顾客有过敏史（${list}）${severe.length ? '，其中含重度过敏' : ''}，请核对本次项目所用产品成分后再操作`,
    });
  }

  // 最近皮肤检测异常
  const recentCut = Date.now() - RECENT_SKIN_ANALYSIS_DAYS * 24 * 60 * MS_PER_MIN;
  const recentAbnormal = data.skinAnalyses
    .filter((s) => s.customerId === customerId)
    .filter((s) => new Date(s.analysisDate).getTime() >= recentCut)
    .filter((s) =>
      ABNORMAL_SKIN_KEYWORDS.some(
        (kw) =>
          s.skinCondition?.includes(kw) ||
          s.sensitivity?.includes(kw) ||
          s.oiliness?.includes(kw) ||
          s.elasticity?.includes(kw)
      )
    );
  if (recentAbnormal.length > 0) {
    issues.push({
      level: 'warning',
      code: 'SKIN_ABNORMAL',
      message: `顾客最近 ${RECENT_SKIN_ANALYSIS_DAYS} 天内的皮肤检测存在异常（如：${recentAbnormal[0].skinCondition}/敏感${recentAbnormal[0].sensitivity}），建议操作前复核`,
    });
  }

  // 肤质与项目适应性
  serviceIds.forEach((sid) => {
    const svc = data.services.find((s) => s.id === sid);
    if (svc && customer && svc.suitableSkin.length > 0 && !svc.suitableSkin.includes(customer.skinType)) {
      issues.push({
        level: 'warning',
        code: 'SKIN_UNSUITABLE',
        message: `「${svc.name}」适用肤质为 ${svc.suitableSkin.join('/')}，与顾客肤质（${customer.skinType}）不符，请确认`,
      });
    }
  });

  // ---- 钻石会员连续爽约二次确认 + 禁用积分 ----
  let pointsDisabled = false;
  let requiresReceptionistConfirm = false;
  const consecutiveNoShow = countConsecutiveNoShows(customerId, data.appointments, startTime);
  if (
    membership?.level === NO_SHOW_RULE_LEVEL &&
    consecutiveNoShow >= NO_SHOW_CONFIRM_THRESHOLD
  ) {
    pointsDisabled = true;
    requiresReceptionistConfirm = true;
    issues.push({
      level: 'confirm',
      code: 'NO_SHOW_CONFIRM',
      message: `钻石会员已连续爽约 ${consecutiveNoShow} 次，本次预约需前台二次确认，且不可使用积分抵扣`,
    });
  }

  const pricing = computePricing({
    customerId,
    serviceIds,
    membership,
    services: data.services,
    customerPackages: data.customerPackages,
    pointsDisabled,
  });

  const canProceed = !issues.some((i) => i.level === 'block');

  return {
    schedule,
    totalDuration,
    issues,
    pricing,
    requiresReceptionistConfirm,
    canProceed,
  };
};

interface PricingInput {
  customerId: string;
  serviceIds: string[];
  membership?: Membership;
  services: Service[];
  customerPackages: CustomerPackage[];
  pointsDisabled: boolean;
}

/** 找到能抵扣该项目、且未过期、仍有剩余次数的顾客套餐 */
const findUsablePackage = (
  serviceId: string,
  customerId: string,
  customerPackages: CustomerPackage[],
  usedCountByPkgService: Record<string, number>
): CustomerPackage | undefined => {
  const today = new Date().setHours(0, 0, 0, 0);
  return customerPackages.find((cp) => {
    if (cp.customerId !== customerId) return false;
    if (cp.status !== 'active') return false; // 过期/用尽自动排除 → 触发拆单
    if (new Date(cp.expireDate).getTime() < today) return false;
    const item = cp.items.find((it) => it.serviceId === serviceId);
    if (!item) return false;
    const already = usedCountByPkgService[`${cp.id}:${serviceId}`] || 0;
    return item.remainingCount - already > 0;
  });
};

/**
 * 计价：分别计算「套餐抵扣方案」与「积分抵扣方案」，二者互斥，自动推荐更划算者。
 */
export const computePricing = (input: PricingInput): PricingResult => {
  const { customerId, serviceIds, membership, services, customerPackages, pointsDisabled } = input;
  const discount = membership ? MEMBERSHIP_DISCOUNT[membership.level] : 1;

  const lineOf = (serviceId: string): { name: string; price: number } => {
    const svc = services.find((s) => s.id === serviceId);
    return { name: svc?.name ?? serviceId, price: svc?.price ?? 0 };
  };

  // ---- 方案一：套餐抵扣（次数不足/过期的项目自动拆单按单次价，套餐项不再叠加积分）----
  const pkgUsage: Record<string, number> = {};
  let pkgUsedAny = false;
  const packageLines: PricingLine[] = serviceIds.map((serviceId) => {
    const { name, price } = lineOf(serviceId);
    const usable = findUsablePackage(serviceId, customerId, customerPackages, pkgUsage);
    if (usable) {
      pkgUsage[`${usable.id}:${serviceId}`] = (pkgUsage[`${usable.id}:${serviceId}`] || 0) + 1;
      pkgUsedAny = true;
      return {
        serviceId,
        serviceName: name,
        listPrice: price,
        coveredByPackage: true,
        customerPackageId: usable.id,
        cashPrice: 0,
      };
    }
    // 拆单：按单次价 × 会员折扣
    return {
      serviceId,
      serviceName: name,
      listPrice: price,
      coveredByPackage: false,
      cashPrice: Math.round(price * discount),
    };
  });
  const packageSubtotal = packageLines.reduce((sum, l) => sum + l.cashPrice, 0);

  const packagePlan: PricingPlan = {
    key: 'package',
    label: '套餐抵扣',
    lines: packageLines,
    subtotal: packageSubtotal,
    pointsUsed: 0,
    pointsDeductAmount: 0,
    finalCash: packageSubtotal,
    available: pkgUsedAny, // 没有任何套餐命中则该方案无意义
    note: pkgUsedAny ? '套餐命中项目免现金，未覆盖项目按单次价拆单' : '无可用套餐',
  };

  // ---- 方案二：积分抵扣（全部按单次价 × 折扣，再用积分抵扣，不使用套餐）----
  const pointsLines: PricingLine[] = serviceIds.map((serviceId) => {
    const { name, price } = lineOf(serviceId);
    return {
      serviceId,
      serviceName: name,
      listPrice: price,
      coveredByPackage: false,
      cashPrice: Math.round(price * discount),
    };
  });
  const pointsSubtotal = pointsLines.reduce((sum, l) => sum + l.cashPrice, 0);

  const points = membership?.points ?? 0;
  const maxByRatio = pointsSubtotal * MAX_POINTS_DEDUCT_RATIO;
  const maxByPoints = points / POINTS_PER_YUAN;
  const pointsDeductAmount = pointsDisabled
    ? 0
    : Math.floor(Math.min(maxByRatio, maxByPoints));
  const pointsUsed = pointsDeductAmount * POINTS_PER_YUAN;

  const pointsPlan: PricingPlan = {
    key: 'points',
    label: '积分抵扣',
    lines: pointsLines,
    subtotal: pointsSubtotal,
    pointsUsed,
    pointsDeductAmount,
    finalCash: pointsSubtotal - pointsDeductAmount,
    available: !pointsDisabled && pointsDeductAmount > 0,
    note: pointsDisabled
      ? '因连续爽约规则，本次禁用积分抵扣'
      : pointsDeductAmount > 0
      ? `使用 ${pointsUsed} 积分抵扣 ¥${pointsDeductAmount}（上限 ${MAX_POINTS_DEDUCT_RATIO * 100}%）`
      : '积分不足，无可抵扣金额',
  };

  // ---- 互斥择优：可用方案里取 finalCash 更低者；都不可用则取纯拆单/纯折扣 ----
  const plans = [packagePlan, pointsPlan];
  const availablePlans = plans.filter((p) => p.available);
  let recommendedKey: PricingPlan['key'];
  if (availablePlans.length > 0) {
    recommendedKey = availablePlans.reduce((best, p) => (p.finalCash < best.finalCash ? p : best)).key;
  } else {
    // 都不可用时，两方案 finalCash 相同（纯折扣），默认推荐套餐位（即纯拆单）
    recommendedKey = packagePlan.finalCash <= pointsPlan.finalCash ? 'package' : 'points';
  }

  return {
    membershipDiscount: discount,
    plans,
    recommendedKey,
    pointsDisabled,
  };
};
