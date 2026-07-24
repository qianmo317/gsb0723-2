import dayjs from 'dayjs';
import type {
  Customer,
  Service,
  Employee,
  Schedule,
  Appointment,
  Membership,
  Allergy,
  SkinAnalysis,
  CustomerPackage,
  AppointmentItem,
  ValidationWarning,
  EmployeeRecommendation,
  PriceCalculationResult,
  TimeSlotResult,
  SmartValidationResult,
  Package,
  PackageItem,
  AppointmentPriceItem
} from '../types';
import type { RootState } from '../store';
import {
  MEMBERSHIP_DISCOUNT_RULES,
  POINTS_VALUE,
  BUFFER_TIME_MINUTES,
  NO_SHOW_LIMIT_FOR_DIAMOND
} from '../types';
import { generateId } from './format';

type AppState = RootState['app'];

interface AppointmentServiceInput {
  serviceId: string;
  preferredEmployeeId?: string;
}

interface SmartAppointmentInput {
  customerId: string;
  services: AppointmentServiceInput[];
  date: string;
  startTime: string;
  source: 'phone' | 'wechat' | 'walk_in' | 'online';
  notes?: string;
}

const getMembershipDiscountRule = (level: Membership['level']) => {
  return MEMBERSHIP_DISCOUNT_RULES.find(r => r.level === level) || MEMBERSHIP_DISCOUNT_RULES[0];
};

const isEmployeeOnShift = (employee: Employee, schedules: Schedule[], date: string, startTime: dayjs.Dayjs, endTime: dayjs.Dayjs): boolean => {
  if (employee.status !== 'active') return false;

  const schedule = schedules.find(s =>
    s.employeeId === employee.id &&
    s.date === date
  );

  if (!schedule || schedule.shiftType === 'off') return false;
  if (schedule.startTime === '--' || schedule.endTime === '--') return false;

  const [startHour, startMin] = schedule.startTime.split(':').map(Number);
  const [endHour, endMin] = schedule.endTime.split(':').map(Number);

  const shiftStart = dayjs(date).hour(startHour).minute(startMin).second(0);
  const shiftEnd = dayjs(date).hour(endHour).minute(endMin).second(0);

  const startsAfterShiftStart = startTime.isSame(shiftStart) || startTime.isAfter(shiftStart);
  const endsBeforeShiftEnd = endTime.isSame(shiftEnd) || endTime.isBefore(shiftEnd);

  return startsAfterShiftStart && endsBeforeShiftEnd;
};

const getEmployeeConflict = (
  employeeId: string,
  appointments: Appointment[],
  startTime: dayjs.Dayjs,
  endTime: dayjs.Dayjs
): { hasConflict: boolean; conflictTime?: { start: string; end: string } } => {
  for (const appt of appointments) {
    if (appt.employeeId !== employeeId) continue;
    if (appt.status === 'cancelled' || appt.status === 'no_show') continue;

    const apptStart = new Date(appt.startTime);
    const apptEnd = new Date(appt.endTime);

    const newStart = startTime.toDate();
    const newEnd = endTime.toDate();

    const hasOverlap = (
      (newStart >= apptStart && newStart < apptEnd) ||
      (newEnd > apptStart && newEnd <= apptEnd) ||
      (newStart <= apptStart && newEnd >= apptEnd)
    );

    if (hasOverlap) {
      return {
        hasConflict: true,
        conflictTime: {
          start: apptStart.toISOString(),
          end: apptEnd.toISOString()
        }
      };
    }
  }

  return { hasConflict: false };
};

