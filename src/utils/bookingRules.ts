import type { Membership } from '../types';

/**
 * 智能预约校验 —— 集中式业务规则配置
 *
 * ⚠️ 说明：现有代码库中并不存在“会员等级折扣率 / 积分抵扣比例 / 套餐互斥”等规则，
 * 本文件为这些规则给出一套合理默认值并集中管理，方便后续按门店实际情况调整。
 * 引擎（bookingValidation.ts）与页面只从这里读取常量，不要在别处硬编码这些数字。
 */

/** 会员等级折扣率（0.85 表示 8.5 折；bronze 无折扣 = 1） */
export const MEMBERSHIP_DISCOUNT: Record<Membership['level'], number> = {
  bronze: 1,
  silver: 0.98,
  gold: 0.95,
  platinum: 0.92,
  diamond: 0.88,
};

/** 积分抵扣比例：多少积分抵 1 元（与 store 中“消费满 10 元得 1 积分”方向一致） */
export const POINTS_PER_YUAN = 100;

/** 单笔订单积分最多可抵扣的比例上限（防止全额积分支付） */
export const MAX_POINTS_DEDUCT_RATIO = 0.5;

/**
 * 高阶项目的判定：按项目分类（category）。
 * 命中以下分类的项目视为高阶，必须由“技能标签包含该项目且在岗”的美容师承接。
 */
export const ADVANCED_CATEGORIES = ['面部护理', '身体护理'];

/** 连续项目之间需要预留的消毒缓冲时间（分钟） */
export const STERILIZATION_BUFFER_MINUTES = 15;

/** 钻石会员连续爽约达到该次数后，下次预约需前台二次确认，且禁止使用积分抵扣 */
export const NO_SHOW_CONFIRM_THRESHOLD = 2;

/** 触发爽约二次确认规则的会员等级 */
export const NO_SHOW_RULE_LEVEL: Membership['level'] = 'diamond';

/**
 * 皮肤检测“异常”判定：皮肤分析记录中命中以下关键字视为异常，
 * 需在预约时提醒（不禁止预约）。
 */
export const ABNORMAL_SKIN_KEYWORDS = ['较差', '需改善', '明显', '偏高'];

/** 视为“最近”的皮肤检测天数窗口（仅在该窗口内的异常检测才提醒） */
export const RECENT_SKIN_ANALYSIS_DAYS = 30;

/** 门店营业时间（用于连续排期的边界提示） */
export const BUSINESS_HOURS = { start: 9, end: 21 };
