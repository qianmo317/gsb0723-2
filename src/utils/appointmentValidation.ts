import type {
  Customer,
  SkinAnalysis,
  Allergy,
  Membership,
  Service,
  Package,
  PackageItem,
  Employee,
  Appointment,
  ServiceRecord,
  Schedule,
  CustomerPackage,
  BookingServiceItem,
  BookingValidationResult,
  ValidationIssue,
  ServicePriceBreakdown,
  BeauticianSuggestion,
  ScheduledBookingItem
} from '../types';

export const BUFFER_MINUTES = 15;
export const HIGH_TIER_PRICE_THRESHOLD = 688;
export const HIGH_TIER_DURATION_THRESHOLD = 90;
export const POINT_VALUE = 1;
export const MAX_POINTS_DEDUCTION_RATIO = 0.5;
export const CONSECUTIVE_NO_SHOW_LIMIT = 2;

export const MEMBER_DISCOUNTS: Record<string, number> = {
  bronze: 1.0,
  silver: 0.95,
  gold: 0.90,
  platinum: 0.85,
  diamond: 0.80
};

export interface ValidationState {
  customers: Customer[];
  skinAnalyses: SkinAnalysis[];
  allergies: Allergy[];
  memberships: Membership[];
  services: Service[];
  packages: Package[];
  packageItems: PackageItem[];
  employees: Employee[];
  appointments: Appointment[];
  serviceRecords: ServiceRecord[];
  schedules: Schedule[];
  customerPackages: CustomerPackage[];
}

export const isHighTierService = (service: Service): boolean => {
  return service.price >= HIGH_TIER_PRICE_THRESHOLD || service.duration >= HIGH_TIER_DURATION_THRESHOLD;
};

const getMemberDiscountRate = (membership: Membership | undefined): number => {
  if (!membership) return MEMBER_DISCOUNTS.bronze;
  return MEMBER_DISCOUNTS[membership.level] ?? MEMBER_DISCOUNTS.bronze;
};

export const isEmployeeOnDuty = (
  employee: Employee,
  dateStr: string,
  startTime: Date,
  endTime: Date,
  schedules: Schedule[]
): boolean => {
  if (employee.status !== 'active') return false;
  const schedule = schedules.find(s => s.employeeId === employee.id && s.date === dateStr);
  const shiftType = schedule?.shiftType;
  if (!shiftType || shiftType === 'off') return false;

  let shiftStart = 9;
  let shiftEnd = 18;

  if (shiftType === 'morning') {
    shiftStart = 9;
    shiftEnd = 14;
  } else if (shiftType === 'afternoon') {
    shiftStart = 14;
    shiftEnd = 21;
  } else if (shiftType === 'full_day') {
    shiftStart = 9;
    shiftEnd = 21;
  } else if (shiftType === 'overtime') {
    shiftStart = 18;
    shiftEnd = 22;
  }

  const startHour = startTime.getHours() + startTime.getMinutes() / 60;
  const endHour = endTime.getHours() + endTime.getMinutes() / 60;

  return startHour >= shiftStart && endHour <= shiftEnd;
};

const getConsecutiveNoShows = (customerId: string, appointments: Appointment[]): number => {
  const customerAppts = appointments
    .filter(a => a.customerId === customerId)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  let count = 0;
  for (const appt of customerAppts) {
    if (appt.status === 'no_show') {
      count++;
    } else if (appt.status === 'completed' || appt.status === 'cancelled') {
      break;
    }
  }
  return count;
};

const findPreferredBeautician = (
  customerId: string,
  serviceId: string,
  serviceRecords: ServiceRecord[],
  employees: Employee[]
): Employee | null => {
  const records = serviceRecords.filter(r => r.customerId === customerId && r.serviceId === serviceId);
  if (records.length === 0) return null;

  const employeeCount = new Map<string, number>();
  records.forEach(r => {
    employeeCount.set(r.employeeId, (employeeCount.get(r.employeeId) || 0) + 1);
  });

  let bestEmployeeId: string | null = null;
  let bestCount = 0;
  employeeCount.forEach((count, empId) => {
    if (count > bestCount) {
      bestCount = count;
      bestEmployeeId = empId;
    }
  });

  if (!bestEmployeeId) return null;
  return employees.find(e => e.id === bestEmployeeId) || null;
};