const calculateTimeSlots = (
  services: Service[],
  inputServices: AppointmentServiceInput[],
  date: string,
  startTimeStr: string
): TimeSlotResult => {
  const warnings: ValidationWarning[] = [];
  const items: AppointmentItem[] = [];

  const [startHour, startMin] = startTimeStr.split(':').map(Number);
  let currentTime = dayjs(date).hour(startHour).minute(startMin).second(0);

  let totalDuration = 0;
  let totalBufferTime = 0;

  for (let i = 0; i < inputServices.length; i++) {
    const input = inputServices[i];
    const service = services.find(s => s.id === input.serviceId);

    if (!service) {
      warnings.push({
        level: 'error',
        code: 'SERVICE_NOT_FOUND',
        message: `项目 ${input.serviceId} 不存在`
      });
      continue;
    }

    const itemStartTime = currentTime;
    const itemEndTime = currentTime.add(service.duration, 'minute');

    items.push({
      serviceId: service.id,
      employeeId: input.preferredEmployeeId,
      startTime: itemStartTime.toISOString(),
      endTime: itemEndTime.toISOString(),
      duration: service.duration,
      usePackage: false,
      usePoints: false,
      pointsUsed: 0,
      discountAmount: 0,
      finalPrice: service.price,
      notes: ''
    });

    totalDuration += service.duration;
    currentTime = itemEndTime;

    if (i < inputServices.length - 1) {
      currentTime = currentTime.add(BUFFER_TIME_MINUTES, 'minute');
      totalBufferTime += BUFFER_TIME_MINUTES;
    }
  }

  if (inputServices.length > 1) {
    warnings.push({
      level: 'info',
      code: 'BUFFER_TIME_ADDED',
      message: `已为连续项目自动添加 ${totalBufferTime} 分钟消毒缓冲时间`
    });
  }

  return {
    items,
    totalDuration,
    totalBufferTime,
    startTime: items[0]?.startTime || currentTime.toISOString(),
    endTime: items[items.length - 1]?.endTime || currentTime.toISOString(),
    warnings
  };
};

const findPreferredEmployee = (
  customerId: string,
  appointments: Appointment[]
): string | null => {
  const employeeCounts: Record<string, number> = {};

  appointments.forEach(appt => {
    if (appt.customerId === customerId && appt.employeeId) {
      employeeCounts[appt.employeeId] = (employeeCounts[appt.employeeId] || 0) + 1;
    }
  });

  let maxCount = 0;
  let preferredId: string | null = null;

  Object.entries(employeeCounts).forEach(([empId, count]) => {
    if (count > maxCount) {
      maxCount = count;
      preferredId = empId;
    }
  });

  return maxCount >= 1 ? preferredId : null;
};

const scoreEmployeeForItems = (
  employee: Employee,
  customerId: string,
  services: Service[],
  schedules: Schedule[],
  appointments: Appointment[],
  timeSlots: TimeSlotResult,
  date: string,
  preferredFromHistory: string | null,
  userPreferredEmployeeId?: string
): EmployeeRecommendation => {
  let score = 0;
  const reasons: string[] = [];
  let available = true;
  let conflictTime: { start: string; end: string } | undefined;
  let allSkillsMatched = true;

  for (let i = 0; i < timeSlots.items.length; i++) {
    const item = timeSlots.items[i];
    const service = services.find(s => s.id === item.serviceId);

    if (!service) continue;

    if (service.isAdvanced) {
      if (!employee.skills.includes(service.id)) {
        score -= 200;
        reasons.push(`不具备高阶项目「${service.name}」技能资质`);
        allSkillsMatched = false;
        available = false;
      } else {
        score += 30;
      }
    } else {
      if (employee.skills.includes(service.id)) {
        score += 20;
      } else {
        score -= 10;
      }
    }

    const startTime = dayjs(item.startTime);
    const endTime = dayjs(item.endTime);

    if (!isEmployeeOnShift(employee, schedules, date, startTime, endTime)) {
      score -= 50;
      reasons.push('所选时段不在排班时间内');
      available = false;
    } else {
      score += 10;
    }

    const conflict = getEmployeeConflict(employee.id, appointments, startTime, endTime);
    if (conflict.hasConflict) {
      score -= 80;
      reasons.push('该时段已有预约冲突');
      available = false;
      conflictTime = conflict.conflictTime;
    }
  }

  if (allSkillsMatched && timeSlots.items.length > 1) {
    score += 25;
    reasons.push('可连续服务所有项目');
  }

  if (userPreferredEmployeeId === employee.id) {
    score += 100;
    reasons.push('顾客指定美容师');
  }

  if (preferredFromHistory === employee.id) {
    score += 60;
    reasons.push('顾客历史服务偏好美容师');
  }

  if (employee.role === 'technician') {
    score += 5;
  }

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    score,
    reasons,
    available,
    conflictTime
  };
};

