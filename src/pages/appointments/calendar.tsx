import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  Card,
  Tag,
  Button,
  Space,
  Modal,
  Form,
  Select,
  DatePicker,
  TimePicker,
  message,
  List,
  Avatar,
  Input,
  Alert,
  Divider,
  Typography,
  Badge,
  Collapse
} from 'antd';
import {
  PlusOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  UserOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone
} from '@ant-design/icons';
import Calendar from 'react-calendar';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { updateAppointment, deleteAppointment, addMultipleAppointments, updateMembershipPoints, consumePackageCount } from '../../store';
import type { Appointment } from '../../types';
import { formatDate, formatTime, formatCurrency, getStatusText, getStatusColor } from '../../utils/format';
import { validateSmartAppointment } from '../../utils/smartAppointmentValidator';
import type { SmartValidationResult } from '../../types';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const { Panel } = Collapse;

const AppointmentCalendar: React.FC = () => {
  const dispatch = useDispatch();
  const state = useSelector((state: RootState) => state.app);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [validationResult, setValidationResult] = useState<SmartValidationResult | null>(null);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [preferredEmployeeId, setPreferredEmployeeId] = useState<string | undefined>();

  const selectedDateStr = dayjs(selectedDate).format('YYYY-MM-DD');

  const dayAppointments = state.appointments
    .filter((a) => a.startTime.split('T')[0] === selectedDateStr)
    .sort((a, b) => {
      const groupA = a.multiServiceGroupId || a.id;
      const groupB = b.multiServiceGroupId || b.id;
      if (groupA !== groupB) {
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      }
      return (a.multiServiceIndex || 0) - (b.multiServiceIndex || 0);
    });

  const groupIds = new Set<string>();
  let appointmentCount = 0;
  dayAppointments.forEach(a => {
    if (a.isMultiService && a.multiServiceGroupId) {
      if (!groupIds.has(a.multiServiceGroupId)) {
        groupIds.add(a.multiServiceGroupId);
        appointmentCount++;
      }
    } else {
      appointmentCount++;
    }
  });

  const waitListItems = state.waitList.filter((w) => w.status === 'waiting');

  const getTileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null;
    const dateStr = dayjs(date).format('YYYY-MM-DD');
    const uniqueGroups = new Set<string>();
    state.appointments.forEach(a => {
      if (a.startTime.split('T')[0] === dateStr) {
        uniqueGroups.add(a.multiServiceGroupId || a.id);
      }
    });
    const count = uniqueGroups.size;
    if (count > 0) {
      return (
        <div className="react-calendar__tile-dots">
          {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
            <div key={i} className="react-calendar__tile-dot" />
          ))}
        </div>
      );
    }
    return null;
  };

  const handleAdd = () => {
    form.resetFields();
    form.setFieldsValue({
      date: dayjs(selectedDate),
      source: 'wechat',
      services: []
    });
    setSelectedServices([]);
    setPreferredEmployeeId(undefined);
    setValidationResult(null);
    setIsModalOpen(true);
  };

  const runValidation = () => {
    const values = form.getFieldsValue();
    if (!values.customerId || !values.services || values.services.length === 0 || !values.date || !values.time) {
      return;
    }

    const result = validateSmartAppointment(state, {
      customerId: values.customerId,
      services: values.services.map((serviceId: string) => ({
        serviceId,
        preferredEmployeeId
      })),
      date: values.date.format('YYYY-MM-DD'),
      startTime: values.time.format('HH:mm'),
      source: values.source || 'wechat',
      notes: values.notes
    });

    setValidationResult(result);
  };

  useEffect(() => {
    if (isModalOpen) {
      const timer = setTimeout(() => {
        runValidation();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [form.getFieldsValue(), preferredEmployeeId, isModalOpen]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (!validationResult || !validationResult.valid) {
        message.error('请先修正校验错误');
        return;
      }

      if (validationResult.needsReceptionConfirm) {
        Modal.confirm({
          title: '需要前台二次确认',
          content: '该钻石会员近30天有多次爽约记录，确认提交预约吗？提交后需前台人工确认。',
          okText: '确认提交',
          cancelText: '取消',
          onOk: () => {
            submitAppointments();
          }
        });
      } else {
        submitAppointments();
      }
    } catch {
      // validation error
    }
  };

  const submitAppointments = () => {
    if (!validationResult?.suggestedAppointments || validationResult.suggestedAppointments.length === 0) return;

    dispatch(addMultipleAppointments(validationResult.suggestedAppointments));

    const firstAppt = validationResult.suggestedAppointments[0];
    const customerId = firstAppt.customerId;

    validationResult.suggestedAppointments.forEach(appt => {
      if (appt.priceItems) {
        appt.priceItems.forEach(pi => {
          if (pi.appliedDiscount === 'package' && pi.packageId) {
            dispatch(consumePackageCount({
              customerPackageId: pi.packageId,
              serviceId: pi.serviceId,
              count: 1
            }));
          }
          if (pi.appliedDiscount === 'points' && pi.pointsUsed > 0) {
            dispatch(updateMembershipPoints({
              customerId,
              pointsDelta: -pi.pointsUsed
            }));
          }
        });
      }
    });

    message.success(validationResult.needsReceptionConfirm ? '预约已提交，等待前台确认' : '智能预约创建成功');
    setIsModalOpen(false);
    setValidationResult(null);
  };

  const handleGroupStatusChange = (groupId: string, newStatus: string) => {
    const groupAppts = state.appointments.filter(a => a.multiServiceGroupId === groupId);
    if (groupAppts.length > 0) {
      groupAppts.forEach(appt => {
        dispatch(updateAppointment({ ...appt, status: newStatus as Appointment['status'] }));
      });
    } else {
      const appt = state.appointments.find(a => a.id === groupId);
      if (appt) {
        dispatch(updateAppointment({ ...appt, status: newStatus as Appointment['status'] }));
      }
    }
    message.success('状态更新成功');
  };

  const handleGroupDelete = (groupId: string) => {
    Modal.confirm({
      title: '确认取消',
      content: '确定要取消该预约吗？',
      onOk: () => {
        const groupAppts = state.appointments.filter(a => a.multiServiceGroupId === groupId);
        if (groupAppts.length > 0) {
          groupAppts.forEach(appt => dispatch(deleteAppointment(appt.id)));
        } else {
          dispatch(deleteAppointment(groupId));
        }
        message.success('预约已取消');
      },
    });
  };

  const getWarningIcon = (level: string) => {
    switch (level) {
      case 'error':
      case 'critical':
        return <CloseCircleTwoTone twoToneColor="#ff4d4f" />;
      case 'warning':
        return <WarningOutlined style={{ color: '#faad14' }} />;
      default:
        return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
    }
  };

  const membership = form.getFieldValue('customerId')
    ? state.memberships.find(m => m.customerId === form.getFieldValue('customerId'))
    : null;

  const selectedCustomer = form.getFieldValue('customerId')
    ? state.customers.find(c => c.id === form.getFieldValue('customerId'))
    : null;

  const beauticians = state.employees.filter(e =>
    (e.role === 'beautician' || e.role === 'technician') &&
    e.status === 'active'
  );

  const processedGroups = new Set<string>();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">智能预约排期</h1>
          <p className="page-header-subtitle">
            {formatDate(selectedDate)} 预约管理
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          智能新增预约
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card className="card-wrapper" title="预约日历" bordered={false}>
            <Calendar
              value={selectedDate}
              onChange={(date) => setSelectedDate(date as Date)}
              tileContent={getTileContent}
              formatDay={(locale, date) => dayjs(date).format('D')}
            />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card
            className="card-wrapper"
            title={`${formatDate(selectedDate)} 预约详情`}
            bordered={false}
            extra={
              <Tag color="blue">{appointmentCount} 组预约</Tag>
            }
          >
            {dayAppointments.length > 0 ? (
              dayAppointments.map((appointment) => {
                const customer = state.customers.find((c) => c.id === appointment.customerId);
                const service = state.services.find((s) => s.id === appointment.serviceId);
                const employee = state.employees.find((e) => e.id === appointment.employeeId);
                const price = appointment.priceItems?.[0]?.finalPrice || appointment.totalFinalPrice;

                const isMulti = !!appointment.isMultiService && !!appointment.multiServiceGroupId;
                const groupId = appointment.multiServiceGroupId || appointment.id;
                const isFirstInGroup = !isMulti || appointment.multiServiceIndex === 0;
                const groupProcessed = processedGroups.has(groupId);

                if (isFirstInGroup && isMulti) {
                  processedGroups.add(groupId);
                }

                if (isMulti && !isFirstInGroup) {
                  return (
                    <div
                      key={appointment.id}
                      className={`appointment-slot ${appointment.status}`}
                      style={{ marginLeft: 36, padding: '8px 16px', borderLeft: '3px solid #C9A86C' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space>
                          <ClockCircleOutlined style={{ color: '#C9A86C', fontSize: 12 }} />
                          <span style={{ color: '#C9A86C', fontWeight: 600, fontSize: 12 }}>
                            +{BUFFER_TIME_MINUTES}分缓冲 → {formatTime(appointment.startTime)}
                          </span>
                          <span>{service?.name}</span>
                          {employee && <Tag>{employee.name}</Tag>}
                          {price !== undefined && (
                            <span style={{ color: '#C9A86C' }}>{formatCurrency(price)}</span>
                          )}
                        </Space>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={appointment.id}
                    className={`appointment-slot ${appointment.status}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <Space>
                          {isFirstInGroup && <Avatar size={32} src={customer?.avatar} icon={<UserOutlined />} />}
                          <div>
                            <div style={{ fontWeight: 500 }}>
                              {isFirstInGroup ? customer?.name : ''}
                              {appointment.needsReceptionConfirm && isFirstInGroup && (
                                <Tag color="orange" style={{ marginLeft: 8 }}>待确认</Tag>
                              )}
                              {appointment.isMultiService && isFirstInGroup && (
                                <Tag color="purple" style={{ marginLeft: 4 }}>多项目</Tag>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                              {service?.name} · {employee?.name}
                              {price !== undefined && (
                                <span style={{ color: '#C9A86C', marginLeft: 8 }}>
                                  {formatCurrency(price)}
                                </span>
                              )}
                            </div>
                          </div>
                        </Space>
                      </div>
                      <Space direction="vertical" align="end" size={4}>
                        <Space>
                          <ClockCircleOutlined style={{ color: '#C9A86C' }} />
                          <span style={{ fontWeight: 600, color: '#C9A86C' }}>
                            {formatTime(appointment.startTime)}
                          </span>
                        </Space>
                        {isFirstInGroup && (
                          <Tag color={getStatusColor(appointment.status)}>
                            {getStatusText(appointment.status)}
                          </Tag>
                        )}
                      </Space>
                    </div>
                    {isFirstInGroup && appointment.healthWarnings && appointment.healthWarnings.length > 0 && (
                      <Alert
                        message="健康提醒"
                        description={appointment.healthWarnings.map((w: string, i: number) => (
                          <div key={i} style={{ fontSize: 12 }}>{w}</div>
                        ))}
                        type="warning"
                        showIcon
                        style={{ marginTop: 8, padding: '8px 12px' }}
                      />
                    )}
                    {isFirstInGroup && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        {appointment.status === 'confirmed' && (
                          <Space>
                            <Button
                              type="link"
                              size="small"
                              onClick={() => handleGroupStatusChange(groupId, 'completed')}
                            >
                              <CheckCircleOutlined /> 完成
                            </Button>
                            <Button
                              type="link"
                              size="small"
                              danger
                              onClick={() => handleGroupDelete(groupId)}
                            >
                              <DeleteOutlined /> 取消
                            </Button>
                          </Space>
                        )}
                        {appointment.status === 'pending' && (
                          <Space>
                            <Button
                              type="link"
                              size="small"
                              onClick={() => handleGroupStatusChange(groupId, 'confirmed')}
                            >
                              <CheckCircleOutlined /> 确认
                            </Button>
                            <Button
                              type="link"
                              size="small"
                              danger
                              onClick={() => handleGroupDelete(groupId)}
                            >
                              <DeleteOutlined /> 拒绝
                            </Button>
                          </Space>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="empty-state">
                <CalendarOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
                <div style={{ marginTop: 16 }}>当日暂无预约</div>
              </div>
            )}
          </Card>

          {waitListItems.length > 0 && (
            <Card
              className="card-wrapper"
              title="候补队列"
              bordered={false}
              style={{ marginTop: 16 }}
            >
              <List
                size="small"
                dataSource={waitListItems}
                renderItem={(item) => {
                  const customer = state.customers.find((c) => c.id === item.customerId);
                  const service = state.services.find((s) => s.id === item.serviceId);
                  return (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Avatar size={32} src={customer?.avatar} />}
                        title={customer?.name}
                        description={`${service?.name} · ${formatDate(item.preferredDate)}`}
                      />
                      <Tag color="orange">候补中</Tag>
                    </List.Item>
                  );
                }}
              />
            </Card>
          )}
        </Col>
      </Row>

      <Modal
        title="智能新增预约"
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setIsModalOpen(false);
          setValidationResult(null);
        }}
        okText="确认预约"
        cancelText="取消"
        width={720}
        okButtonProps={{ disabled: !validationResult?.valid }}
      >
        <Form form={form} layout="vertical" onValuesChange={() => setValidationResult(null)}>
          <Form.Item
            name="customerId"
            label="选择顾客"
            rules={[{ required: true, message: '请选择顾客' }]}
          >
            <Select
              placeholder="搜索并选择顾客"
              showSearch
              optionFilterProp="label"
              options={state.customers.map((c) => {
                const m = state.memberships.find(mem => mem.customerId === c.id);
                return {
                  value: c.id,
                  label: `${c.name} - ${c.phone}${m ? ` (${getStatusText(m.level)})` : ''}`,
                };
              })}
              onChange={() => {
                setValidationResult(null);
                setPreferredEmployeeId(undefined);
                setTimeout(runValidation, 100);
              }}
            />
          </Form.Item>

          {membership && selectedCustomer && (
            <Alert
              message={
                <Space>
                  <span>会员等级: {getStatusText(membership.level)}</span>
                  <span>|</span>
                  <span>积分余额: {membership.points}</span>
                  <span>|</span>
                  <span>肤质: {selectedCustomer.skinType}</span>
                </Space>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Form.Item
            name="services"
            label="选择项目（可多选连续项目，系统自动安排消毒缓冲）"
            rules={[{ required: true, message: '请选择至少一个项目' }]}
          >
            <Select
              mode="multiple"
              placeholder="请选择项目"
              options={state.services.filter(s => s.status === 'active').map((s) => ({
                value: s.id,
                label: `${s.name} - ${formatCurrency(s.price)} (${s.duration}分钟)${s.isAdvanced ? ' ⭐高阶' : ''}`,
              }))}
              onChange={(values) => {
                setSelectedServices(values);
                setValidationResult(null);
                setTimeout(runValidation, 100);
              }}
            />
          </Form.Item>

          {selectedServices.length > 0 && (
            <Form.Item label="指定美容师（可选，不选则系统智能推荐）">
              <Select
                allowClear
                placeholder="选择指定美容师，或留空由系统推荐"
                value={preferredEmployeeId}
                onChange={(val) => {
                  setPreferredEmployeeId(val);
                  setValidationResult(null);
                  setTimeout(runValidation, 100);
                }}
                options={beauticians.map(e => ({
                  value: e.id,
                  label: `${e.name} (${e.role === 'technician' ? '高级技师' : '美容师'}) - 技能: ${e.skills.length}项`
                }))}
              />
            </Form.Item>
          )}

          {selectedServices.length > 0 && validationResult?.timeSlot && (
            <Alert
              message={`时间安排: 共${validationResult.timeSlot.totalDuration}分钟服务 + ${validationResult.timeSlot.totalBufferTime}分钟消毒缓冲`}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="date"
                label="选择日期"
                rules={[{ required: true, message: '请选择日期' }]}
              >
                <DatePicker
                  style={{ width: '100%' }}
                  disabledDate={(d) => d && d.isBefore(dayjs().startOf('day'))}
                  onChange={() => {
                    setValidationResult(null);
                    setTimeout(runValidation, 100);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
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
                  onChange={() => {
                    setValidationResult(null);
                    setTimeout(runValidation, 100);
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="source" label="预约来源" initialValue="wechat">
            <Select
              options={[
                { value: 'phone', label: '电话' },
                { value: 'wechat', label: '微信' },
                { value: 'walk_in', label: '到店' },
                { value: 'online', label: '线上' },
              ]}
            />
          </Form.Item>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="请输入备注" />
          </Form.Item>

          {validationResult && (
            <>
              <Divider orientation="left">智能校验结果</Divider>

              {validationResult.warnings.length > 0 && (
                <Collapse defaultActiveKey={['warnings']} style={{ marginBottom: 16 }}>
                  <Panel header={`校验提示 (${validationResult.warnings.length})`} key="warnings">
                    <List
                      size="small"
                      dataSource={validationResult.warnings}
                      renderItem={(warning) => (
                        <List.Item>
                          <Space>
                            {getWarningIcon(warning.level)}
                            <Text type={warning.level === 'error' ? 'danger' : warning.level === 'warning' ? 'warning' : undefined}>
                              {warning.message}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Panel>
                </Collapse>
              )}

              {validationResult.healthAlerts.length > 0 && (
                <Alert
                  message="健康风险提醒（不禁止预约，请前台人工确认）"
                  description={validationResult.healthAlerts.map((alert, i) => (
                    <div key={i}>{alert}</div>
                  ))}
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
              )}

              {validationResult.employeeRecommendations.length > 0 && (
                <Collapse defaultActiveKey={['employees']} style={{ marginBottom: 16 }}>
                  <Panel header="美容师智能推荐（同一美容师优先服务多项目）" key="employees">
                    <List
                      size="small"
                      dataSource={validationResult.employeeRecommendations.slice(0, 5)}
                      renderItem={(rec, idx) => (
                        <List.Item>
                          <List.Item.Meta
                            avatar={
                              <Badge count={idx === 0 && rec.available ? '推荐' : 0} offset={[-5, 5]}>
                                <Avatar icon={<UserOutlined />} />
                              </Badge>
                            }
                            title={
                              <Space>
                                <span>{rec.employeeName}</span>
                                {rec.available ? (
                                  <CheckCircleTwoTone twoToneColor="#52c41a" />
                                ) : (
                                  <CloseCircleTwoTone twoToneColor="#ff4d4f" />
                                )}
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  匹配分: {rec.score}
                                </Text>
                              </Space>
                            }
                            description={
                              <div style={{ fontSize: 12 }}>
                                {rec.reasons.slice(0, 4).map((r, i) => (
                                  <Tag key={i} style={{ margin: 2 }}>{r}</Tag>
                                ))}
                              </div>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </Panel>
                </Collapse>
              )}

              {validationResult.priceCalculation.items.length > 0 && (
                <Collapse defaultActiveKey={['price']} style={{ marginBottom: 16 }}>
                  <Panel
                    header={
                      <Space>
                        <span>价格明细（套餐/积分/会员自动选最优方案）</span>
                        <Tag color="green">
                          总计: {formatCurrency(validationResult.priceCalculation.totalFinal)}
                        </Tag>
                        {validationResult.priceCalculation.totalDiscount > 0 && (
                          <Tag color="orange">
                            已省: {formatCurrency(validationResult.priceCalculation.totalDiscount)}
                          </Tag>
                        )}
                      </Space>
                    }
                    key="price"
                  >
                    <List
                      size="small"
                      dataSource={validationResult.priceCalculation.items}
                      renderItem={(item) => (
                        <List.Item>
                          <List.Item.Meta
                            title={item.serviceName}
                            description={
                              <Space size={8} wrap>
                                <Text delete type="secondary">{formatCurrency(item.originalPrice)}</Text>
                                {item.memberDiscount > 0 && (
                                  <Tag color="blue">会员-{formatCurrency(item.memberDiscount)}</Tag>
                                )}
                                {item.packageDiscount > 0 && (
                                  <Tag color="purple">套餐-{formatCurrency(item.packageDiscount)}</Tag>
                                )}
                                {item.pointsDiscount > 0 && (
                                  <Tag color="gold">积分-{formatCurrency(item.pointsDiscount)}</Tag>
                                )}
                              </Space>
                            }
                          />
                          <Text strong style={{ color: '#C9A86C' }}>
                            {formatCurrency(item.finalPrice)}
                          </Text>
                        </List.Item>
                      )}
                    />
                    <Divider style={{ margin: '8px 0' }} />
                    <div style={{ textAlign: 'right' }}>
                      <Space direction="vertical" align="end" size={4}>
                        <Text>原价: {formatCurrency(validationResult.priceCalculation.totalOriginal)}</Text>
                        <Text type="success">
                          优惠: -{formatCurrency(validationResult.priceCalculation.totalDiscount)}
                          {validationResult.pointsBlocked && ' (积分已禁用)'}
                        </Text>
                        <Title level={4} style={{ margin: 0, color: '#C9A86C' }}>
                          实付: {formatCurrency(validationResult.priceCalculation.totalFinal)}
                        </Title>
                      </Space>
                    </div>
                  </Panel>
                </Collapse>
              )}

              {validationResult.needsReceptionConfirm && (
                <Alert
                  message="需要前台二次确认"
                  description="该钻石会员近期有多次爽约记录，提交后需前台人工确认才能生效。积分抵扣已被暂时禁用。"
                  type="warning"
                  showIcon
                  icon={<WarningOutlined />}
                  style={{ marginBottom: 16 }}
                />
              )}
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
};

const BUFFER_TIME_MINUTES = 15;

export default AppointmentCalendar;