const computePackageDeduction = (
  pkg: Package,
  packageItems: PackageItem[],
  servicePrice: number
): number => {
  const pkgItems = packageItems.filter(pi => pi.packageId === pkg.id);
  if (pkgItems.length === 0) return 0;

  let totalSessions = 0;
  pkgItems.forEach(pi => {
    totalSessions += pi.count;
  });

  if (totalSessions === 0) return 0;

  const avgPackagePricePerSession = pkg.price / totalSessions;
  const deduction = Math.round(servicePrice - avgPackagePricePerSession);
  return deduction > 0 ? deduction : 0;
};

interface PackageOption {
  customerPackageId: string;
  packageId: string;
  packageName: string;
  deduction: number;
}

const findPackageOption = (
  state: ValidationState,
  customerId: string,
  serviceId: string,
  memberDiscountedPrice: number,
  sessionTracker: Map<string, number>
): { option: PackageOption | null; splitReason?: 'expired' | 'insufficient_sessions' } => {
  const customerPackages = state.customerPackages.filter(cp => cp.customerId === customerId);
  if (customerPackages.length === 0) return { option: null };

  let hasExpired = false;
  let hasExhausted = false;

  const activePackages = customerPackages.filter(cp => {
    const hasService = cp.remainingItems.some(ri => ri.serviceId === serviceId);
    if (!hasService) return false;
    if (new Date(cp.expireDate) < new Date()) {
      hasExpired = true;
      return false;
    }
    if (cp.status === 'expired') {
      hasExpired = true;
      return false;
    }
    if (cp.status === 'exhausted') {
      hasExhausted = true;
      return false;
    }
    return true;
  });

  for (const cp of activePackages) {
    const pkg = state.packages.find(p => p.id === cp.packageId);
    if (!pkg) continue;

    const ri = cp.remainingItems.find(r => r.serviceId === serviceId);
    if (!ri) continue;

    const trackerKey = `${cp.id}:${serviceId}`;
    const alreadyConsumed = sessionTracker.get(trackerKey) || 0;
    const available = ri.remainingCount - alreadyConsumed;

    if (available <= 0) {
      hasExhausted = true;
      continue;
    }

    const deduction = computePackageDeduction(pkg, state.packageItems, memberDiscountedPrice);

    return {
      option: {
        customerPackageId: cp.id,
        packageId: pkg.id,
        packageName: pkg.name,
        deduction
      }
    };
  }

  if (hasExpired) {
    return { option: null, splitReason: 'expired' };
  }
  if (hasExhausted) {
    return { option: null, splitReason: 'insufficient_sessions' };
  }
  return { option: null };
};

const consumePackageSession = (
  sessionTracker: Map<string, number>,
  customerPackageId: string,
  serviceId: string
) => {
  const key = `${customerPackageId}:${serviceId}`;
  sessionTracker.set(key, (sessionTracker.get(key) || 0) + 1);
};