const recommendEmployees = (
  customerId: string,
  services: Service[],
  employees: Employee[],
  schedules: Schedule[],
  appointments: Appointment[],
  timeSlots: TimeSlotResult,
  date: string,
  userPreferredEmployeeId?: string
): EmployeeRecommendation[] => {
  const preferredFromHistory = findPreferredEmployee(customerId, appointments);

  const activeEmployees = employees.filter(e =>
    (e.role === 'beautician' || e.role === 'technician') &&
    e.status === 'active'
  );

  const recommendations = activeEmployees.map(employee =>
    scoreEmployeeForItems(
      employee,
      customerId,
      services,
      schedules,
      appointments,
      timeSlots,
      date,
      preferredFromHistory,
      userPreferredEmployeeId
    )
  );

  return recommendations.sort((a, b) => b.score - a.score);
};

const findAvailableCustomerPackages = (
  customerId: string,
  customerPackages: CustomerPackage[],
  packages: Package[],
  packageItems: PackageItem[],
  services: Service[],
  serviceId: string,
  usedPackageCounts: Map<string, Map<string, number>>
): { customerPackage: CustomerPackage; remaining: number; unitPrice: number }[] => {
  const available: { customerPackage: CustomerPackage; remaining: number; unitPrice: number }[] = [];
  const now = new Date();

  for (const cp of customerPackages) {
    if (cp.customerId !== customerId || cp.status !== 'active') continue;
    if (new Date(cp.expireDate) < now) continue;

    const originalRemaining = cp.remainingCounts[serviceId] || 0;
    const usedCount = usedPackageCounts.get(cp.id)?.get(serviceId) || 0;
    const remaining = originalRemaining - usedCount;

    if (remaining <= 0) continue;

    const pkg = packages.find(p => p.id === cp.packageId);
    const items = packageItems.filter(pi => pi.packageId === cp.packageId);

    let totalOriginalValue = 0;
    items.forEach(pi => {
      const service = services.find(s => s.id === pi.serviceId);
      if (service) {
        totalOriginalValue += pi.count * service.price;
      }
    });

    const serviceObj = services.find(s => s.id === serviceId);
    const serviceOriginalPrice = serviceObj?.price || 0;

    let unitPrice: number;
    if (totalOriginalValue > 0 && pkg) {
      unitPrice = (pkg.price * serviceOriginalPrice) / totalOriginalValue;
    } else {
      unitPrice = serviceOriginalPrice;
    }

    available.push({ customerPackage: cp, remaining, unitPrice });
  }

  return available.sort((a, b) => a.unitPrice - b.unitPrice);
};

