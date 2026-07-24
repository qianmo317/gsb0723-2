import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Modal,
  Form,
  Select,
  DatePicker,
  TimePicker,
  Button,
  Space,
  Row,
  Col,
  Tag,
  Alert,
  List,
  Card,
  Input,
  Checkbox,
  Divider,
  Tooltip,
  Empty,
  message,
  Typography
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  UserOutlined,
  TagOutlined,
  StarOutlined,
  ClockCircleTwoTone
} from '@ant-design/icons';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../store';
import {
  addAppointment,
  addWaitList,
  consumePackageSession,
  deductPoints
} from '../store';
import type { BookingServiceItem, Appointment, WaitList } from '../types';
import {
  validateBooking,
  isHighTierService,
  BUFFER_MINUTES,
  MEMBER_DISCOUNTS,
  type ValidationState
} from '../utils/appointmentValidation';
import { formatCurrency, generateId, getStatusText } from '../utils/format';
import dayjs from 'dayjs';

const { Text, Title } = Typography;

interface SmartBookingModalProps {
  open: boolean;
  onClose: () => void;
  initialDate?: Date;
}

interface FormValues {
  customerId?: string;
  date?: dayjs.Dayjs;
  time?: dayjs.Dayjs;
  source?: 'phone' | 'wechat' | 'walk_in' | 'online';
  notes?: string;
}