const computePricing = (
  state: ValidationState,
  customerId: string,
  items: BookingServiceItem[],
  usePoints: boolean,
  pointsBlocked: boolean
): ServicePriceBreakdown[] => {
  const membership = state.memberships.find(m => m.customerId === customerId);
  const discountRate = getMemberDiscountRate(membership);
  const availablePoints = membership?.points ?? 0;
  const effectiveUsePoints = usePoints && !pointsBlocked;

  const sessionTracker = new Map<string, number>();

  interface ItemPriceInfo {
    service: Service | null;
    originalPrice: number;
    memberDiscountedPrice: number;
    packageOption: PackageOption | null;
    splitFromPackage: boolean;
    splitReason?: 'expired' | 'insufficient_sessions';
  }

  const itemInfos: ItemPriceInfo[] = items.map(item => {
    const service = state.services.find(s => s.id === item.serviceId);
    if (!service) {
      return {
        service: null,
        originalPrice: 0,
        memberDiscountedPrice: 0,
        packageOption: null,
        splitFromPackage: false
      };
    }

    const originalPrice = service.price;
    const memberDiscountedPrice = Math.round(originalPrice * discountRate);

    const { option, splitReason } = findPackageOption(
      state, customerId, service.id, memberDiscountedPrice, sessionTracker
    );

    return {
      service,
      originalPrice,
      memberDiscountedPrice,
      packageOption: option,
      splitFromPackage: !option && !!splitReason,
      splitReason: option ? undefined : splitReason
    };
  });

  let remainingPoints = availablePoints;

  return itemInfos.map(info => {
    if (!info.service) {
      return {
        serviceId: '',
        serviceName: '未知项目',
        originalPrice: 0,
        memberDiscountRate: discountRate,
        memberDiscountedPrice: 0,
        packageDeduction: 0,
        pointsDeduction: 0,
        finalPrice: 0,
        usedDiscountType: 'none' as const,
        splitFromPackage: false
      };
    }

    const packageDeduction = info.packageOption?.deduction ?? 0;
    const candidatePointsDeduction = (() => {
      if (!effectiveUsePoints || remainingPoints <= 0) return 0;
      const maxPointsDeduct = Math.floor(info.memberDiscountedPrice * MAX_POINTS_DEDUCTION_RATIO / POINT_VALUE);
      return Math.min(remainingPoints, maxPointsDeduct) * POINT_VALUE;
    })();

    let finalPrice = info.memberDiscountedPrice;
    let usedDiscountType: 'package' | 'points' | 'none' = 'none';
    let appliedPackageDeduction = 0;
    let appliedPointsDeduction = 0;

    if (packageDeduction > 0 && candidatePointsDeduction > 0) {
      if (packageDeduction >= candidatePointsDeduction) {
        finalPrice = info.memberDiscountedPrice - packageDeduction;
        usedDiscountType = 'package';
        appliedPackageDeduction = packageDeduction;
        if (info.packageOption) {
          consumePackageSession(sessionTracker, info.packageOption.customerPackageId, info.service.id);
        }
      } else {
        finalPrice = info.memberDiscountedPrice - candidatePointsDeduction;
        usedDiscountType = 'points';
        appliedPointsDeduction = candidatePointsDeduction;
        remainingPoints -= Math.floor(candidatePointsDeduction / POINT_VALUE);
      }
    } else if (packageDeduction > 0) {
      finalPrice = info.memberDiscountedPrice - packageDeduction;
      usedDiscountType = 'package';
      appliedPackageDeduction = packageDeduction;
      if (info.packageOption) {
        consumePackageSession(sessionTracker, info.packageOption.customerPackageId, info.service.id);
      }
    } else if (candidatePointsDeduction > 0) {
      finalPrice = info.memberDiscountedPrice - candidatePointsDeduction;
      usedDiscountType = 'points';
      appliedPointsDeduction = candidatePointsDeduction;
      remainingPoints -= Math.floor(candidatePointsDeduction / POINT_VALUE);
    }

    if (finalPrice < 0) finalPrice = 0;

    return {
      serviceId: info.service.id,
      serviceName: info.service.name,
      originalPrice: info.originalPrice,
      memberDiscountRate: discountRate,
      memberDiscountedPrice: info.memberDiscountedPrice,
      packageDeduction: appliedPackageDeduction,
      pointsDeduction: appliedPointsDeduction,
      finalPrice,
      usedDiscountType,
      packageId: usedDiscountType === 'package' ? info.packageOption?.packageId : undefined,
      packageName: usedDiscountType === 'package' ? info.packageOption?.packageName : undefined,
      customerPackageId: usedDiscountType === 'package' ? info.packageOption?.customerPackageId : undefined,
      splitFromPackage: info.splitFromPackage && usedDiscountType !== 'package',
      splitReason: info.splitFromPackage && usedDiscountType !== 'package' ? info.splitReason : undefined
    };
  });
};

