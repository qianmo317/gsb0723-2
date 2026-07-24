import React, { useState } from 'react';
import {
  Row,
  Col,
  Card,
  Tag,
  Button,
  Space,
  Modal,
  List,
  Avatar,
  message,
  Badge
} from 'antd';
import {
  PlusOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  UserOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import Calendar from 'react-calendar';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import { updateAppointment, deleteAppointment } from '../../store';
import type { Appointment } from '../../types';
import { formatDate, formatTime, getStatusText, getStatusColor } from '../../utils/format';
import SmartBookingModal from '../../components/SmartBookingModal';
import dayjs from 'dayjs';

const AppointmentCalendar: React.FC = () => {
  const dispatch = useDispatch();
  const state = useSelector((state: RootState) => state.app);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isBookingOpen, setIsBookingOpen] = useState(false);

  const selectedDateStr = dayjs(selectedDate).format('YYYY-MM-DD');

  const dayAppointments = state.appointments
    .filter((a) => a.startTime.split('T')[0] === selectedDateStr)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const waitListItems = state.waitList.filter((w) => w.status === 'waiting');

  const getTileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null;
    const dateStr = dayjs(date).format('YYYY-MM-DD');
    const count = state.appointments.filter((a) => a.startTime.split('T')[0] === dateStr).length;
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

  const handleStatusChange = (appointment: Appointment, newStatus: string) => {
    dispatch(
      updateAppointment({
        ...appointment,
        status: newStatus as Appointment['status'],
      })
    );
    message.success('状态更新成功');
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认取消',
      content: '确定要取消该预约吗？',
      onOk: () => {
        dispatch(deleteAppointment(id));
        message.success('预约已取消');
      },
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">预约排期</h1>
          <p className="page-header-subtitle">
            {formatDate(selectedDate)} 预约管理
          </p>
        </div>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setIsBookingOpen(true)}>
          智能预约
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
              <Space>
                <Tag color="blue">{dayAppointments.length} 个预约</Tag>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<PlusOutlined />}
                  onClick={() => setIsBookingOpen(true)}
                >
                  新增
                </Button>
              </Space>
            }
          >
            {dayAppointments.length > 0 ? (
              dayAppointments.map((appointment) => {
                const customer = state.customers.find((c) => c.id === appointment.customerId);
                const service = state.services.find((s) => s.id === appointment.serviceId);
                const employee = state.employees.find((e) => e.id === appointment.employeeId);
                const membership = state.memberships.find(m => m.customerId === appointment.customerId);

                return (
                  <div
                    key={appointment.id}
                    className={`appointment-slot ${appointment.status}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <Space>
                          <Badge
                            count={membership?.level === 'diamond' ? '钻' : membership?.level === 'platinum' ? '铂' : 0}
                            size="small"
                            style={{ backgroundColor: membership?.level === 'diamond' ? '#C9A86C' : '#B8B8B8' }}
                          >
                            <Avatar size={32} src={customer?.avatar} icon={<UserOutlined />} />
                          </Badge>
                          <div>
                            <div style={{ fontWeight: 500 }}>
                              {customer?.name}
                              {appointment.status === 'pending' && (
                                <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>待确认</Tag>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                              {service?.name} · {employee?.name}
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
                        <Tag color={getStatusColor(appointment.status)}>
                          {getStatusText(appointment.status)}
                        </Tag>
                      </Space>
                    </div>
                    {appointment.notes && (
                      <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4, paddingLeft: 40 }}>
                        {appointment.notes}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      {appointment.status === 'confirmed' && (
                        <Space>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => handleStatusChange(appointment, 'completed')}
                          >
                            <CheckCircleOutlined /> 完成
                          </Button>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => handleStatusChange(appointment, 'no_show')}
                          >
                            爽约
                          </Button>
                          <Button
                            type="link"
                            size="small"
                            danger
                            onClick={() => handleDelete(appointment.id)}
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
                            onClick={() => handleStatusChange(appointment, 'confirmed')}
                          >
                            <CheckCircleOutlined /> 确认
                          </Button>
                          <Button
                            type="link"
                            size="small"
                            danger
                            onClick={() => handleDelete(appointment.id)}
                          >
                            <DeleteOutlined /> 拒绝
                          </Button>
                        </Space>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="empty-state">
                <CalendarOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
                <div style={{ marginTop: 16 }}>当日暂无预约</div>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ marginTop: 12 }}
                  onClick={() => setIsBookingOpen(true)}
                >
                  立即预约
                </Button>
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

      <SmartBookingModal
        open={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
        initialDate={selectedDate}
      />
    </div>
  );
};

export default AppointmentCalendar;
