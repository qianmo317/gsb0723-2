import { configureStore, createSlice, PayloadAction, combineReducers } from '@reduxjs/toolkit';
import { storage } from '../utils/storage';
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
  Review,
  Attendance,
  Commission,
  WaitList,
  CustomerPackage
} from '../types';
import {
  mockCustomers,
  mockSkinAnalyses,
  mockAllergies,
  mockMemberships,
  mockServices,
  mockPackages,
  mockPackageItems,
  mockEmployees,
  mockAppointments,
  mockServiceRecords,
  mockSchedules,
  mockReviews,
  mockAttendance,
  mockCommissions,
  mockWaitList,
  mockCustomerPackages
} from '../mock';

interface AppState {
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
  reviews: Review[];
  attendance: Attendance[];
  commissions: Commission[];
  waitList: WaitList[];
  customerPackages: CustomerPackage[];
  initialized: boolean;
}

const STORAGE_KEY = 'app_state';

const loadState = (): AppState => {
  try {
    const saved = storage.get<AppState>(STORAGE_KEY);
    if (saved && saved.initialized) {
      // Verify data integrity
      const firstCustomer = saved.customers[0];
      if (firstCustomer && firstCustomer.avatar && firstCustomer.avatar.includes('data:image/svg+xml;base64,')) {
        const b64 = firstCustomer.avatar.replace('data:image/svg+xml;base64,', '');
        try {
          atob(b64);
          // 兼容旧版本持久化数据：补齐新增的 customerPackages
          if (!saved.customerPackages) {
            saved.customerPackages = mockCustomerPackages(
              saved.customers.map(c => c.id),
              saved.packages,
              saved.packageItems
            ) as CustomerPackage[];
          }
          return saved;
        } catch (e) {
          console.log('Detected corrupted data, regenerating...');
          storage.clear();
        }
      }
    }
  } catch (e) {
    console.log('Loading fresh data...');
  }

  const customers = mockCustomers();
  const customerIds = customers.map(c => c.id);
  const services = mockServices() as Service[];
  const serviceIds = services.map(s => s.id);
  const employees = mockEmployees() as Employee[];
  const employeeIds = employees.map(e => e.id);
  const packages = mockPackages() as Package[];
  const packageItems = mockPackageItems(packages);

  return {
    customers,
    skinAnalyses: mockSkinAnalyses(customerIds),
    allergies: mockAllergies(customerIds),
    memberships: mockMemberships(customerIds),
    services,
    packages,
    packageItems,
    employees,
    appointments: mockAppointments(customerIds, serviceIds, employeeIds),
    serviceRecords: mockServiceRecords(customerIds, serviceIds, employeeIds),
    schedules: mockSchedules(employeeIds),
    reviews: mockReviews(customerIds, employeeIds, serviceIds),
    attendance: mockAttendance(employeeIds),
    commissions: mockCommissions(employeeIds),
    waitList: mockWaitList(customerIds, serviceIds),
    customerPackages: mockCustomerPackages(customerIds, packages, packageItems) as CustomerPackage[],
    initialized: true
  };
};

const initialState: AppState = loadState();

const saveState = (state: AppState) => {
  storage.set(STORAGE_KEY, state);
};

/** 预约进入这些状态才实际占用套餐次数/积分（pending/cancelled/no_show 不占用） */
const isSettledStatus = (status: Appointment['status']): boolean =>
  status === 'confirmed' || status === 'completed';

/**
 * 应用预约的计费扣减（套餐扣次数 / 积分扣分）。
 * 幂等：已 settled 的 billing 不会重复扣减。
 */
const applyBilling = (state: AppState, appt: Appointment) => {
  const billing = appt.billing;
  if (!billing || billing.settled) return;

  if (billing.plan === 'package' && billing.coveredByPackage && billing.customerPackageId) {
    const cp = state.customerPackages.find((p) => p.id === billing.customerPackageId);
    if (cp) {
      const item = cp.items.find((it) => it.serviceId === appt.serviceId);
      if (item) item.remainingCount = Math.max(0, item.remainingCount - 1);
      if (cp.items.every((it) => it.remainingCount === 0)) cp.status = 'used_up';
    }
  } else if (billing.plan === 'points' && billing.pointsUsed > 0) {
    const membership = state.memberships.find((m) => m.customerId === appt.customerId);
    if (membership) membership.points = Math.max(0, membership.points - billing.pointsUsed);
  }
  billing.settled = true;
};

