
export interface SheetConfig {
  url: string;
  sheetName: string;
  range: string;
  mapping: ColumnMapping;
}

export interface ColumnMapping {
  uid: string;
  ringStatus: string;
  date: string;
  batchNo: string;
  inward: string;
  sku: string;
  reason: string;
  quantity: string; // New field for summing values
  movedToInventory: string; // New field for counting non-empty cells
  inventoryDate: string; // New field for date-based filtering of inventory
  inventoryBatch: string; // New field for batch-based filtering of inventory
}

export interface DashboardRow {
  [key: string]: any;
}

export interface SKUDetail {
  sku: string;
  total: number;
  accepted: number;
  rejected: number;
  yield: number;
}

export interface KPIStats {
  total: number;
  accepted: number;
  rejected: number;
  wip: number;
  yield: number;
  movedToInventory: number;
}

export interface RemainingQtyItem {
  sku: string;
  qty: number;
}