const hasTimeConflict = (
  employeeId: string,
  startTime: Date,
  endTime: Date,
  appointments: Appointment[]
): boolean => {
  return appointments.some(a => {
    if (a.employeeId !== employeeId || a.status === 'cancelled') return false;
    const aStart = new Date(a.startTime).getTime();
    const aEnd = new Date(a.endTime).getTime();
    const sStart = startTime.getTime();
    const sEnd = endTime.getTime();
    return (sStart >= aStart && sStart < aEnd) || (sEnd > aStart && sEnd <= aEnd) ||
      (sStart <= aStart && sEnd >= aEnd);
  });
};

const suggestBeauticians = (
  state: ValidationState,
  customerId: string,
  items: BookingServiceItem[],
  dateStr: string,
  scheduledItems: ScheduledBookingItem[]
): BeauticianSuggestion[] => {
  const suggestionsMap = new Map<string, BeauticianSuggestion>();

  const allAround = findBestAllAroundBeautician(state, customerId, items, dateStr, scheduledItems);
  if (allAround) {
    suggestionsMap.set(allAround.employeeId, {
      ...allAround,
      coversAllItems: true
    });
  }

  items.forEach((item, idx) => {
    const service = state.services.find(s => s.id === item.serviceId);
    if (!service) return;

    const scheduled = scheduledItems[idx];
    if (!scheduled) return;

    const startTime = new Date(scheduled.startTime);
    const endTime = new Date(scheduled.endTime);

    const preferred = findPreferredBeautician(customerId, service.id, state.serviceRecords, state.employees);

    const eligible = state.employees.filter(e => {
      if (e.role !== 'beautician' && e.role !== 'technician') return false;
      if (!e.skills.includes(service.id)) return false;
      if (!isEmployeeOnDuty(e, dateStr, startTime, endTime, state.schedules)) return false;
      if (hasTimeConflict(e.id, startTime, endTime, state.appointments)) return false;
      return true;
    });

    eligible.forEach(emp => {
      if (suggestionsMap.has(emp.id)) return;

      let score = 0;
      let reason: BeauticianSuggestion['reason'] = 'skill_match';

      if (preferred && emp.id === preferred.id) {
        score = 90;
        reason = 'preferred';
      } else if (emp.skills.includes(service.id)) {
        score = 70;
        reason = 'skill_match';
        if (isHighTierService(service)) {
          score += 10;
        }
      } else {
        score = 50;
        reason = 'available';
      }

      suggestionsMap.set(emp.id, {
        employeeId: emp.id,
        employeeName: emp.name,
        reason,
        score
      });
    });
  });

  return Array.from(suggestionsMap.values()).sort((a, b) => b.score - a.score);
};

const findBestAllAroundBeautician = (
  state: ValidationState,
  customerId: string,
  items: BookingServiceItem[],
  dateStr: string,
  scheduledItems: ScheduledBookingItem[]
): BeauticianSuggestion | null => {
  const serviceIds = items.map(i => i.serviceId).filter(Boolean);
  if (serviceIds.length === 0) return null;

  const records = state.serviceRecords.filter(
    r => r.customerId === customerId && serviceIds.includes(r.serviceId)
  );

  const employeeCount = new Map<string, number>();
  records.forEach(r => {
    employeeCount.set(r.employeeId, (employeeCount.get(r.employeeId) || 0) + 1);
  });

  const rankedEmployees = Array.from(employeeCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([empId]) => state.employees.find(e => e.id === empId))
    .filter((e): e is Employee => !!e);

  for (const emp of rankedEmployees) {
    if (emp.role !== 'beautician' && emp.role !== 'technician') continue;
    if (emp.status !== 'active') continue;

    const hasAllSkills = serviceIds.every(sid => emp.skills.includes(sid));
    if (!hasAllSkills) continue;

    const allOnDuty = scheduledItems.every(s =>
      isEmployeeOnDuty(emp, dateStr, new Date(s.startTime), new Date(s.endTime), state.schedules)
    );
    if (!allOnDuty) continue;

    const hasAnyConflict = scheduledItems.some(s =>
      hasTimeConflict(emp.id, new Date(s.startTime), new Date(s.endTime), state.appointments)
    );
    if (hasAnyConflict) continue;

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      reason: 'preferred',
      score: 100
    };
  }

  return null;
};