/**
 * 回退预约的计费扣减（取消 / 爽约 / 从已结算状态退回时调用）。
 * 幂等：未 settled 的 billing 不会重复回退。
 */
const rollbackBilling = (state: AppState, appt: Appointment) => {
  const billing = appt.billing;
  if (!billing || !billing.settled) return;

  if (billing.plan === 'package' && billing.coveredByPackage && billing.customerPackageId) {
    const cp = state.customerPackages.find((p) => p.id === billing.customerPackageId);
    if (cp) {
      const item = cp.items.find((it) => it.serviceId === appt.serviceId);
      if (item) item.remainingCount += 1;
      // 回退后若重新有余量，且未过期，则从 used_up 恢复为 active
      if (cp.status === 'used_up' && cp.items.some((it) => it.remainingCount > 0)) {
        cp.status = 'active';
      }
    }
  } else if (billing.plan === 'points' && billing.pointsUsed > 0) {
    const membership = state.memberships.find((m) => m.customerId === appt.customerId);
    if (membership) membership.points += billing.pointsUsed;
  }
  billing.settled = false;
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    addCustomer: (state, action: PayloadAction<Customer>) => {
      state.customers.unshift(action.payload);
      saveState(state);
    },
    updateCustomer: (state, action: PayloadAction<Customer>) => {
      const index = state.customers.findIndex(c => c.id === action.payload.id);
      if (index !== -1) {
        state.customers[index] = action.payload;
        saveState(state);
      }
    },
    deleteCustomer: (state, action: PayloadAction<string>) => {
      state.customers = state.customers.filter(c => c.id !== action.payload);
      saveState(state);
    },
    addSkinAnalysis: (state, action: PayloadAction<SkinAnalysis>) => {
      state.skinAnalyses.unshift(action.payload);
      saveState(state);
    },
    addAllergy: (state, action: PayloadAction<Allergy>) => {
      state.allergies.unshift(action.payload);
      saveState(state);
    },
    updateAllergy: (state, action: PayloadAction<Allergy>) => {
      const index = state.allergies.findIndex(a => a.id === action.payload.id);
      if (index !== -1) {
        state.allergies[index] = action.payload;
        saveState(state);
      }
    },
    deleteAllergy: (state, action: PayloadAction<string>) => {
      state.allergies = state.allergies.filter(a => a.id !== action.payload);
      saveState(state);
    },
    addService: (state, action: PayloadAction<Service>) => {
      state.services.unshift(action.payload);
      saveState(state);
    },
    updateService: (state, action: PayloadAction<Service>) => {
      const index = state.services.findIndex(s => s.id === action.payload.id);
      if (index !== -1) {
        state.services[index] = action.payload;
        saveState(state);
      }
    },
    deleteService: (state, action: PayloadAction<string>) => {
      state.services = state.services.filter(s => s.id !== action.payload);
      saveState(state);
    },
    addPackage: (state, action: PayloadAction<Package>) => {
      state.packages.unshift(action.payload);
      saveState(state);
    },
    updatePackage: (state, action: PayloadAction<Package>) => {
      const index = state.packages.findIndex(p => p.id === action.payload.id);
      if (index !== -1) {
        state.packages[index] = action.payload;
        saveState(state);
      }
    },
    addAppointment: (state, action: PayloadAction<Appointment>) => {
      state.appointments.unshift(action.payload);
      // 在草稿态上结算：仅当以已确认/已完成状态创建时才立即扣减；pending 等前台二次确认后再扣
      const appt = state.appointments[0];
      if (isSettledStatus(appt.status)) {
        applyBilling(state, appt);
      }
      saveState(state);
    },
    updateAppointment: (state, action: PayloadAction<Appointment>) => {
      const index = state.appointments.findIndex(a => a.id === action.payload.id);
      if (index !== -1) {
        const prevSettled = state.appointments[index].billing?.settled;
        // 用 payload 覆盖，但对 billing 做浅拷贝，确保其为可 mutate 的新对象（immer 会冻结旧引用）
        const next: Appointment = {
          ...action.payload,
          billing: action.payload.billing
            ? { ...action.payload.billing, settled: prevSettled }
            : undefined,
        };
        state.appointments[index] = next;
        const draft = state.appointments[index]; // 草稿引用
        // 状态驱动结算：进入确认/完成 → 扣减；退回或取消/爽约 → 回退
        if (isSettledStatus(draft.status)) {
          applyBilling(state, draft);
        } else {
          rollbackBilling(state, draft);
        }
        saveState(state);
      }
    },
    deleteAppointment: (state, action: PayloadAction<string>) => {
      const appt = state.appointments.find(a => a.id === action.payload);
      // 删除已结算的预约需回退占用，避免套餐次数/积分凭空消失
      if (appt) rollbackBilling(state, appt);
      state.appointments = state.appointments.filter(a => a.id !== action.payload);
      saveState(state);
    },
    addEmployee: (state, action: PayloadAction<Employee>) => {
      state.employees.unshift(action.payload);
      saveState(state);
    },
    updateEmployee: (state, action: PayloadAction<Employee>) => {
      const index = state.employees.findIndex(e => e.id === action.payload.id);
      if (index !== -1) {
        state.employees[index] = action.payload;
        saveState(state);
      }
    },
    updateSchedule: (state, action: PayloadAction<Schedule>) => {
      const index = state.schedules.findIndex(s => s.id === action.payload.id);
      if (index !== -1) {
        state.schedules[index] = action.payload;
      } else {
        state.schedules.push(action.payload);
      }
      saveState(state);
    },
    addWaitList: (state, action: PayloadAction<WaitList>) => {
      state.waitList.unshift(action.payload);
      saveState(state);
    },
    updateWaitList: (state, action: PayloadAction<WaitList>) => {
      const index = state.waitList.findIndex(w => w.id === action.payload.id);
      if (index !== -1) {
        state.waitList[index] = action.payload;
        saveState(state);
      }
    },
    deleteWaitList: (state, action: PayloadAction<string>) => {
      state.waitList = state.waitList.filter(w => w.id !== action.payload);
      saveState(state);
    },
    addServiceRecord: (state, action: PayloadAction<ServiceRecord>) => {
      state.serviceRecords.unshift(action.payload);
      const membership = state.memberships.find(m => m.customerId === action.payload.customerId);
      if (membership) {
        membership.totalSpent += action.payload.price;
        membership.points += Math.floor(action.payload.price / 10);
        if (membership.totalSpent > 30000) membership.level = 'diamond';
        else if (membership.totalSpent > 20000) membership.level = 'platinum';
        else if (membership.totalSpent > 10000) membership.level = 'gold';
        else if (membership.totalSpent > 5000) membership.level = 'silver';
      }
      saveState(state);
    },
    addCustomerPackage: (state, action: PayloadAction<CustomerPackage>) => {
      state.customerPackages.unshift(action.payload);
      saveState(state);
    },
    // 按套餐拆单消耗剩余次数：payload 为 { customerPackageId, serviceId, count }
    deductCustomerPackage: (
      state,
      action: PayloadAction<{ customerPackageId: string; serviceId: string; count: number }>
    ) => {
      const cp = state.customerPackages.find(p => p.id === action.payload.customerPackageId);
      if (cp) {
        const item = cp.items.find(it => it.serviceId === action.payload.serviceId);
        if (item) {
          item.remainingCount = Math.max(0, item.remainingCount - action.payload.count);
        }
        if (cp.items.every(it => it.remainingCount === 0)) {
          cp.status = 'used_up';
        }
        saveState(state);
      }
    },
    // 积分抵扣后扣减会员积分：payload 为 { customerId, points }
    deductPoints: (
      state,
      action: PayloadAction<{ customerId: string; points: number }>
    ) => {
      const membership = state.memberships.find(m => m.customerId === action.payload.customerId);
      if (membership) {
        membership.points = Math.max(0, membership.points - action.payload.points);
        saveState(state);
      }
    }
  }
});

export const {
  addCustomer,
  updateCustomer,
  deleteCustomer,
  addSkinAnalysis,
  addAllergy,
  updateAllergy,
  deleteAllergy,
  addService,
  updateService,
  deleteService,
  addPackage,
  updatePackage,
  addAppointment,
  updateAppointment,
  deleteAppointment,
  addEmployee,
  updateEmployee,
  updateSchedule,
  addWaitList,
  updateWaitList,
  deleteWaitList,
  addServiceRecord,
  addCustomerPackage,
  deductCustomerPackage,
  deductPoints
} = appSlice.actions;

export const store = configureStore({
  reducer: {
    app: appSlice.reducer
  }
});

/** 导出纯 reducer，便于在测试中对手工构造的 state 运行 action（不依赖随机 mock 数据） */
export const appReducer = appSlice.reducer;

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