const calculatePrices = (
  customerId: string,
  membership: Membership | undefined,
  services: Service[],
  customerPackages: CustomerPackage[],
  packages: Package[],
  packageItems: PackageItem[],
  timeSlots: TimeSlotResult,
  pointsBlocked: boolean
): PriceCalculationResult => {
  const warnings: ValidationWarning[] = [];
  const items: AppointmentPriceItem[] = [];

  let totalOriginal = 0;
  let totalMemberDiscount = 0;
  let totalPackageDiscount = 0;
  let totalPointsDiscount = 0;
  let pointsRemaining = membership?.points || 0;

  const usedPackageCounts = new Map<string, Map<string, number>>();

  const discountRule = getMembershipDiscountRule(membership?.level || 'bronze');

  for (const item of timeSlots.items) {
    const service = services.find(s => s.id === item.serviceId);
    if (!service) continue;

    const originalPrice = service.price;
    totalOriginal += originalPrice;

    let memberDiscount = originalPrice * (1 - discountRule.discountRate);
    const memberLevel = membership?.level || 'bronze';
    let packageDiscount = 0;
    let packageId: string | undefined;
    let pointsDiscount = 0;
    let pointsUsed = 0;
    let appliedDiscount: AppointmentPriceItem['appliedDiscount'] = 'none';
    let finalPrice = originalPrice;

    const availablePackages = findAvailableCustomerPackages(
      customerId,
      customerPackages,
      packages,
      packageItems,
      services,
      service.id,
      usedPackageCounts
    );

    let bestOption = 'member';
    let bestSavings = memberDiscount;

    if (availablePackages.length > 0) {
      const bestPackage = availablePackages[0];
      const packageUnitPrice = bestPackage.unitPrice;
      const potentialPackageDiscount = originalPrice - packageUnitPrice;

      if (potentialPackageDiscount > bestSavings) {
        bestSavings = potentialPackageDiscount;
        bestOption = 'package';
        packageDiscount = potentialPackageDiscount;
        packageId = bestPackage.customerPackage.id;
      }
    }

    if (!pointsBlocked && pointsRemaining > 0) {
      const pointsValueAvailable = pointsRemaining * POINTS_VALUE;
      const maxPointsDiscount = Math.min(pointsValueAvailable, originalPrice * 0.5);

      if (maxPointsDiscount > bestSavings) {
        bestSavings = maxPointsDiscount;
        bestOption = 'points';
        pointsUsed = Math.min(pointsRemaining, Math.ceil((originalPrice * 0.5) / POINTS_VALUE));
        pointsDiscount = pointsUsed * POINTS_VALUE;
        pointsRemaining -= pointsUsed;
      }
    }

    switch (bestOption) {
      case 'package':
        appliedDiscount = 'package';
        finalPrice = originalPrice - packageDiscount;

        if (packageId) {
          if (!usedPackageCounts.has(packageId)) {
            usedPackageCounts.set(packageId, new Map());
          }
          const pkgMap = usedPackageCounts.get(packageId)!;
          pkgMap.set(service.id, (pkgMap.get(service.id) || 0) + 1);
        }

        warnings.push({
          level: 'info',
          code: 'PACKAGE_USED',
          message: `「${service.name}」使用套餐抵扣，节省 ¥${packageDiscount.toFixed(2)}`,
          data: { packageId, remaining: availablePackages[0]?.remaining }
        });
        totalPackageDiscount += packageDiscount;
        break;
      case 'points':
        appliedDiscount = 'points';
        finalPrice = originalPrice - pointsDiscount;
        warnings.push({
          level: 'info',
          code: 'POINTS_USED',
          message: `「${service.name}」使用 ${pointsUsed} 积分抵扣，节省 ¥${pointsDiscount.toFixed(2)}`
        });
        totalPointsDiscount += pointsDiscount;
        break;
      case 'member':
        if (memberDiscount > 0) {
          appliedDiscount = 'member';
          finalPrice = originalPrice * discountRule.discountRate;
          warnings.push({
            level: 'info',
            code: 'MEMBER_DISCOUNT',
            message: `「${service.name}」享受${memberLevel === 'bronze' ? '' : memberLevel}会员折扣，节省 ¥${memberDiscount.toFixed(2)}`
          });
          totalMemberDiscount += memberDiscount;
        }
        break;
    }

    items.push({
      serviceId: service.id,
      serviceName: service.name,
      originalPrice,
      memberDiscount: appliedDiscount === 'member' ? memberDiscount : 0,
      memberLevel,
      packageDiscount,
      packageId,
      pointsDiscount,
      pointsUsed,
      finalPrice,
      appliedDiscount
    });
  }

  const totalDiscount = totalMemberDiscount + totalPackageDiscount + totalPointsDiscount;
  const totalFinal = totalOriginal - totalDiscount;

  return {
    items,
    totalOriginal,
    totalMemberDiscount,
    totalPackageDiscount,
    totalPointsDiscount,
    totalDiscount,
    totalFinal,
    pointsRemaining,
    pointsBlocked,
    warnings
  };
};

