export type OrderStatus = 'PENDING_SHIPMENT' | 'SHIPPED' | 'DELIVERED';

export interface OrderItem {
  sku: string;
  qty: number;
}

export interface CreateOrderInput {
  customerId: string;
  items: OrderItem[];
  totalAmount: number;
}

export interface StatusEvent {
  eventId: string;
  status: OrderStatus;
  at: string;
}

export interface StatusUpdateInput {
  status: OrderStatus;
  at: string;
  eventId: string;
}

export interface ShipmentMetadata {
  shipmentId: string;
  state: string;
  requestedAt: string;
}

export interface OrderRecord {
  id: string;
  customerId: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  requestId: string;
  payloadHash: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  statusHistory: StatusEvent[];
  shipment?: ShipmentMetadata;
}