const SmartBookingModal: React.FC<SmartBookingModalProps> = ({ open, onClose, initialDate }) => {
  const dispatch = useDispatch();
  const state = useSelector((s: RootState) => s.app);
  const [form] = Form.useForm<FormValues>();

  const [bookingItems, setBookingItems] = useState<BookingServiceItem[]>([{ serviceId: '' }]);
  const [usePoints, setUsePoints] = useState(false);
  const [doubleConfirmChecked, setDoubleConfirmChecked] = useState(false);

  const customerId = Form.useWatch('customerId', form);
  const dateValue = Form.useWatch('date', form);
  const timeValue = Form.useWatch('time', form);

  const validationState: ValidationState = useMemo(() => ({
    customers: state.customers,
    skinAnalyses: state.skinAnalyses,
    allergies: state.allergies,
    memberships: state.memberships,
    services: state.services,
    packages: state.packages,
    packageItems: state.packageItems,
    employees: state.employees,
    appointments: state.appointments,
    serviceRecords: state.serviceRecords,
    schedules: state.schedules,
    customerPackages: state.customerPackages
  }), [state]);

  const baseStartTime = useMemo(() => {
    if (!dateValue || !timeValue) return null;
    return dayjs(dateValue)
      .hour(timeValue.hour())
      .minute(timeValue.minute())
      .toDate();
  }, [dateValue, timeValue]);

  const validItems = bookingItems.filter(i => i.serviceId);

  const validation = useMemo(() => {
    if (!customerId || !baseStartTime || validItems.length === 0) return null;
    return validateBooking(validationState, customerId, validItems, baseStartTime, usePoints);
  }, [customerId, baseStartTime, validItems, validationState, usePoints]);

  const allAroundBeauticianId = useMemo(() => {
    if (!validation) return null;
    return validation.suggestedEmployees.find(s => s.coversAllItems)?.employeeId ?? null;
  }, [validation]);

  useEffect(() => {
    if (!allAroundBeauticianId) return;
    setBookingItems(prev => {
      let changed = false;
      const updated = prev.map(item => {
        if (item.serviceId && !item.employeeId) {
          changed = true;
          return { ...item, employeeId: allAroundBeauticianId };
        }
        return item;
      });
      return changed ? updated : prev;
    });
  }, [allAroundBeauticianId]);

  const membership = useMemo(() =>
    state.memberships.find(m => m.customerId === customerId),
    [state.memberships, customerId]
  );

  const customer = useMemo(() =>
    state.customers.find(c => c.id === customerId),
    [state.customers, customerId]
  );

  const handleAddItem = () => {
    setBookingItems([...bookingItems, { serviceId: '' }]);
  };

  const handleRemoveItem = (index: number) => {
    if (bookingItems.length <= 1) return;
    setBookingItems(bookingItems.filter((_, i) => i !== index));
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const updated = [...bookingItems];
    updated[index] = { ...updated[index], serviceId, employeeId: undefined };
    setBookingItems(updated);
  };

  const handleEmployeeChange = (index: number, employeeId: string) => {
    const updated = [...bookingItems];
    updated[index] = { ...updated[index], employeeId };
    setBookingItems(updated);
  };

  const getEligibleEmployees = useCallback((index: number) => {
    const item = bookingItems[index];
    if (!item.serviceId) return [];
    const service = state.services.find(s => s.id === item.serviceId);
    if (!service) return [];

    return state.employees.filter(e => {
      if (e.role !== 'beautician' && e.role !== 'technician') return false;
      if (e.status !== 'active') return false;
      if (!e.skills.includes(service.id)) return false;
      return true;
    });
  }, [bookingItems, state.services, state.employees]);

  const handleClose = () => {
    setBookingItems([{ serviceId: '' }]);
    setUsePoints(false);
    setDoubleConfirmChecked(false);
    form.resetFields();
    onClose();
  };

  const handleSubmit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }

    if (!customerId || !baseStartTime) {
      message.error('请完善预约信息');
      return;
    }

    if (validItems.length === 0) {
      message.error('请至少选择一个项目');
      return;
    }

    if (validation && !validation.valid) {
      message.error('请先修正预约中的错误');
      return;
    }

    if (validation?.requiresDoubleConfirm && !doubleConfirmChecked) {
      message.warning('该顾客需要前台二次确认，请勾选确认框');
      return;
    }

    if (!validation) {
      message.error('校验未完成，请检查填写');
      return;
    }

    const values = form.getFieldsValue();

    validation.scheduledItems.forEach((scheduled, idx) => {
      const item = validItems[idx];
      if (!item) return;

      const appointment: Appointment = {
        id: generateId(),
        customerId,
        serviceId: scheduled.serviceId,
        employeeId: scheduled.employeeId,
        startTime: scheduled.startTime,
        endTime: scheduled.endTime,
        duration: scheduled.duration,
        status: validation.requiresDoubleConfirm ? 'pending' : 'confirmed',
        source: values.source || 'wechat',
        notes: values.notes || '',
        reminderSent: false
      };
      dispatch(addAppointment(appointment));
    });

    validation.pricing.forEach(p => {
      if (p.usedDiscountType === 'package' && p.customerPackageId) {
        dispatch(consumePackageSession({ customerPackageId: p.customerPackageId, serviceId: p.serviceId }));
      }
    });

    const totalPointsDeduction = validation.pricing.reduce((sum, p) => sum + p.pointsDeduction, 0);
    if (totalPointsDeduction > 0) {
      dispatch(deductPoints({ customerId, points: totalPointsDeduction }));
    }

    message.success(
      validation.requiresDoubleConfirm
        ? '预约已创建，待前台二次确认'
        : `预约成功！共${validation.scheduledItems.length}个项目，合计${formatCurrency(validation.totalPrice)}`
    );
    handleClose();
  };

  const handleJoinWaitlist = () => {
    if (!customerId || !baseStartTime || !validation) {
      message.error('请完善预约信息');
      return;
    }

    const preferredDate = dateValue ? dateValue.format('YYYY-MM-DD') : '';

    validation.conflictItemIndexes.forEach(idx => {
      const scheduled = validation.scheduledItems[idx];
      if (!scheduled) return;

      const waitEntry: WaitList = {
        id: generateId(),
        customerId,
        serviceId: scheduled.serviceId,
        preferredDate,
        addedAt: new Date().toISOString(),
        status: 'waiting'
      };
      dispatch(addWaitList(waitEntry));
    });

    message.success(
      `已将${validation.conflictItemIndexes.length}个冲突项目加入候补队列，有空档时将通知顾客`
    );
    handleClose();
  };

  const renderIssueIcon = (severity: string) => {
    switch (severity) {
      case 'error': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'warning': return <WarningOutlined style={{ color: '#faad14' }} />;
      default: return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
    }
  };

  return (
    <Modal
      title={
        <Space>
          <StarOutlined style={{ color: '#C9A86C' }} />
          <span>智能预约</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      okText="确认预约"
      cancelText="取消"
      width={780}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={handleClose}>
          取消
        </Button>,
        validation?.canWaitlist && (
          <Button
            key="waitlist"
            icon={<ClockCircleOutlined />}
            onClick={handleJoinWaitlist}
            danger={validation.requiresDoubleConfirm}
          >
            加入候补队列
          </Button>
        ),
        <Button
          key="submit"
          type="primary"
          onClick={handleSubmit}
          disabled={!validation?.valid}
          danger={validation?.requiresDoubleConfirm}
        >
          确认预约
        </Button>
      ].filter(Boolean)}
    >
      <Form form={form} layout="vertical" initialValues={{ source: 'wechat' }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="customerId"
              label="选择顾客"
              rules={[{ required: true, message: '请选择顾客' }]}
            >
              <Select
                placeholder="搜索并选择顾客"
                showSearch
                optionFilterProp="label"
                options={state.customers.map(c => ({
                  value: c.id,
                  label: `${c.name} - ${c.phone}`
                }))}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              name="date"
              label="日期"
              rules={[{ required: true, message: '请选择日期' }]}
              initialValue={initialDate ? dayjs(initialDate) : undefined}
            >
              <DatePicker
                style={{ width: '100%' }}
                disabledDate={d => d ? d.isBefore(dayjs().startOf('day')) : false}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              name="time"
              label="开始时间"
              rules={[{ required: true, message: '请选择时间' }]}
            >
              <TimePicker
                style={{ width: '100%' }}
                format="HH:mm"
                minuteStep={15}
                disabledHours={() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 21, 22, 23]}
              />
            </Form.Item>
          </Col>
        </Row>

        {customer && membership && (
          <Card size="small" style={{ marginBottom: 16, background: '#FAFAFA' }}>
            <Row gutter={16} align="middle">
              <Col>
                <Space>
                  <UserOutlined />
                  <span style={{ fontWeight: 500 }}>{customer.name}</span>
                  <span className={`membership-badge ${membership.level}`}>
                    {getStatusText(membership.level)}
                  </span>
                </Space>
              </Col>
              <Col>
                <Text type="secondary">肤质: {customer.skinType}</Text>
              </Col>
              <Col>
                <Text type="secondary">
                  积分: <Text strong style={{ color: '#C9A86C' }}>{membership.points}</Text>
                </Text>
              </Col>
              <Col>
                <Text type="secondary">
                  折扣: <Text strong>{Math.round((1 - MEMBER_DISCOUNTS[membership.level]) * 100)}%</Text>
                </Text>
              </Col>
            </Row>
          </Card>
        )}

        <Divider orientation="left" style={{ fontSize: 14 }}>预约项目</Divider>

        {bookingItems.map((item, index) => {
          const service = state.services.find(s => s.id === item.serviceId);
          const isHighTier = service ? isHighTierService(service) : false;
          const eligibleEmployees = getEligibleEmployees(index);
          const scheduled = validation?.scheduledItems[index];
          const pricing = validation?.pricing[index];
          const hasConflict = validation?.conflictItemIndexes.includes(index) ?? false;
          const missingEmployee = !!item.serviceId && !item.employeeId;

          return (
            <Card
              key={index}
              size="small"
              style={{
                marginBottom: 12,
                borderColor: hasConflict ? '#ff4d4f' : pricing?.splitFromPackage ? '#faad14' : undefined,
                background: hasConflict ? '#fff2f0' : undefined
              }}
              title={
                <Space>
                  <Tag color="blue">#{index + 1}</Tag>
                  {isHighTier && <Tag color="red">高阶项目</Tag>}
                  {hasConflict && <Tag color="error" icon={<ClockCircleTwoTone twoToneColor="#ff4d4f" />}>时间冲突</Tag>}
                  {service && <span>{service.name}</span>}
                  {scheduled && (
                    <Tooltip title="含消毒缓冲时间">
                      <Tag icon={<ClockCircleOutlined />} color="default">
                        {dayjs(scheduled.startTime).format('HH:mm')} - {dayjs(scheduled.endTime).format('HH:mm')}
                        {scheduled.bufferAfter > 0 && ` +${scheduled.bufferAfter}min`}
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
              }
              extra={
                bookingItems.length > 1 && (
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemoveItem(index)}
                  />
                )
              }
            >
              <Row gutter={12}>
                <Col span={10}>
                  <Select
                    placeholder="选择项目"
                    style={{ width: '100%' }}
                    value={item.serviceId || undefined}
                    onChange={v => handleServiceChange(index, v)}
                    showSearch
                    optionFilterProp="label"
                    options={state.services.map(s => ({
                      value: s.id,
                      label: `${s.name} - ${formatCurrency(s.price)} (${s.duration}分钟)${isHighTierService(s) ? ' ⭐' : ''}`
                    }))}
                  />
                </Col>
                <Col span={10}>
                  <div style={{ fontSize: 12, color: missingEmployee ? '#ff4d4f' : 'rgba(0,0,0,0.45)', marginBottom: 4 }}>
                    <span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>美容师
                    {missingEmployee && <span style={{ marginLeft: 4 }}>必选</span>}
                  </div>
                  <Select
                    placeholder="选择美容师"
                    style={{ width: '100%' }}
                    status={missingEmployee ? 'error' : undefined}
                    value={item.employeeId || undefined}
                    onChange={v => handleEmployeeChange(index, v)}
                    disabled={!item.serviceId}
                    options={eligibleEmployees.map(e => {
                      const isPreferred = validation?.suggestedEmployees.some(
                        s => s.employeeId === e.id && (s.reason === 'preferred' || s.coversAllItems)
                      );
                      const isSuggested = validation?.suggestedEmployees.some(
                        s => s.employeeId === e.id
                      );
                      return {
                        value: e.id,
                        label: `${isPreferred ? '⭐ ' : ''}${e.name} - ${getStatusText(e.role)}${isSuggested ? ' (推荐)' : ''}`
                      };
                    })}
                  />
                </Col>
                <Col span={4}>
                  {service && (
                    <div style={{ textAlign: 'right' }}>
                      {pricing ? (
                        <div>
                          {pricing.originalPrice !== pricing.finalPrice && (
                            <Text delete type="secondary" style={{ fontSize: 12 }}>
                              {formatCurrency(pricing.originalPrice)}
                            </Text>
                          )}
                          <div>
                            <Text strong style={{ color: '#C9A86C', fontSize: 16 }}>
                              {formatCurrency(pricing.finalPrice)}
                            </Text>
                          </div>
                          {pricing.usedDiscountType !== 'none' && (
                            <Tag color={pricing.usedDiscountType === 'package' ? 'gold' : 'green'} style={{ fontSize: 10 }}>
                              {pricing.usedDiscountType === 'package' ? '套餐' : '积分'}
                              省¥{pricing.usedDiscountType === 'package' ? pricing.packageDeduction : pricing.pointsDeduction}
                            </Tag>
                          )}
                        </div>
                      ) : (
                        <Text strong>{formatCurrency(service.price)}</Text>
                      )}
                    </div>
                  )}
                </Col>
              </Row>
              {pricing?.splitFromPackage && (
                <Alert
                  style={{ marginTop: 8 }}
                  type="warning"
                  showIcon
                  message={
                    pricing.splitReason === 'expired'
                      ? '套餐已过期，该项目已按单次价结算'
                      : pricing.splitReason === 'insufficient_sessions'
                        ? '套餐剩余次数不足，超出部分已按单次价结算'
                        : '套餐不可用，该项目已按单次价结算'
                  }
                />
              )}
            </Card>
          );
        })}

        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={handleAddItem}
          style={{ marginBottom: 16 }}
        >
          添加项目（自动安排{BUFFER_MINUTES}分钟缓冲）
        </Button>

        {validation && (
          <>
            {(validation.errors.length > 0 || validation.warnings.length > 0 || validation.infos.length > 0) && (
              <Card size="small" title="校验结果" style={{ marginBottom: 16 }}>
                <List
                  size="small"
                  dataSource={[
                    ...validation.errors,
                    ...validation.warnings,
                    ...validation.infos
                  ]}
                  renderItem={issue => (
                    <List.Item style={{ padding: '4px 0', border: 'none' }}>
                      <Space>
                        {renderIssueIcon(issue.severity)}
                        <Text
                          type={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'secondary'}
                          style={{ fontSize: 13 }}
                        >
                          {issue.message}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            )}

            {validation.suggestedEmployees.length > 0 && (
              <Card size="small" title={<Space><TagOutlined />推荐美容师</Space>} style={{ marginBottom: 16 }}>
                <Space wrap>
                  {validation.suggestedEmployees.slice(0, 5).map(s => (
                    <Tag
                      key={s.employeeId}
                      color={s.coversAllItems ? 'gold' : s.reason === 'preferred' ? 'blue' : s.reason === 'skill_match' ? 'geekblue' : 'default'}
                      icon={s.coversAllItems || s.reason === 'preferred' ? <StarOutlined /> : <CheckCircleOutlined />}
                      style={s.coversAllItems ? { fontWeight: 600, borderColor: '#C9A86C' } : undefined}
                    >
                      {s.employeeName}
                      {s.coversAllItems && ' ⭐ 全程跟进'}
                      {!s.coversAllItems && s.reason === 'preferred' && ' (常约)'}
                    </Tag>
                  ))}
                </Space>
              </Card>
            )}

            <Card size="small" style={{ marginBottom: 16, background: '#FAFAFA' }}>
              <Row gutter={16} align="middle">
                <Col flex="auto">
                  <Space direction="vertical" size={4}>
                    <Space>
                      <Checkbox
                        checked={usePoints}
                        onChange={e => setUsePoints(e.target.checked)}
                        disabled={validation.pointsBlocked || !membership || membership.points <= 0}
                      >
                        使用积分抵扣
                      </Checkbox>
                      {membership && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          可用: {membership.points}积分
                          {validation.pointsBlocked && (
                            <Tag color="red" style={{ marginLeft: 8 }}>积分已锁定</Tag>
                          )}
                        </Text>
                      )}
                    </Space>
                    {validation.totalSavings > 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        已自动为您选择最优惠方案
                      </Text>
                    )}
                  </Space>
                </Col>
                <Col>
                  <div style={{ textAlign: 'right' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>原价合计</Text>
                    <br />
                    <Text delete type="secondary">{formatCurrency(validation.totalOriginalPrice)}</Text>
                  </div>
                </Col>
                <Col>
                  <div style={{ textAlign: 'right' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>优惠</Text>
                    <br />
                    <Text type="success">-{formatCurrency(validation.totalSavings)}</Text>
                  </div>
                </Col>
                <Col>
                  <div style={{ textAlign: 'right' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>应付</Text>
                    <br />
                    <Title level={4} style={{ margin: 0, color: '#C9A86C' }}>
                      {formatCurrency(validation.totalPrice)}
                    </Title>
                  </div>
                </Col>
              </Row>
            </Card>

            {validation.requiresDoubleConfirm && (
              <Alert
                type="error"
                showIcon
                icon={<WarningOutlined />}
                style={{ marginBottom: 16 }}
                message="需要前台二次确认"
                description={
                  <div>
                    <p style={{ marginBottom: 8 }}>
                      {validation.doubleConfirmReason}。根据规则，钻石会员连续爽约2次后：
                    </p>
                    <ul style={{ marginBottom: 8, paddingLeft: 20 }}>
                      <li>本次预约状态为"待确认"，需前台人工确认</li>
                      <li>本次不可使用积分抵扣</li>
                    </ul>
                    <Checkbox
                      checked={doubleConfirmChecked}
                      onChange={e => setDoubleConfirmChecked(e.target.checked)}
                    >
                      我已了解风险并确认提交预约
                    </Checkbox>
                  </div>
                }
              />
            )}
          </>
        )}

        {!validation && customerId && (
          <Empty description="请选择项目和时间以查看校验结果" style={{ margin: '24px 0' }} />
        )}

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="source" label="预约来源">
              <Select
                options={[
                  { value: 'phone', label: '电话' },
                  { value: 'wechat', label: '微信' },
                  { value: 'walk_in', label: '到店' },
                  { value: 'online', label: '线上' }
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} placeholder="请输入备注信息" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SmartBookingModal;
