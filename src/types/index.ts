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

export interface CustomerPackageItem {
  serviceId: string;
  totalCount: number;
  usedCount: number;
  remainingCount: number;
}

export interface CustomerPackage {
  id: string;
  customerId: string;
  packageId: string;
  purchaseDate: string;
  expireDate: string;
  remainingItems: CustomerPackageItem[];
  status: 'active' | 'expired' | 'exhausted';
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  field?: string;
}

export interface BookingServiceItem {
  serviceId: string;
  employeeId?: string;
}

export interface ServicePriceBreakdown {
  serviceId: string;
  serviceName: string;
  originalPrice: number;
  memberDiscountRate: number;
  memberDiscountedPrice: number;
  packageDeduction: number;
  pointsDeduction: number;
  finalPrice: number;
  usedDiscountType: 'package' | 'points' | 'none';
  packageId?: string;
  packageName?: string;
  customerPackageId?: string;
  splitFromPackage: boolean;
  splitReason?: 'expired' | 'insufficient_sessions';
}

export interface BeauticianSuggestion {
  employeeId: string;
  employeeName: string;
  reason: 'preferred' | 'skill_match' | 'available';
  score: number;
  coversAllItems?: boolean;
}

export interface ScheduledBookingItem {
  serviceId: string;
  serviceName: string;
  employeeId: string;
  employeeName: string;
  startTime: string;
  endTime: string;
  duration: number;
  bufferAfter: number;
}

export interface BookingValidationResult {
  valid: boolean;
  canWaitlist: boolean;
  conflictItemIndexes: number[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
  suggestedEmployees: BeauticianSuggestion[];
  pricing: ServicePriceBreakdown[];
  totalPrice: number;
  totalOriginalPrice: number;
  totalSavings: number;
  requiresDoubleConfirm: boolean;
  doubleConfirmReason?: string;
  pointsBlocked: boolean;
  pointsBlockedReason?: string;
  bufferMinutes: number;
  scheduledItems: ScheduledBookingItem[];
}