const checkHealthWarnings = (
  customer: Customer,
  allergies: Allergy[],
  skinAnalyses: SkinAnalysis[],
  services: Service[],
  serviceIds: string[]
): string[] => {
  const alerts: string[] = [];

  const customerAllergies = allergies.filter(a => a.customerId === customer.id);
  const recentAnalysis = skinAnalyses
    .filter(sa => sa.customerId === customer.id)
    .sort((a, b) => new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime())[0];

  const allergyKeywords = customerAllergies
    .map(a => a.allergen?.trim().toLowerCase())
    .filter((a): a is string => !!a && a.length > 0);

  for (const serviceId of serviceIds) {
    const service = services.find(s => s.id === serviceId);
    if (!service) continue;

    for (const contraindication of service.contraindications) {
      if (!contraindication || contraindication.trim() === '') continue;

      const contraLower = contraindication.toLowerCase();

      if (contraLower.includes('过敏')) {
        const allergyTerm = contraLower.replace(/过敏|过敏史/g, '').trim();
        if (allergyTerm && allergyTerm.length >= 2) {
          const hasMatch = allergyKeywords.some(ak =>
            ak.includes(allergyTerm) || allergyTerm.includes(ak)
          );
          if (hasMatch) {
            alerts.push(`⚠️ 「${service.name}」存在禁忌提示：${contraindication}（顾客有相关过敏史）`);
          }
        }
        continue;
      }

      if (contraLower.includes('孕期') || contraLower.includes('哺乳') || contraLower.includes('妊娠')) {
        continue;
      }

      const hasMatchingAllergy = allergyKeywords.some(ak => {
        if (contraLower.includes(ak) && ak.length >= 2) {
          return true;
        }
        const contraWords = contraLower.split(/[，。、；：！？\s]+/).filter(w => w.length >= 2);
        return contraWords.some(word => ak.includes(word) && word.length >= 2);
      });

      if (hasMatchingAllergy) {
        alerts.push(`⚠️ 「${service.name}」存在禁忌提示：${contraindication}（顾客有相关过敏史）`);
      }
    }

    if (recentAnalysis) {
      const isSensitive = recentAnalysis.sensitivity === '明显' || customer.skinType === '敏感肌';
      const isAbnormal = recentAnalysis.skinCondition === '较差' || recentAnalysis.skinCondition === '需改善';

      if (isSensitive && service.contraindications.some(c => c && c.includes('敏感'))) {
        alerts.push(`⚠️ 「${service.name}」提示：顾客近期皮肤检测敏感度为「${recentAnalysis.sensitivity}」，请确认是否适合`);
      }
      if (isAbnormal && service.category === '面部护理') {
        alerts.push(`⚠️ 「${service.name}」提示：顾客近期皮肤状况为「${recentAnalysis.skinCondition}」，建议先咨询美容师`);
      }
    }
  }

  if (customerAllergies.some(a => a.severity === 'severe' && a.allergen?.trim())) {
    alerts.push(`⚠️ 顾客有重度过敏史，操作前请再次确认过敏源`);
  }

  return [...new Set(alerts)];
};

const checkNoShowPolicy = (
  customerId: string,
  membership: Membership | undefined,
  appointments: Appointment[]
): { needsConfirm: boolean; pointsBlocked: boolean; recentNoShows: number } => {
  if (!membership || membership.level !== 'diamond') {
    return { needsConfirm: false, pointsBlocked: false, recentNoShows: 0 };
  }

  const thirtyDaysAgo = dayjs().subtract(30, 'day');

  const recentNoShows = appointments.filter(a =>
    a.customerId === customerId &&
    a.status === 'no_show' &&
    dayjs(a.startTime).isAfter(thirtyDaysAgo)
  ).length;

  return {
    needsConfirm: recentNoShows >= NO_SHOW_LIMIT_FOR_DIAMOND,
    pointsBlocked: recentNoShows >= NO_SHOW_LIMIT_FOR_DIAMOND,
    recentNoShows
  };
};

const batchId = (): string => {
  return 'B' + generateId().slice(1);
};

