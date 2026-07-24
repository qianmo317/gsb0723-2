import React, { useMemo, useState } from 'react';
import {
  Row,
  Col,
  Card,
  Form,
  Select,
  DatePicker,
  TimePicker,
  Button,
  Tag,
  Space,
  Alert,
  Timeline,
  Radio,
  Descriptions,
  Divider,
  Empty,
  message,
  Modal,
  Statistic,
} from 'antd';
import {
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useSelector, useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import type { RootState } from '../../store';
import { addAppointment } from '../../store';
import type { Appointment, AppointmentBilling } from '../../types';
import { formatCurrency, generateId, getStatusText } from '../../utils/format';
import {
  validateBooking,
  type ValidationResult,
  type PricingPlan,
  type IssueLevel,
} from '../../utils/bookingValidation';
import { STERILIZATION_BUFFER_MINUTES, BUSINESS_HOURS } from '../../utils/bookingRules';

const issueColor: Record<IssueLevel, string> = {
  block: 'error',
  confirm: 'warning',
  warning: 'info',
};

const issueIcon: Record<IssueLevel, React.ReactNode> = {
  block: <ExclamationCircleOutlined />,
  confirm: <WarningOutlined />,
  warning: <WarningOutlined />,
};

const SmartBooking: React.FC = () => {
  const dispatch = useDispatch();
  const state = useSelector((s: RootState) => s.app);

  const [customerId, setCustomerId] = useState<string | undefined>();
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState(dayjs());
  const [time, setTime] = useState(dayjs().hour(10).minute(0));
  const [selectedPlan, setSelectedPlan] = useState<PricingPlan['key']>('package');
  const [result, setResult] = useState<ValidationResult | null>(null);

  const activeServices = state.services.filter((s) => s.status === 'active');

  const runValidation = () => {
    if (!customerId || serviceIds.length === 0) {
      message.warning('请先选择顾客并至少选择一个项目');
      return;
    }
    const startTime = date.hour(time.hour()).minute(time.minute()).second(0).toDate();
    const res = validateBooking({
      customerId,
      serviceIds,
      startTime,
      data: {
        services: state.services,
        employees: state.employees,
        appointments: state.appointments,
        schedules: state.schedules,
        memberships: state.memberships,
        customerPackages: state.customerPackages,
        skinAnalyses: state.skinAnalyses,
        allergies: state.allergies,
        customers: state.customers,
      },
    });
    setResult(res);
    setSelectedPlan(res.pricing.recommendedKey);
  };

  const chosenPlan = useMemo(
    () => result?.pricing.plans.find((p) => p.key === selectedPlan),
    [result, selectedPlan]
  );

  const doConfirm = () => {
    if (!result || !customerId || !chosenPlan) return;

    // 预先计算积分抵扣在各现金项目上的分摊（按现金价占比，末项兜差保证合计一致）
    const cashLineIdx = chosenPlan.lines
      .map((l, i) => (l.cashPrice > 0 ? i : -1))
      .filter((i) => i >= 0);
    const cashTotal = cashLineIdx.reduce((sum, i) => sum + chosenPlan.lines[i].cashPrice, 0);
    const pointsAllocAmount: Record<number, number> = {};
    const pointsAllocUsed: Record<number, number> = {};
    let allocatedAmount = 0;
    let allocatedUsed = 0;
    cashLineIdx.forEach((i, k) => {
      const isLast = k === cashLineIdx.length - 1;
      if (isLast) {
        pointsAllocAmount[i] = chosenPlan.pointsDeductAmount - allocatedAmount;
        pointsAllocUsed[i] = chosenPlan.pointsUsed - allocatedUsed;
      } else {
        const amt =
          cashTotal > 0
            ? Math.round((chosenPlan.lines[i].cashPrice / cashTotal) * chosenPlan.pointsDeductAmount)
            : 0;
        pointsAllocAmount[i] = amt;
        pointsAllocUsed[i] = amt * (chosenPlan.pointsUsed / (chosenPlan.pointsDeductAmount || 1));
        allocatedAmount += amt;
        allocatedUsed += pointsAllocUsed[i];
      }
    });

    // 1) 为每个已成功排期的项目创建预约（复用现有 addAppointment），并附带计费快照
    result.schedule.forEach((item, index) => {
      if (!item.employeeId) return; // 未排到人的项目跳过
      const line = chosenPlan.lines[index];
      const pDeduct = pointsAllocAmount[index] ?? 0;
      const pUsed = Math.round(pointsAllocUsed[index] ?? 0);
      const billing: AppointmentBilling | undefined = line
        ? {
            plan: chosenPlan.key,
            membershipDiscount: result.pricing.membershipDiscount,
            listPrice: line.listPrice,
            coveredByPackage: line.coveredByPackage,
            customerPackageId: line.customerPackageId,
            pointsUsed: chosenPlan.key === 'points' ? pUsed : 0,
            pointsDeductAmount: chosenPlan.key === 'points' ? pDeduct : 0,
            finalAmount: Math.max(0, line.cashPrice - (chosenPlan.key === 'points' ? pDeduct : 0)),
          }
        : undefined;
      const appt: Appointment = {
        id: generateId(),
        customerId,
        serviceId: item.serviceId,
        employeeId: item.employeeId,
        startTime: item.startTime,
        endTime: item.endTime,
        duration: Math.round(
          (new Date(item.endTime).getTime() - new Date(item.startTime).getTime()) / 60000
        ),
        status: result.requiresReceptionistConfirm ? 'pending' : 'confirmed',
        source: 'walk_in',
        notes: item.isAdvanced ? '高阶项目·已校验技能匹配' : '',
        reminderSent: false,
        billing,
      };
      dispatch(addAppointment(appt));
    });

    // 抵扣由 store 按预约状态驱动：confirmed/completed 才实际扣减套餐次数/积分，
    // pending（待前台二次确认）先不扣，确认后 updateAppointment 会补扣；取消/爽约自动回退。
    message.success(
      result.requiresReceptionistConfirm
        ? '已创建预约（待前台二次确认，确认后再扣减套餐/积分）'
        : '智能预约已确认'
    );
    setResult(null);
    setServiceIds([]);
  };

  const handleConfirm = () => {
    if (!result) return;
    if (!result.canProceed) {
      message.error('存在阻断项，无法预约，请调整项目/时间');
      return;
    }
    if (result.requiresReceptionistConfirm) {
      Modal.confirm({
        title: '需前台二次确认',
        icon: <WarningOutlined style={{ color: '#faad14' }} />,
        content:
          '该钻石会员近期连续爽约，按规则本次预约需前台二次确认，且不可使用积分抵扣。确认继续？',
        okText: '前台确认预约',
        cancelText: '暂不预约',
        onOk: doConfirm,
      });
      return;
    }
    doConfirm();
  };

  const blockingIssues = result?.issues.filter((i) => i.level === 'block') ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">
            <ThunderboltOutlined style={{ color: '#C9A86C', marginRight: 8 }} />
            智能预约校验
          </h1>
          <p className="page-header-subtitle">
            多项目连续排期、消毒缓冲、技能匹配、套餐拆单与积分/套餐择优，一键校验
          </p>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        {/* 左侧：预约输入 */}
        <Col xs={24} lg={9}>
          <Card className="card-wrapper" title="预约信息" bordered={false}>
            <Form layout="vertical">
              <Form.Item label="选择顾客" required>
                <Select
                  placeholder="搜索并选择顾客"
                  showSearch
                  optionFilterProp="label"
                  value={customerId}
                  onChange={(v) => {
                    setCustomerId(v);
                    setResult(null);
                  }}
                  options={state.customers.map((c) => {
                    const m = state.memberships.find((mm) => mm.customerId === c.id);
                    return {
                      value: c.id,
                      label: `${c.name} - ${c.phone}${m ? ` (${getStatusText(m.level)})` : ''}`,
                    };
                  })}
                />
              </Form.Item>

              <Form.Item
                label={`选择项目（可多选，连续项目自动留 ${STERILIZATION_BUFFER_MINUTES} 分钟消毒缓冲）`}
                required
              >
                <Select
                  mode="multiple"
                  placeholder="按操作顺序选择多个项目"
                  value={serviceIds}
                  onChange={(v) => {
                    setServiceIds(v);
                    setResult(null);
                  }}
                  optionFilterProp="label"
                  options={activeServices.map((s) => ({
                    value: s.id,
                    label: `${s.name} · ${s.category} · ${formatCurrency(s.price)} (${s.duration}分)`,
                  }))}
                />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="日期" required>
                    <DatePicker
                      style={{ width: '100%' }}
                      value={date}
                      onChange={(d) => {
                        if (d) setDate(d);
                        setResult(null);
                      }}
                      disabledDate={(d) => d && d.isBefore(dayjs().startOf('day'))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="开始时间" required>
                    <TimePicker
                      style={{ width: '100%' }}
                      format="HH:mm"
                      minuteStep={15}
                      hideDisabledOptions
                      disabledTime={() => ({
                        disabledHours: () =>
                          Array.from({ length: 24 }, (_, h) => h).filter(
                            (h) => h < BUSINESS_HOURS.start || h >= BUSINESS_HOURS.end
                          ),
                      })}
                      value={time}
                      onChange={(t) => {
                        if (t) setTime(t);
                        setResult(null);
                      }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Button
                type="primary"
                icon={<SafetyCertificateOutlined />}
                block
                onClick={runValidation}
              >
                智能校验
              </Button>
            </Form>
          </Card>
        </Col>

        {/* 右侧：校验结果 */}
        <Col xs={24} lg={15}>
          {!result ? (
            <Card className="card-wrapper" bordered={false}>
              <Empty description="填写预约信息后点击「智能校验」查看排期与方案" />
            </Card>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {/* 校验提示 */}
              <Card className="card-wrapper" title="校验结果" bordered={false}
                extra={
                  result.canProceed ? (
                    <Tag color="green" icon={<CheckCircleOutlined />}>可预约</Tag>
                  ) : (
                    <Tag color="red" icon={<ExclamationCircleOutlined />}>存在阻断项</Tag>
                  )
                }
              >
                {result.issues.length === 0 ? (
                  <Alert type="success" showIcon message="全部校验通过，无风险提示" />
                ) : (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {result.issues.map((issue, i) => (
                      <Alert
                        key={i}
                        type={issueColor[issue.level] as 'error' | 'warning' | 'info'}
                        showIcon
                        icon={issueIcon[issue.level]}
                        message={
                          <span>
                            <Tag color={issue.level === 'block' ? 'red' : issue.level === 'confirm' ? 'orange' : 'blue'}>
                              {issue.level === 'block' ? '阻断' : issue.level === 'confirm' ? '需确认' : '提醒'}
                            </Tag>
                            {issue.message}
                          </span>
                        }
                      />
                    ))}
                  </Space>
                )}
              </Card>

              {/* 排期时间线 */}
              <Card
                className="card-wrapper"
                title="连续项目排期"
                bordered={false}
                extra={<Tag color="blue"><ClockCircleOutlined /> 总时长约 {result.totalDuration} 分钟</Tag>}
              >
                <Timeline
                  items={result.schedule.flatMap((item) => {
                    const nodes = [];
                    if (item.bufferBefore > 0) {
                      nodes.push({
                        color: 'gray',
                        dot: <SafetyCertificateOutlined style={{ fontSize: 14 }} />,
                        children: (
                          <span style={{ color: '#8c8c8c' }}>
                            消毒缓冲 {item.bufferBefore} 分钟
                          </span>
                        ),
                      });
                    }
                    nodes.push({
                      color: item.employeeId ? '#C9A86C' : 'red',
                      children: (
                        <div>
                          <Space>
                            <span style={{ fontWeight: 600 }}>
                              {dayjs(item.startTime).format('HH:mm')}–{dayjs(item.endTime).format('HH:mm')}
                            </span>
                            <span>{item.serviceName}</span>
                            {item.isAdvanced && <Tag color="gold">高阶</Tag>}
                          </Space>
                          <div style={{ fontSize: 13, marginTop: 2 }}>
                            {item.employeeName ? (
                              <span style={{ color: '#52c41a' }}>
                                美容师：{item.employeeName}
                              </span>
                            ) : (
                              <span style={{ color: '#ff4d4f' }}>
                                ⚠ {item.unassignedReason}
                              </span>
                            )}
                          </div>
                        </div>
                      ),
                    });
                    return nodes;
                  })}
                />
              </Card>

              {/* 计价方案（套餐 vs 积分 互斥择优） */}
              <Card
                className="card-wrapper"
                title="计价方案（套餐抵扣与积分抵扣互斥，自动推荐更划算方案）"
                bordered={false}
              >
                <Radio.Group
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {result.pricing.plans.map((plan) => (
                      <Card
                        key={plan.key}
                        size="small"
                        style={{
                          borderColor:
                            plan.key === result.pricing.recommendedKey ? '#C9A86C' : undefined,
                          background: plan.available ? undefined : '#fafafa',
                        }}
                      >
                        <Row align="middle" justify="space-between">
                          <Col>
                            <Radio value={plan.key} disabled={!plan.available && plan.finalCash === 0}>
                              <Space>
                                <span style={{ fontWeight: 600 }}>{plan.label}</span>
                                {plan.key === result.pricing.recommendedKey && (
                                  <Tag color="gold">推荐</Tag>
                                )}
                                {!plan.available && <Tag>不可用</Tag>}
                              </Space>
                            </Radio>
                          </Col>
                          <Col>
                            <Statistic
                              valueStyle={{ fontSize: 20, color: '#C9A86C' }}
                              prefix="¥"
                              value={plan.finalCash}
                            />
                          </Col>
                        </Row>
                        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                          {plan.note}
                        </div>
                      </Card>
                    ))}
                  </Space>
                </Radio.Group>

                {chosenPlan && (
                  <>
                    <Divider style={{ margin: '16px 0' }} />
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="会员折扣">
                        {result.pricing.membershipDiscount === 1
                          ? '无折扣'
                          : `${(result.pricing.membershipDiscount * 10).toFixed(1)} 折`}
                      </Descriptions.Item>
                      {chosenPlan.lines.map((line) => (
                        <Descriptions.Item key={line.serviceId} label={line.serviceName}>
                          {line.coveredByPackage ? (
                            <Tag color="green">套餐抵扣（免现金）</Tag>
                          ) : (
                            <span>
                              单次价 {formatCurrency(line.listPrice)} → 应付{' '}
                              {formatCurrency(line.cashPrice)}
                            </span>
                          )}
                        </Descriptions.Item>
                      ))}
                      {chosenPlan.pointsDeductAmount > 0 && (
                        <Descriptions.Item label="积分抵扣">
                          -{formatCurrency(chosenPlan.pointsDeductAmount)}（用 {chosenPlan.pointsUsed} 积分）
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="应付合计">
                        <span style={{ fontSize: 18, fontWeight: 700, color: '#C9A86C' }}>
                          {formatCurrency(chosenPlan.finalCash)}
                        </span>
                      </Descriptions.Item>
                    </Descriptions>
                  </>
                )}
              </Card>

              <Button
                type="primary"
                size="large"
                block
                disabled={!result.canProceed}
                icon={<CheckCircleOutlined />}
                onClick={handleConfirm}
              >
                {blockingIssues.length > 0
                  ? '存在阻断项，无法预约'
                  : result.requiresReceptionistConfirm
                  ? '前台二次确认并预约'
                  : '确认预约'}
              </Button>
            </Space>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default SmartBooking;