const buildScheduledItems = (
  state: ValidationState,
  items: BookingServiceItem[],
  baseStartTime: Date
): ScheduledBookingItem[] => {
  const result: ScheduledBookingItem[] = [];
  let currentTime = new Date(baseStartTime);

  items.forEach((item, idx) => {
    const service = state.services.find(s => s.id === item.serviceId);
    if (!service) return;

    const employee = state.employees.find(e => e.id === item.employeeId);
    const startTime = new Date(currentTime);
    const endTime = new Date(startTime.getTime() + service.duration * 60 * 1000);
    const isLast = idx === items.length - 1;

    result.push({
      serviceId: service.id,
      serviceName: service.name,
      employeeId: item.employeeId || '',
      employeeName: employee?.name || '未分配',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: service.duration,
      bufferAfter: isLast ? 0 : BUFFER_MINUTES
    });

    if (!isLast) {
      currentTime = new Date(endTime.getTime() + BUFFER_MINUTES * 60 * 1000);
    }
  });

  return result;
};

export function validateBooking(
  state: ValidationState,
  customerId: string,
  items: BookingServiceItem[],
  baseStartTime: Date,
  usePoints: boolean = false
): BookingValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const infos: ValidationIssue[] = [];

  const customer = state.customers.find(c => c.id === customerId);
  if (!customer) {
    errors.push({ code: 'CUSTOMER_NOT_FOUND', severity: 'error', message: '顾客不存在' });
  }

  if (items.length === 0) {
    errors.push({ code: 'NO_SERVICES', severity: 'error', message: '请至少选择一个项目' });
  }

  const dateStr = baseStartTime.toISOString().split('T')[0];

  const membership = state.memberships.find(m => m.customerId === customerId);
  const consecutiveNoShows = getConsecutiveNoShows(customerId, state.appointments);
  const isDiamond = membership?.level === 'diamond';
  const requiresDoubleConfirm = isDiamond && consecutiveNoShows >= CONSECUTIVE_NO_SHOW_LIMIT;
  const pointsBlocked = requiresDoubleConfirm;

  if (requiresDoubleConfirm) {
    warnings.push({
      code: 'DIAMOND_NO_SHOW_CONFIRM',
      severity: 'warning',
      message: `钻石会员连续爽约${consecutiveNoShows}次，本次预约需前台二次确认`
    });
  }

  if (pointsBlocked) {
    infos.push({
      code: 'POINTS_BLOCKED',
      severity: 'info',
      message: '因连续爽约记录，本次不可使用积分抵扣'
    });
  }

  const scheduledItems = buildScheduledItems(state, items, baseStartTime);

  const customerAllergies = state.allergies.filter(a => a.customerId === customerId);
  if (customerAllergies.length > 0) {
    const severeAllergies = customerAllergies.filter(a => a.severity === 'severe');
    if (severeAllergies.length > 0) {
      warnings.push({
        code: 'ALLERGY_SEVERE',
        severity: 'warning',
        message: `顾客有严重过敏史：${severeAllergies.map(a => a.allergen).join('、')}，请确认产品成分`
      });
    } else {
      infos.push({
        code: 'ALLERGY_MILD',
        severity: 'info',
        message: `顾客有过敏史：${customerAllergies.map(a => a.allergen).join('、')}，请注意`
      });
    }
  }

  const recentSkinAnalyses = state.skinAnalyses
    .filter(sa => sa.customerId === customerId)
    .sort((a, b) => new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime());

  if (recentSkinAnalyses.length > 0) {
    const latest = recentSkinAnalyses[0];
    if (latest.skinCondition === '较差' || latest.skinCondition === '需改善') {
      warnings.push({
        code: 'SKIN_ABNORMAL',
        severity: 'warning',
        message: `最近皮肤检测（${latest.analysisDate}）状况为"${latest.skinCondition}"，请关注`
      });
    }
    if (latest.sensitivity === '明显') {
      warnings.push({
        code: 'SKIN_SENSITIVE',
        severity: 'warning',
        message: `最近皮肤检测显示敏感度"明显"，建议选择温和项目`
      });
    }
  }

  items.forEach((item, idx) => {
    const service = state.services.find(s => s.id === item.serviceId);
    if (!service) {
      errors.push({ code: 'SERVICE_NOT_FOUND', severity: 'error', message: `项目 #${idx + 1} 不存在`, field: `items[${idx}].serviceId` });
      return;
    }

    if (!item.employeeId) {
      errors.push({
        code: 'EMPLOYEE_REQUIRED',
        severity: 'error',
        message: `"${service.name}"请选择美容师`,
        field: `items[${idx}].employeeId`
      });
    }

    if (service.suitableSkin.length > 0 && customer) {
      const customerSkinType = customer.skinType;
      if (customerSkinType && !service.suitableSkin.includes(customerSkinType)) {
        infos.push({
          code: 'SKIN_TYPE_MISMATCH',
          severity: 'info',
          message: `"${service.name}"适用肤质为${service.suitableSkin.join('、')}，顾客肤质为${customerSkinType}`
        });
      }
    }

    if (isHighTierService(service)) {
      const emp = state.employees.find(e => e.id === item.employeeId);
      if (emp) {
        if (!emp.skills.includes(service.id)) {
          errors.push({
            code: 'HIGH_TIER_SKILL_MISMATCH',
            severity: 'error',
            message: `"${service.name}"为高阶项目，${emp.name}不具备该项目技能标签`,
            field: `items[${idx}].employeeId`
          });
        }
        const scheduled = scheduledItems[idx];
        if (scheduled && !isEmployeeOnDuty(emp, dateStr, new Date(scheduled.startTime), new Date(scheduled.endTime), state.schedules)) {
          errors.push({
            code: 'EMPLOYEE_NOT_ON_DUTY',
            severity: 'error',
            message: `${emp.name}在该时段不在岗`,
            field: `items[${idx}].employeeId`
          });
        }
      } else {
        warnings.push({
          code: 'HIGH_TIER_SKILL_REQUIRED',
          severity: 'warning',
          message: `"${service.name}"为高阶项目，需匹配具有技能标签且在岗的美容师`
        });
      }
    }
  });

  if (items.length > 1) {
    infos.push({
      code: 'BUFFER_TIME',
      severity: 'info',
      message: `已自动安排${BUFFER_MINUTES}分钟消毒缓冲时间`
    });
  }

  scheduledItems.forEach((scheduled, idx) => {
    if (!scheduled.employeeId) return;
    if (hasTimeConflict(scheduled.employeeId, new Date(scheduled.startTime), new Date(scheduled.endTime), state.appointments)) {
      errors.push({
        code: 'TIME_CONFLICT',
        severity: 'error',
        message: `${scheduled.employeeName}在${formatTimeStr(scheduled.startTime)}-${formatTimeStr(scheduled.endTime)}已有预约`,
        field: `items[${idx}].employeeId`
      });
    }
  });

  const pricing = computePricing(state, customerId, items, usePoints, pointsBlocked);

  const totalOriginalPrice = pricing.reduce((sum, p) => sum + p.originalPrice, 0);
  const totalPrice = pricing.reduce((sum, p) => sum + p.finalPrice, 0);
  const totalSavings = totalOriginalPrice - totalPrice;

  pricing.forEach(p => {
    if (p.splitFromPackage) {
      const msg = p.splitReason === 'expired'
        ? `"${p.serviceName}"套餐已过期，已按单次价结算`
        : p.splitReason === 'insufficient_sessions'
          ? `"${p.serviceName}"套餐剩余次数不足，超出部分已按单次价结算`
          : `"${p.serviceName}"套餐不可用，已按单次价结算`;
      infos.push({
        code: 'PACKAGE_SPLIT',
        severity: 'info',
        message: msg
      });
    }
    if (p.usedDiscountType === 'package') {
      infos.push({
        code: 'PACKAGE_DEDUCTION',
        severity: 'info',
        message: `"${p.serviceName}"使用套餐抵扣，节省¥${p.packageDeduction}`
      });
    }
    if (p.usedDiscountType === 'points') {
      infos.push({
        code: 'POINTS_DEDUCTION',
        severity: 'info',
        message: `"${p.serviceName}"使用积分抵扣，节省¥${p.pointsDeduction}`
      });
    }
  });

  const hasPackageDeduction = pricing.some(p => p.packageDeduction > 0);
  if (hasPackageDeduction && usePoints && !pointsBlocked) {
    const memberLevelName = membership ? getMemberLevelText(membership.level) : '';
    infos.push({
      code: 'DISCOUNT_AUTO_CHOOSE',
      severity: 'info',
      message: `套餐抵扣与积分抵扣不可叠加，已自动选择更划算的方案${memberLevelName ? `（${memberLevelName}会员折扣已应用）` : ''}`
    });
  }

  const suggestedEmployees = suggestBeauticians(state, customerId, items, dateStr, scheduledItems);

  const allAroundSuggestion = suggestedEmployees.find(s => s.coversAllItems);
  if (allAroundSuggestion) {
    infos.push({
      code: 'PREFERRED_BEAUTICIAN_ALL',
      severity: 'info',
      message: `顾客常约美容师${allAroundSuggestion.employeeName}可全程跟进所有项目，已推荐安排同一人`
    });
  } else if (items.length > 0) {
    const firstItem = items[0];
    const preferred = findPreferredBeautician(customerId, firstItem.serviceId, state.serviceRecords, state.employees);
    if (preferred) {
      infos.push({
        code: 'PREFERRED_BEAUTICIAN',
        severity: 'info',
        message: `顾客常约美容师：${preferred.name}，建议优先安排（部分项目需拆分不同美容师）`
      });
    }
  }

  const conflictItemIndexes = errors
    .filter(e => e.code === 'TIME_CONFLICT' && e.field)
    .map(e => {
      const match = e.field!.match(/items\[(\d+)\]/);
      return match ? parseInt(match[1], 10) : -1;
    })
    .filter(i => i >= 0);

  const blockingErrors = errors.filter(e => e.code !== 'TIME_CONFLICT');
  const canWaitlist = blockingErrors.length === 0 && conflictItemIndexes.length > 0;

  return {
    valid: errors.length === 0,
    canWaitlist,
    conflictItemIndexes,
    errors,
    warnings,
    infos,
    suggestedEmployees,
    pricing,
    totalPrice,
    totalOriginalPrice,
    totalSavings,
    requiresDoubleConfirm,
    doubleConfirmReason: requiresDoubleConfirm ? `钻石会员连续爽约${consecutiveNoShows}次` : undefined,
    pointsBlocked,
    pointsBlockedReason: pointsBlocked ? '连续爽约惩罚期间' : undefined,
    bufferMinutes: BUFFER_MINUTES,
    scheduledItems
  };
}

function formatTimeStr(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getMemberLevelText(level: string): string {
  const texts: Record<string, string> = {
    bronze: '青铜',
    silver: '白银',
    gold: '黄金',
    platinum: '铂金',
    diamond: '钻石'
  };
  return texts[level] || '';
}