export const validateSmartAppointment = (
  state: AppState,
  input: SmartAppointmentInput
): SmartValidationResult => {
  const allWarnings: ValidationWarning[] = [];

  const customer = state.customers.find(c => c.id === input.customerId);
  if (!customer) {
    return {
      valid: false,
      warnings: [{ level: 'error', code: 'CUSTOMER_NOT_FOUND', message: '顾客不存在' }],
      employeeRecommendations: [],
      priceCalculation: {
        items: [], totalOriginal: 0, totalMemberDiscount: 0, totalPackageDiscount: 0,
        totalPointsDiscount: 0, totalDiscount: 0, totalFinal: 0, pointsRemaining: 0, pointsBlocked: false, warnings: []
      },
      timeSlot: { items: [], totalDuration: 0, totalBufferTime: 0, startTime: '', endTime: '', warnings: [] },
      healthAlerts: [],
      needsReceptionConfirm: false,
      pointsBlocked: false,
      suggestedAppointments: []
    };
  }

  const membership = state.memberships.find(m => m.customerId === input.customerId);

  const services = input.services
    .map(s => state.services.find(srv => srv.id === s.serviceId))
    .filter((s): s is Service => !!s);

  if (services.length !== input.services.length) {
    allWarnings.push({ level: 'error', code: 'SERVICES_NOT_FOUND', message: '部分项目不存在' });
  }

  const date = dayjs(input.date).format('YYYY-MM-DD');
  const timeSlotResult = calculateTimeSlots(state.services, input.services, date, input.startTime);
  allWarnings.push(...timeSlotResult.warnings);

  const userPreferredEmployeeId = input.services.find(s => s.preferredEmployeeId)?.preferredEmployeeId;
  const employeeRecommendations = recommendEmployees(
    input.customerId,
    state.services,
    state.employees,
    state.schedules,
    state.appointments,
    timeSlotResult,
    date,
    userPreferredEmployeeId
  );

  const bestAvailable = employeeRecommendations.filter(r => r.available);

  let bestEmployeeId: string | undefined;
  if (userPreferredEmployeeId && bestAvailable.some(r => r.employeeId === userPreferredEmployeeId)) {
    bestEmployeeId = userPreferredEmployeeId;
  } else if (bestAvailable.length > 0) {
    bestEmployeeId = bestAvailable[0].employeeId;
  } else {
    allWarnings.push({
      level: 'error',
      code: 'NO_AVAILABLE_EMPLOYEE',
      message: '所选时段没有符合条件的在岗美容师，请调整时间或项目'
    });
  }

  const noShowCheck = checkNoShowPolicy(
    input.customerId,
    membership,
    state.appointments
  );

  const priceCalculation = calculatePrices(
    input.customerId,
    membership,
    state.services,
    state.customerPackages,
    state.packages,
    state.packageItems,
    timeSlotResult,
    noShowCheck.pointsBlocked
  );
  allWarnings.push(...priceCalculation.warnings);

  const healthAlerts = checkHealthWarnings(
    customer,
    state.allergies,
    state.skinAnalyses,
    state.services,
    input.services.map(s => s.serviceId)
  );

  if (noShowCheck.needsConfirm) {
    allWarnings.push({
      level: 'warning',
      code: 'DIAMOND_NO_SHOW_CONFIRM',
      message: `该钻石会员近30天已有${noShowCheck.recentNoShows}次爽约记录，本次预约需前台二次确认`
    });
  }

  if (noShowCheck.pointsBlocked) {
    allWarnings.push({
      level: 'warning',
      code: 'POINTS_BLOCKED',
      message: '由于近期爽约记录，本次预约不可使用积分抵扣'
    });
  }

  healthAlerts.forEach(alert => {
    allWarnings.push({
      level: 'warning',
      code: 'HEALTH_ALERT',
      message: alert
    });
  });

  const valid = !allWarnings.some(w => w.level === 'error');

  const baseNotes = input.notes || '';
  const multiServiceGroupId = batchId();
  const suggestedAppointments: Appointment[] = [];

  timeSlotResult.items.forEach((item, idx) => {
    const priceItem = priceCalculation.items.find(p => p.serviceId === item.serviceId);
    const service = services.find(s => s.id === item.serviceId);

    if (service && priceItem) {
      const employeeForItem = bestEmployeeId || '';
      const isMulti = timeSlotResult.items.length > 1;

      suggestedAppointments.push({
        id: generateId(),
        customerId: input.customerId,
        serviceId: item.serviceId,
        employeeId: employeeForItem,
        startTime: item.startTime,
        endTime: item.endTime,
        duration: item.duration,
        status: noShowCheck.needsConfirm ? 'pending' : 'confirmed',
        source: input.source,
        notes: baseNotes,
        reminderSent: false,
        priceItems: [priceItem],
        totalOriginalPrice: priceItem.originalPrice,
        totalDiscount: priceItem.originalPrice - priceItem.finalPrice,
        totalFinalPrice: priceItem.finalPrice,
        needsReceptionConfirm: noShowCheck.needsConfirm,
        healthWarnings: idx === 0 ? healthAlerts : undefined,
        isMultiService: isMulti,
        multiServiceGroupId: isMulti ? multiServiceGroupId : undefined,
        multiServiceIndex: isMulti ? idx : undefined
      });
    }
  });

  return {
    valid,
    warnings: allWarnings,
    employeeRecommendations,
    priceCalculation,
    timeSlot: timeSlotResult,
    healthAlerts,
    needsReceptionConfirm: noShowCheck.needsConfirm,
    pointsBlocked: noShowCheck.pointsBlocked,
    suggestedAppointments
  };
};

export const getHighLevelServices = (services: Service[]): Service[] => {
  return services.filter(s => s.isAdvanced);
};

export const getServiceContraindications = (service: Service): string[] => {
  return service.contraindications;
};
