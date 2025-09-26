import type { OrderItem } from '../types/order';

export interface AvailabilityCheckResult {
  available: boolean;
  unavailableItems?: Array<{
    sku: string;
    requestedQty: number;
    maxAvailable: number;
  }>;
  message?: string;
}

/**
 * Stubbed availability checker used to stand in for an external inventory service.
 *
 * The implementation intentionally keeps the rules simple: any item with a requested
 * quantity above `MAX_PER_ITEM` is considered unavailable. This gives us deterministic
 * behavior for tests while leaving a seam that can be swapped with a real integration.
 */
export class ProductAvailabilityService {
  private static readonly MAX_PER_ITEM = 10;

  async checkAvailability(items: OrderItem[]): Promise<AvailabilityCheckResult> {
    const unavailable = items
      .filter((item) => item.qty > ProductAvailabilityService.MAX_PER_ITEM)
      .map((item) => ({
        sku: item.sku,
        requestedQty: item.qty,
        maxAvailable: ProductAvailabilityService.MAX_PER_ITEM
      }));

    if (unavailable.length > 0) {
      return {
        available: false,
        unavailableItems: unavailable,
        message: 'One or more items are unavailable because they exceed inventory limits'
      };
    }

    return { available: true };
  }
}
