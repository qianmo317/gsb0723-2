export interface Customer {
  id: string;
  name: string;
  phone: string;
  birthday: string;
  gender: 'male' | 'female';
  avatar: string;
  address: string;
  skinType: string;
  notes: string;
  createdAt: string;
}

export interface SkinAnalysis {
  id: string;
  customerId: string;
  analysisDate: string;
  skinType: string;
  oiliness: string;
  moisture: string;
  elasticity: string;
  sensitivity: string;
  skinCondition: string;
  recommendations: string;
  photoUrl?: string;
}

export interface Allergy {
  id: string;
  customerId: string;
  allergen: string;
  severity: 'mild' | 'moderate' | 'severe';
  discoveredDate: string;
  notes: string;
}

export interface ServiceRecord {
  id: string;
  customerId: string;
  serviceId: string;
  employeeId: string;
  serviceDate: string;
  price: number;
  notes: string;
}

export interface Membership {
  id: string;
  customerId: string;
  level: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  points: number;
  totalSpent: number;
  joinDate: string;
  expireDate: string;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  description: string;
  suitableSkin: string[];
  effectDescription: string;
  imageUrl: string;
  status: 'active' | 'inactive';
  isAdvanced: boolean;
  contraindications: string[];
}

export interface Package {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  validityDays: number;
  description: string;
  imageUrl: string;
  status: 'active' | 'inactive';
}

export interface PackageItem {
  id: string;
  packageId: string;
  serviceId: string;
  count: number;
}

export interface AppointmentPriceItem {
  serviceId: string;
  serviceName: string;
  originalPrice: number;
  memberDiscount: number;
  memberLevel: string;
  packageDiscount: number;
  packageId?: string;
  pointsDiscount: number;
  pointsUsed: number;
  finalPrice: number;
  appliedDiscount: 'none' | 'member' | 'package' | 'points';
}

export interface Appointment {
  id: string;
  customerId: string;
  serviceId: string;
  employeeId: string;
  startTime: string;
  endTime: string;
  duration: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  source: 'phone' | 'wechat' | 'walk_in' | 'online';
  notes: string;
  reminderSent: boolean;
  priceItems?: AppointmentPriceItem[];
  totalOriginalPrice?: number;
  totalDiscount?: number;
  totalFinalPrice?: number;
  needsReceptionConfirm?: boolean;
  healthWarnings?: string[];
  isMultiService?: boolean;
  multiServiceGroupId?: string;
  multiServiceIndex?: number;
}

export interface WaitList {
  id: string;
  customerId: string;
  serviceId: string;
  preferredDate: string;
  addedAt: string;
  status: 'waiting' | 'notified' | 'cancelled' | 'booked';
}

export interface Employee {
  id: string;
  name: string;
  role: 'beautician' | 'manager' | 'receptionist' | 'technician';
  phone: string;
  avatar: string;
  hireDate: string;
  baseSalary: number;
  commissionRate: number;
  skills: string[];
  status: 'active' | 'leave' | 'terminated';
}

export interface Schedule {
  id: string;
  employeeId: string;
  date: string;
  shiftType: 'morning' | 'afternoon' | 'full_day' | 'off' | 'overtime';
  startTime: string;
  endTime: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  status: 'present' | 'absent' | 'late' | 'leave';
}

export interface Review {
  id: string;
  employeeId: string;
  customerId: string;
  rating: number;
  comment: string;
  reviewDate: string;
  serviceId: string;
}

export interface Commission {
  id: string;
  employeeId: string;
  serviceRecordId: string;
  amount: number;
  commissionDate: string;
}

export interface DashboardStats {
  monthlyRevenue: number;
  newCustomers: number;
  totalAppointments: number;
  completedServices: number;
  revenueTrend: { date: string; value: number }[];
  topEmployees: { name: string; value: number }[];
  todayAppointments: TodayAppointment[];
}

export interface TodayAppointment {
  id: string;
  customerName: string;
  customerAvatar: string;
  serviceName: string;
  employeeName: string;
  time: string;
  status: string;
}

export interface CustomerPackage {
  id: string;
  customerId: string;
  packageId: string;
  purchaseDate: string;
  expireDate: string;
  remainingCounts: Record<string, number>;
  originalPrice: number;
  paidPrice: number;
  status: 'active' | 'expired' | 'used_up';
}

export interface AppointmentItem {
  serviceId: string;
  employeeId?: string;
  startTime: string;
  endTime: string;
  duration: number;
  usePackage: boolean;
  packageId?: string;
  usePoints: boolean;
  pointsUsed: number;
  discountAmount: number;
  finalPrice: number;
  notes: string;
}

export interface ValidationWarning {
  level: 'info' | 'warning' | 'error' | 'critical';
  code: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface EmployeeRecommendation {
  employeeId: string;
  employeeName: string;
  score: number;
  reasons: string[];
  available: boolean;
  conflictTime?: { start: string; end: string };
}

export type PriceBreakdownItem = AppointmentPriceItem;

export interface PriceCalculationResult {
  items: PriceBreakdownItem[];
  totalOriginal: number;
  totalMemberDiscount: number;
  totalPackageDiscount: number;
  totalPointsDiscount: number;
  totalDiscount: number;
  totalFinal: number;
  pointsRemaining: number;
  pointsBlocked: boolean;
  warnings: ValidationWarning[];
}

export interface TimeSlotResult {
  items: AppointmentItem[];
  totalDuration: number;
  totalBufferTime: number;
  startTime: string;
  endTime: string;
  warnings: ValidationWarning[];
}

export interface SmartValidationResult {
  valid: boolean;
  warnings: ValidationWarning[];
  employeeRecommendations: EmployeeRecommendation[];
  priceCalculation: PriceCalculationResult;
  timeSlot: TimeSlotResult;
  healthAlerts: string[];
  needsReceptionConfirm: boolean;
  pointsBlocked: boolean;
  suggestedAppointments: Appointment[];
}

export interface MembershipDiscountRule {
  level: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  discountRate: number;
  pointsRate: number;
}

export const MEMBERSHIP_DISCOUNT_RULES: MembershipDiscountRule[] = [
  { level: 'bronze', discountRate: 1.0, pointsRate: 1 },
  { level: 'silver', discountRate: 0.95, pointsRate: 1.1 },
  { level: 'gold', discountRate: 0.9, pointsRate: 1.2 },
  { level: 'platinum', discountRate: 0.85, pointsRate: 1.5 },
  { level: 'diamond', discountRate: 0.8, pointsRate: 2 },
];

export const POINTS_VALUE = 0.01;
export const BUFFER_TIME_MINUTES = 15;
export const NO_SHOW_LIMIT_FOR_DIAMOND = 2;
