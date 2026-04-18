import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { Menu, AlertCircle, ExternalLink, RefreshCw, Database, Copy, Check, LogOut, Layout } from 'lucide-react';
import { INITIAL_CONFIG, DEFAULT_MAPPING } from '../constants';
import { SheetConfig, DashboardRow, KPIStats, SKUDetail, RemainingQtyItem } from '../types';
import { fetchSheetData, parseDate } from '../services/sheetService';
import KPIGrid from './KPIGrid';
import FilterSection from './FilterSection';
import SKUDetailsSection from './SKUDetailsSection';
import SKUCountCharts from './SKUCountCharts';
import WipDrilldownModal from './WipDrilldownModal';
import RejectionDetailsSection from './RejectionDetailsSection';
import RejectionDrilldownModal from './RejectionDrilldownModal';
import AcceptedDrilldownModal from './AcceptedDrilldownModal';
import SettingsMenu from './SettingsMenu';
import { isWithinInterval, startOfDay, endOfDay } from 'date-fns';

// Memoize heavy components
const MemoizedKPIGrid = memo(KPIGrid);
const MemoizedFilterSection = memo(FilterSection);
const MemoizedSKUDetailsSection = memo(SKUDetailsSection);
const MemoizedSKUCountCharts = memo(SKUCountCharts);
const MemoizedRejectionDetailsSection = memo(RejectionDetailsSection);
const MemoizedWipDrilldownModal = memo(WipDrilldownModal);
const MemoizedRejectionDrilldownModal = memo(RejectionDrilldownModal);
const MemoizedAcceptedDrilldownModal = memo(AcceptedDrilldownModal);

const MemoizedSettingsMenu = memo(SettingsMenu);

const App: React.FC = () => {
  // Utility for safe local storage operations
  const safeLocalStorageSet = useCallback((key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        console.warn(`LocalStorage quota exceeded for key: ${key}. Clearing cache.`);
        // Try to clear some space or at least remove the key that's failing
        localStorage.removeItem(key);
      } else {
        console.error(`Error saving to LocalStorage for key: ${key}`, e);
      }
      return false;
    }
  }, []);

  const [config, setConfig] = useState<SheetConfig>(() => {
    const saved = localStorage.getItem('qc_dashboard_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...INITIAL_CONFIG,
            ...parsed,
            mapping: { ...INITIAL_CONFIG.mapping, ...(parsed.mapping || {}) }
          };
        }
      } catch (e) {
        console.error("Failed to parse config from localStorage", e);
      }
    }
    return INITIAL_CONFIG;
  });
  
  const [data, setData] = useState<DashboardRow[]>(() => {
    const saved = localStorage.getItem('qc_dashboard_cached_data');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      
      // Re-parse dates because JSON.parse turns them into strings
      return parsed.map(row => ({
        ...row,
        date: row.date ? new Date(row.date) : null,
        _parsedDate: row._parsedDate ? new Date(row._parsedDate) : null,
        _inventoryDate: row._inventoryDate ? new Date(row._inventoryDate) : null
      }));
    } catch (e) {
      console.error("Failed to parse cached data", e);
      return [];
    }
  });
  const [headers, setHeaders] = useState<string[]>(() => {
    const saved = localStorage.getItem('qc_dashboard_cached_headers');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  });
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCompactMode, setIsCompactMode] = useState(() => {
    return localStorage.getItem('qc_dashboard_compact_mode') === 'true';
  });
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error' | 'syncing' | null; message: string | null }>({ type: null, message: null });
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestDataRef = useRef<DashboardRow[] | null>(null);
  const latestHeadersRef = useRef<string[] | null>(null);
  const latestMappingRef = useRef<any>(null);

  const syncLatestData = useCallback(() => {
    if (latestDataRef.current) {
      setData(latestDataRef.current);
      if (latestHeadersRef.current) setHeaders(latestHeadersRef.current);
      if (latestMappingRef.current) setConfig(prev => ({ ...prev, mapping: latestMappingRef.current }));
      latestDataRef.current = null;
      latestHeadersRef.current = null;
      latestMappingRef.current = null;
    }
  }, []);

  const setSyncMessage = (type: 'success' | 'error' | 'syncing', message: string) => {
    setSyncStatus({ type, message });
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    if (type !== 'syncing') {
      syncTimeoutRef.current = setTimeout(() => setSyncStatus({ type: null, message: null }), 5000);
    }
  };

  const [selectedBatches, setSelectedBatches] = useState<string[]>(() => {
    const saved = localStorage.getItem('qc_dashboard_selected_batches');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  });
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>(() => {
    const saved = localStorage.getItem('qc_dashboard_date_range');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          start: parsed.start ? new Date(parsed.start) : null,
          end: parsed.end ? new Date(parsed.end) : null
        };
      } catch (e) {
        return { start: null, end: null };
      }
    }
    return { start: null, end: null };
  });
  const [uidSearch, setUidSearch] = useState(() => {
    return localStorage.getItem('qc_dashboard_uid_search') || '';
  });
  const [debouncedUidSearch, setDebouncedUidSearch] = useState(uidSearch);
  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState(false);
  const [isAcceptedModalOpen, setIsAcceptedModalOpen] = useState(false);
  const [isWipModalOpen, setIsWipModalOpen] = useState(false);

  // Sync debounced search with uidSearch
  useEffect(() => {
    setDebouncedUidSearch(uidSearch);
  }, [uidSearch]);

  const handleSetSelectedBatches = useCallback((batches: string[]) => {
    syncLatestData();
    setSelectedBatches(batches);
  }, [syncLatestData]);

  const handleSetDateRange = useCallback((range: { start: Date | null; end: Date | null }) => {
    syncLatestData();
    setDateRange(range);
  }, [syncLatestData]);

  const handleSetUidSearch = useCallback((search: string) => {
    syncLatestData();
    setUidSearch(search);
  }, [syncLatestData]);

  const handleSheetSwitch = useCallback((sheetName: string) => {
    if (config.sheetName === sheetName) return;
    
    // Clear current data and selection to trigger "Refreshing" state
    setData([]);
    setSelectedBatches([]);
    
    const newConfig = { ...config, sheetName };
    setConfig(newConfig);
    safeLocalStorageSet('qc_dashboard_config', JSON.stringify(newConfig));
  }, [config, safeLocalStorageSet]);

  const handleConfigUpdate = useCallback((newConfig: SheetConfig) => {
    syncLatestData();
    setConfig(newConfig);
    safeLocalStorageSet('qc_dashboard_config', JSON.stringify(newConfig));
  }, [syncLatestData, safeLocalStorageSet]);

  // Use a second ref for copy toast timer
  const copyToastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Persistence effects
  useEffect(() => {
    safeLocalStorageSet('qc_dashboard_selected_batches', JSON.stringify(selectedBatches));
  }, [selectedBatches, safeLocalStorageSet]);

  useEffect(() => {
    safeLocalStorageSet('qc_dashboard_date_range', JSON.stringify(dateRange));
  }, [dateRange, safeLocalStorageSet]);

  useEffect(() => {
    safeLocalStorageSet('qc_dashboard_uid_search', uidSearch);
  }, [uidSearch, safeLocalStorageSet]);

  useEffect(() => {
    if (data.length > 0) {
      safeLocalStorageSet('qc_dashboard_cached_data', JSON.stringify(data));
    }
  }, [data, safeLocalStorageSet]);

  useEffect(() => {
    if (headers.length > 0) {
      safeLocalStorageSet('qc_dashboard_cached_headers', JSON.stringify(headers));
    }
  }, [headers, safeLocalStorageSet]);

  useEffect(() => {
    safeLocalStorageSet('qc_dashboard_compact_mode', String(isCompactMode));
  }, [isCompactMode, safeLocalStorageSet]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
    };
  }, []);

  const lastRawData = useRef<string>('');

  // Robust column detection with priority on SKU
  const findHeaderMatch = useCallback((availableHeaders: string[], searchTerms: string[]): string | undefined => {
    if (!availableHeaders.length) return undefined;
    
    const lowerHeaders = availableHeaders.map(h => h.trim().toLowerCase());
    
    for (const term of searchTerms) {
      const idx = lowerHeaders.indexOf(term.toLowerCase());
      if (idx !== -1) return availableHeaders[idx];
    }

    const contains = availableHeaders.find(h => 
      searchTerms.some(term => h.toLowerCase().includes(term.toLowerCase()))
    );
    if (contains) return contains;

    return availableHeaders.find(h => {
      const normalized = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      return searchTerms.some(term => {
        const termNorm = term.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalized.includes(termNorm) || termNorm.includes(normalized);
      });
    });
  }, []);

  const autoDetectMapping = useCallback((availableHeaders: string[]) => {
    const mapping = { ...(config.mapping || DEFAULT_MAPPING) };
    
    const aliases = {
      sku: ['sku', 'item', 'part', 'article', 'model', 'product', 'code'],
      batchNo: ['batch', 'lot', 'serial', 'batch no', 'batch number', 'batch id', 'lot no', 'lot id'],
      ringStatus: ['status', 'result', 'outcome', 'quality'],
      uid: ['uid', 'id', 'barcode', 'serial'],
      inward: ['inward', 'qty', 'count', 'total'],
      reason: ['reason', 'rejection', 'defect', 'cause', 'fault'],
      movedToInventory: ['moved to inventory', 'inventory', 'moved'],
      inventoryDate: ['inventory date', 'moved date', 'date moved'],
      inventoryBatch: ['inventory batch', 'batch moved', 'batch inventory'],
    };

    // 1. Explicitly look for "DATE" column first (case-insensitive)
    const dateHeader = availableHeaders.find(h => h.trim().toUpperCase() === 'DATE');
    if (dateHeader) {
      mapping.date = dateHeader;
    } else {
      // Fallback only if "DATE" is not found, using a very restricted set of aliases
      const fallbackDate = findHeaderMatch(availableHeaders, ['date', 'timestamp', 'day']);
      if (fallbackDate) mapping.date = fallbackDate;
    }

    (Object.entries(aliases) as [keyof typeof aliases, string[]][]).forEach(([key, terms]) => {
      const currentVal = mapping[key as keyof typeof mapping];
      if (!currentVal || !availableHeaders.includes(currentVal)) {
        const detected = findHeaderMatch(availableHeaders, terms);
        if (detected) {
          (mapping as any)[key] = detected;
        } else {
          (mapping as any)[key] = '';
        }
      }
    });

    return mapping;
  }, [config.mapping, findHeaderMatch]);

  const loadData = useCallback(async (silent = false) => {
    if (!config.url) {
      if (!silent) setError("CONFIGURATION REQUIRED: Please link a valid public Google Sheet.");
      return;
    }

    // Prevent overlapping syncs
    if (loading || isBackgroundSyncing) return;
    
    if (!silent) {
      setLoading(true);
      setSyncMessage('syncing', 'Syncing data...');
    } else {
      setIsBackgroundSyncing(true);
    }
    
    try {
      const { data: rawData, headers: sheetHeaders } = await fetchSheetData(config.url, config.sheetName);
      
      // Performance: Avoid re-processing if data hasn't changed
      const currentDataStr = JSON.stringify(rawData);
      if (silent && currentDataStr === lastRawData.current) {
        setLastSyncTime(new Date());
        return;
      }
      lastRawData.current = currentDataStr;
      setLastSyncTime(new Date());

      setHeaders(sheetHeaders);
      
      const updatedMapping = autoDetectMapping(sheetHeaders);
      if (JSON.stringify(updatedMapping) !== JSON.stringify(config.mapping)) {
        setConfig(prev => ({ ...prev, mapping: updatedMapping }));
      }

      // Pre-parse dates and extract unique batches in a single pass
      const batchCol = updatedMapping.batchNo;
      const hasBatchCol = batchCol && sheetHeaders.includes(batchCol);
      const uniqueBatchesSet = new Set<string>();

      const updatedData = rawData.map(row => {
        const parsedDate = parseDate(String(row[updatedMapping.date] || ''));
        const parsedInventoryDate = parseDate(String(row[updatedMapping.inventoryDate] || ''));
        if (hasBatchCol) {
          const batchVal = String(row[batchCol] || '').trim();
          if (batchVal) uniqueBatchesSet.add(batchVal);
        }
        return {
          ...row,
          date: parsedDate,
          _parsedDate: parsedDate,
          _inventoryDate: parsedInventoryDate
        };
      });

      // Update state
      setData(updatedData);
      setHeaders(sheetHeaders);

      if (hasBatchCol) {
        const uniqueBatches = Array.from(uniqueBatchesSet)
          .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        
        setSelectedBatches(prev => {
          // Filter current selection to only include batches that still exist in the new data
          const validSelectedBatches = prev.filter(b => uniqueBatchesSet.has(b));
          
          // If current selection is empty or all previously selected batches are gone, reset to all
          if (prev.length === 0 || (validSelectedBatches.length === 0 && uniqueBatches.length > 0)) {
            return uniqueBatches;
          }
          
          // Otherwise, maintain the valid subset of the user's selection
          return validSelectedBatches;
        });
      } else {
        setSelectedBatches([]);
      }
      
      setError(null);
      if (!silent) setSyncMessage('success', 'Data synced successfully');
    } catch (err: any) {
      const isNetworkError = err.message === 'Failed to fetch' || 
                             err.message.includes('timed out') || 
                             !navigator.onLine;
      
      if (!silent) {
        const userMessage = isNetworkError 
          ? "NETWORK ERROR: Unable to reach Google Sheets. Please check your connection." 
          : err.message;
        setError(userMessage);
        setSyncMessage('error', 'Sync failed, showing last data');
      } else {
        // Silent error: just log it and keep previous data
        if (!isNetworkError) {
          console.error("Background sync failed:", err.message);
        } else {
          console.warn("Background sync skipped: Connection issue or timeout.");
        }
      }
    } finally {
      if (!silent) setLoading(false);
      else setIsBackgroundSyncing(false);
    }
  }, [config.url, config.sheetName, autoDetectMapping, loading, isBackgroundSyncing]);

  const lastDateMapping = useRef(config.mapping?.date);
  const lastInventoryDateMapping = useRef(config.mapping?.inventoryDate);
  const lastInventoryBatchMapping = useRef(config.mapping?.inventoryBatch);

  useEffect(() => {
    if (data.length > 0 && config.mapping && (
      lastDateMapping.current !== config.mapping.date || 
      lastInventoryDateMapping.current !== config.mapping.inventoryDate ||
      lastInventoryBatchMapping.current !== config.mapping.inventoryBatch
    )) {
      lastDateMapping.current = config.mapping.date;
      lastInventoryDateMapping.current = config.mapping.inventoryDate;
      lastInventoryBatchMapping.current = config.mapping.inventoryBatch;
      setData(prev => prev.map(row => {
        const parsedDate = parseDate(String(row[config.mapping.date] || ''));
        const parsedInventoryDate = parseDate(String(row[config.mapping.inventoryDate] || ''));
        return {
          ...row,
          date: parsedDate,
          _parsedDate: parsedDate,
          _inventoryDate: parsedInventoryDate
        };
      }));
    }
  }, [config.mapping?.date, config.mapping?.inventoryDate, config.mapping?.inventoryBatch, data.length]);

  const lastSyncAttempt = useRef<number>(Date.now());

  const prevConfigRef = useRef({ url: config.url, sheetName: config.sheetName });

  // Initial load: Use silent sync if we have cached data to avoid loading spinner
  useEffect(() => { 
    if (config.url) {
      const isConfigChange = prevConfigRef.current.url !== config.url || prevConfigRef.current.sheetName !== config.sheetName;
      prevConfigRef.current = { url: config.url, sheetName: config.sheetName };

      if (data.length > 0 && !isConfigChange) {
        loadData(true); // Background sync on initial load if cached
      } else {
        loadData(false); // Initial full sync or config changed
      }
    }
  }, [config.url, config.sheetName]);

  // Handle visibility change: Resume instantly and sync if needed
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab became active again - check if we should sync
        const now = Date.now();
        // Only sync if it's been more than 5 minutes since last attempt
        if (config.url && !loading && (now - lastSyncAttempt.current > 5 * 60 * 1000)) {
          lastSyncAttempt.current = now;
          loadData(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [config.url, config.sheetName, loadData, loading, syncLatestData]);

  // Auto-sync every 10 seconds, ONLY when tab is active and online
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && config.url && !loading && !isBackgroundSyncing && navigator.onLine) {
        lastSyncAttempt.current = Date.now();
        loadData(true);
      }
    }, 10 * 1000);
    return () => clearInterval(interval);
  }, [config.url, config.sheetName, loadData, loading, isBackgroundSyncing]);

  const allUniqueBatches = useMemo(() => {
    const batchCol = config.mapping?.batchNo;
    if (!batchCol || !headers.includes(batchCol)) {
      console.log('App: Batch column not found in headers:', batchCol, headers);
      return [];
    }
    const unique = Array.from(new Set(data.map(r => String(r[batchCol] || '').trim())))
      .filter(Boolean)
      .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
    console.log('App: Found unique batches:', unique.length);
    return unique;
  }, [data, config.mapping?.batchNo, headers]);

  const filteredData = useMemo(() => {
    const mapping = config.mapping || DEFAULT_MAPPING;
    if (data.length === 0) return [];

    const parsedStartDate = dateRange.start ? new Date(dateRange.start) : null;
    if (parsedStartDate) parsedStartDate.setHours(0, 0, 0, 0);
    
    const parsedEndDate = dateRange.end ? new Date(dateRange.end) : null;
    if (parsedEndDate) parsedEndDate.setHours(0, 0, 0, 0);

    const batchCol = mapping.batchNo;
    const hasBatchFilter = batchCol && headers.includes(batchCol) && selectedBatches.length > 0 && selectedBatches.length < allUniqueBatches.length;
    const searchTerm = String(debouncedUidSearch || '').trim().toLowerCase();
    const uidCol = mapping.uid;

    const dateCol = mapping.date;
    const hasDateMapping = dateCol && headers.includes(dateCol);

    return data.filter(item => {
      // Date Filter
      if (hasDateMapping && (parsedStartDate || parsedEndDate)) {
        const rawRowDate = item.date;
        const rowDate = rawRowDate instanceof Date ? rawRowDate : (rawRowDate ? new Date(rawRowDate) : null);
        
        // If a row has a blank or invalid date, exclude it when a filter is active
        if (!rowDate || isNaN(rowDate.getTime())) return false;
        
        // Ensure rowDate is also forced to local midnight for comparison if not already
        // (Though parseDate should have already handled this)
        const rowTime = new Date(rowDate.getTime());
        rowTime.setHours(0, 0, 0, 0);

        const isAfterStart = !parsedStartDate || rowTime.getTime() >= parsedStartDate.getTime();
        const isBeforeEnd = !parsedEndDate || rowTime.getTime() <= parsedEndDate.getTime();

        if (!isAfterStart || !isBeforeEnd) return false;
      }
      
      // Batch Filter
      if (hasBatchFilter) {
        const rowBatch = String(item[batchCol] || '').trim();
        if (!selectedBatches.includes(rowBatch)) return false;
      }

      // UID Search Filter
      const uidString = String(item.uid || item.UID || item.Id || item[uidCol] || '');
      const matchesSearch = !searchTerm || uidString.toLowerCase().includes(searchTerm);
      if (!matchesSearch) return false;

      return true;
    });
  }, [data, config, dateRange, selectedBatches, debouncedUidSearch, headers, allUniqueBatches]);

  const stats: KPIStats = useMemo(() => {
    const mapping = config.mapping || DEFAULT_MAPPING;
    let total = 0;
    let accepted = 0;
    let rejected = 0;
    let inwardCount = 0;
    let movedToInventory = 0;

    const getRowValue = (row: DashboardRow, column: string) => {
      if (!column) return 1;
      const val = row[column];
      if (val === undefined || val === null || val === '') return 1;
      const num = Number(val);
      return isNaN(num) ? 1 : num;
    };

    filteredData.forEach(r => {
      const uid = String(r[mapping.uid] || '').trim();
      const sku = String(r[mapping.sku] || '').trim();
      const qty = getRowValue(r, mapping.quantity);
      
      // Only count rows that have either a UID or an SKU
      if (uid !== '' || sku !== '') {
        total += qty;
        const status = String(r[mapping.ringStatus] || '').trim().toLowerCase();
        if (['accepted', 'ok', 'pass', '1', 'true', 'yes'].includes(status)) {
          accepted += qty;
        } else if (['rejected', 'nok', 'fail', '0', 'false', 'no'].includes(status)) {
          rejected += qty;
        }
      }

      if (String(r[mapping.inward] || '').trim() !== '') {
        inwardCount += qty;
      }
    });

    // Calculate movedToInventory separately using Inventory Date filtering
    const parsedStartDate = dateRange.start ? new Date(dateRange.start) : null;
    if (parsedStartDate) parsedStartDate.setHours(0, 0, 0, 0);
    
    const parsedEndDate = dateRange.end ? new Date(dateRange.end) : null;
    if (parsedEndDate) parsedEndDate.setHours(0, 0, 0, 0);

    const batchCol = mapping.batchNo;
    const inventoryBatchCol = mapping.inventoryBatch;
    const hasBatchFilter = batchCol && headers.includes(batchCol) && selectedBatches.length > 0 && selectedBatches.length < allUniqueBatches.length;
    const hasInventoryBatchFilter = inventoryBatchCol && headers.includes(inventoryBatchCol) && selectedBatches.length > 0 && selectedBatches.length < allUniqueBatches.length;
    const searchTerm = String(debouncedUidSearch || '').trim().toLowerCase();
    const uidCol = mapping.uid;

    data.forEach(r => {
      const movedVal = String(r[mapping.movedToInventory] || '').trim();
      if (movedVal === '') return;

      // Apply Inventory Date Filter
      const rowInventoryDate = r._inventoryDate instanceof Date ? r._inventoryDate : (r._inventoryDate ? new Date(r._inventoryDate) : null);
      
      if (parsedStartDate || parsedEndDate) {
        if (!rowInventoryDate || isNaN(rowInventoryDate.getTime())) return;
        
        const rowTime = new Date(rowInventoryDate.getTime());
        rowTime.setHours(0, 0, 0, 0);

        const isAfterStart = !parsedStartDate || rowTime.getTime() >= parsedStartDate.getTime();
        const isBeforeEnd = !parsedEndDate || rowTime.getTime() <= parsedEndDate.getTime();

        if (!isAfterStart || !isBeforeEnd) return;
      }

      // Apply Inventory Batch Filter
      if (hasInventoryBatchFilter) {
        const rowBatch = String(r[inventoryBatchCol] || '').trim();
        if (!selectedBatches.includes(rowBatch)) return;
      }

      // Apply UID Search Filter
      const uidString = String(r.uid || r.UID || r.Id || r[uidCol] || '');
      const matchesSearch = !searchTerm || uidString.toLowerCase().includes(searchTerm);
      if (!matchesSearch) return;

      const qty = getRowValue(r, mapping.quantity);
      movedToInventory += qty;
    });

    const wip = Math.max(0, inwardCount - total);
    const yieldVal = total > 0 ? (accepted / total) * 100 : 0;
    
    return { total, accepted, rejected, wip, yield: yieldVal, movedToInventory };
  }, [filteredData, config, data, dateRange, selectedBatches, debouncedUidSearch, headers, allUniqueBatches]);

  const skuDetails = useMemo(() => {
    const mapping = config.mapping || DEFAULT_MAPPING;
    const skuMap: Record<string, { total: number; accepted: number; rejected: number }> = {};
    
    let skuKey = mapping.sku;
    if (!headers.includes(skuKey)) {
      skuKey = findHeaderMatch(headers, ['sku', 'item', 'part', 'model']) || (headers.length > 0 ? headers[0] : '');
    }

    if (filteredData.length === 0 || !skuKey) {
      return [];
    }

    const getRowValue = (row: DashboardRow, column: string) => {
      if (!column) return 1;
      const val = row[column];
      if (val === undefined || val === null || val === '') return 1;
      const num = Number(val);
      return isNaN(num) ? 1 : num;
    };

    filteredData.forEach(r => {
      const val = r[skuKey];
      if (val !== undefined && val !== null) {
        const sku = String(val).trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
        if (sku !== '') {
          if (!skuMap[sku]) {
            skuMap[sku] = { total: 0, accepted: 0, rejected: 0 };
          }
          const qty = getRowValue(r, mapping.quantity);
          skuMap[sku].total += qty;
          
          const status = String(r[mapping.ringStatus] || '').trim().toLowerCase();
          if (['accepted', 'ok', 'pass', '1', 'true', 'yes'].includes(status)) {
            skuMap[sku].accepted += qty;
          } else if (['rejected', 'nok', 'fail', '0', 'false', 'no'].includes(status)) {
            skuMap[sku].rejected += qty;
          }
        }
      }
    });

    return Object.entries(skuMap).map(([sku, s]) => ({
      sku,
      total: s.total,
      accepted: s.accepted,
      rejected: s.rejected,
      yield: s.total > 0 ? (s.accepted / s.total) * 100 : 0
    }));
  }, [filteredData, config, headers, findHeaderMatch]);

  const handleCopyReport = () => {
    syncLatestData();
    if (stats.total === 0) {
      alert("No data available");
      return;
    }

    const mapping = config.mapping || DEFAULT_MAPPING;
    
    const totalData = filteredData.filter(r => 
      String(r[mapping.uid] || '').trim() !== '' || 
      String(r[mapping.sku] || '').trim() !== ''
    );

    const acceptedRows = totalData.filter(r => {
      const status = String(r[mapping.ringStatus] || '').trim().toLowerCase();
      return ['accepted', 'ok', 'pass', '1', 'true', 'yes'].includes(status);
    });
    
    const acceptedGroups: Record<string, number> = {};
    acceptedRows.forEach(r => {
      const sku = String(r[mapping.sku] || 'Unknown SKU').trim();
      acceptedGroups[sku] = (acceptedGroups[sku] || 0) + 1;
    });
    
    const acceptedDetailsStr = Object.entries(acceptedGroups)
      .map(([sku, count]) => `${sku}: ${count}`)
      .join('\n');

    const rejectedRows = totalData.filter(r => {
      const status = String(r[mapping.ringStatus] || '').trim().toLowerCase();
      return ['rejected', 'nok', 'fail', '0', 'false', 'no'].includes(status);
    });
    
    const rejectedGroups: Record<string, number> = {};
    rejectedRows.forEach(r => {
      const reason = String(r[mapping.reason] || 'No Reason Specified').trim();
      rejectedGroups[reason] = (rejectedGroups[reason] || 0) + 1;
    });
    
    const rejectedDetailsStr = Object.entries(rejectedGroups)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join('\n');

    const reportText = `------------------------------------
BATCH REPORT

TOTAL : ${stats.total}
ACCEPTED : ${stats.accepted}
REJECTED : ${stats.rejected}
YIELD : ${stats.yield.toFixed(1)}%

ACCEPTED DETAILS
${acceptedDetailsStr || 'None'}

REJECTION DETAILS
${rejectedDetailsStr || 'None'}
------------------------------------`;

    navigator.clipboard.writeText(reportText).then(() => {
      setShowCopyToast(true);
      if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
      copyToastTimeoutRef.current = setTimeout(() => setShowCopyToast(false), 3000);
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  const handleOpenRejection = useCallback(() => setIsRejectionModalOpen(true), []);
  const handleCloseRejection = useCallback(() => setIsRejectionModalOpen(false), []);
  const handleOpenAccepted = useCallback(() => setIsAcceptedModalOpen(true), []);
  const handleCloseAccepted = useCallback(() => setIsAcceptedModalOpen(false), []);
  const handleOpenWip = useCallback(() => setIsWipModalOpen(true), []);
  const handleCloseWip = useCallback(() => setIsWipModalOpen(false), []);

  return (
    <div className="min-h-screen pb-12 w-full max-w-[100vw] bg-[#0f1117]">
        <header className="sticky top-0 z-40 bg-[#161a23]/90 backdrop-blur-xl border-b border-white/5 shadow-2xl w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center">
                <img 
                  src={`/logo.png?v=${Date.now()}`}
                  alt=""
                  style={{ maxHeight: '48px', width: 'auto', objectFit: 'contain' }}
                  className="rounded-xl"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div>
                <h1 className="text-xl font-black text-white leading-tight tracking-tight uppercase">Dashboard</h1>
                <p className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-[0.4em] mono">Quality Analytics Pro</p>
              </div>
            </div>
              <div className="flex items-center gap-4">
                <div className="hidden lg:flex items-center bg-[#0f1117] border border-white/5 rounded-2xl p-1 gap-1">
                  <button
                    onClick={() => handleSheetSwitch('RT CONVERSION')}
                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                      config.sheetName === 'RT CONVERSION' 
                        ? 'bg-[#38bdf8] text-white shadow-[0_0_15px_rgba(56,189,248,0.3)]' 
                        : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    RT CONVERSION
                  </button>
                  <button
                    onClick={() => handleSheetSwitch('WABI SABI')}
                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                      config.sheetName === 'WABI SABI' 
                        ? 'bg-[#38bdf8] text-white shadow-[0_0_15px_rgba(56,189,248,0.3)]' 
                        : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    WABI SABI
                  </button>
                </div>

                {data.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsCompactMode(!isCompactMode)}
                      className={`hidden sm:flex items-center gap-2 px-4 py-2.5 text-[10px] font-black rounded-xl transition-all border uppercase tracking-widest ${
                        isCompactMode 
                          ? 'bg-[#38bdf8] text-white border-[#38bdf8] shadow-[0_0_15px_rgba(56,189,248,0.3)]' 
                          : 'bg-transparent text-[#9ca3af] border-white/10 hover:text-white hover:border-white/20'
                      }`}
                    >
                      <Layout className="w-3.5 h-3.5" />
                      {isCompactMode ? 'Full View' : 'Compact Mode'}
                    </button>
                    <button 
                      onClick={handleCopyReport}
                      className="hidden sm:flex items-center gap-2 px-5 py-2.5 text-xs font-black text-[#e5e7eb] bg-[#22c55e]/10 hover:bg-[#22c55e]/20 rounded-xl transition-all border border-[#22c55e]/30 uppercase tracking-widest"
                    >
                      <Copy className="w-4 h-4 text-[#22c55e]" />
                      REPORT
                    </button>
                  </div>
                )}
                {config.url && (
                  <div className="relative flex flex-col items-center">
                    <button 
                      onClick={() => {
                        if (latestDataRef.current) syncLatestData();
                        else loadData(false);
                      }} 
                      className="flex items-center gap-2 px-5 py-2.5 text-xs font-black text-[#38bdf8] hover:bg-[#38bdf8]/10 rounded-xl transition-all border border-[#38bdf8]/20 disabled:opacity-50 uppercase tracking-widest" 
                      disabled={loading || isBackgroundSyncing}
                    >
                      <RefreshCw className={`w-4 h-4 ${(loading || isBackgroundSyncing) ? 'animate-spin' : ''}`} />
                      <span className="hidden md:inline">
                        {(loading || isBackgroundSyncing) ? 'SYNCING...' : 'SYNC NOW'}
                      </span>
                    </button>
                    {(loading || isBackgroundSyncing) && (
                      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 animate-pulse whitespace-nowrap">
                        <RefreshCw className="w-2.5 h-2.5 text-[#38bdf8] animate-spin" />
                        <span className="text-[8px] font-black text-[#38bdf8] uppercase tracking-widest">
                          {loading ? 'Syncing' : 'Auto-Syncing'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => setIsSettingsOpen(true)} className="p-3 bg-[#1e232d] text-[#e5e7eb] hover:bg-[#2a313d] rounded-2xl border border-white/5 transition-all shadow-xl">
                  <Menu className="w-6 h-6" />
                </button>
              </div>
          </div>
        </div>
        {/* Mobile Sheet Switcher */}
        <div className="lg:hidden px-4 pb-4 flex justify-center bg-[#161a23]/90 backdrop-blur-xl border-b border-white/5">
          <div className="flex items-center bg-[#0f1117] border border-white/10 rounded-2xl p-1 gap-1 w-full max-w-md shadow-inner">
            <button
              onClick={() => handleSheetSwitch('RT CONVERSION')}
              className={`flex-1 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                config.sheetName === 'RT CONVERSION' 
                  ? 'bg-[#38bdf8] text-white shadow-[0_0_20px_rgba(56,189,248,0.4)]' 
                  : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
              }`}
            >
              RT CONVERSION
            </button>
            <button
              onClick={() => handleSheetSwitch('WABI SABI')}
              className={`flex-1 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                config.sheetName === 'WABI SABI' 
                  ? 'bg-[#38bdf8] text-white shadow-[0_0_20px_rgba(56,189,248,0.4)]' 
                  : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
              }`}
            >
              WABI SABI
            </button>
          </div>
        </div>
      </header>

      <main className="w-full px-4 sm:px-6 lg:px-8 mt-10">
        {error && (
          <div className="mb-10 p-6 bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-2xl flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-[#ef4444] shrink-0 mt-1" />
            <div className="flex-1">
              <h4 className="text-sm font-bold text-[#ef4444] uppercase tracking-widest">System Error</h4>
              <p className="text-sm text-[#9ca3af] mt-2 font-medium">{error}</p>
            </div>
          </div>
        )}

        {(!config.url && !loading) ? (
          <div className="py-32 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 bg-[#161a23] rounded-3xl flex items-center justify-center mb-8 border border-white/5 shadow-2xl">
              <Database className="w-10 h-10 text-[#38bdf8]" />
            </div>
            <h2 className="text-3xl font-black text-white mb-4 uppercase tracking-tighter">No Stream Detected</h2>
            <p className="text-[#9ca3af] max-sm mx-auto mb-10 text-sm leading-relaxed">
              Connect to a valid Google Sheet to initialize analytical rendering.
            </p>
            <button onClick={() => setIsSettingsOpen(true)} className="px-10 py-4 bg-[#38bdf8] hover:bg-[#0ea5e9] text-white font-bold rounded-2xl shadow-xl transition-all">
              OPEN CONFIG
            </button>
          </div>
        ) : (
          <div className="animate-in fade-in duration-700 space-y-10 w-full">
            {!isCompactMode && (
              <MemoizedFilterSection 
                batches={allUniqueBatches} 
                selectedBatches={selectedBatches} 
                setSelectedBatches={handleSetSelectedBatches} 
                dateRange={dateRange} 
                setDateRange={handleSetDateRange}
                uidSearch={uidSearch}
                setUidSearch={handleSetUidSearch}
                loading={loading}
              />
            )}
            <MemoizedKPIGrid 
              stats={stats} 
              loading={loading} 
              onRejectedClick={handleOpenRejection} 
              onAcceptedClick={handleOpenAccepted}
              onWipClick={handleOpenWip}
              filteredData={filteredData}
              mapping={config.mapping || DEFAULT_MAPPING}
            />
            
            {data.length > 0 && (
              <>
                {!isCompactMode && (
                  <div className="flex items-center justify-between px-6 py-4 bg-[#161a23] rounded-2xl border border-white/5">
                    <div className="flex items-center gap-6">
                      <p className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-[0.2em] mono">
                        Source: <span className="text-[#38bdf8]">{config.sheetName}</span>
                      </p>
                      <p className="hidden md:flex items-center text-[10px] font-bold text-[#9ca3af] uppercase tracking-[0.2em] mono border-l border-white/10 pl-6 gap-2">
                        Last synced: <span className="text-white">{lastSyncTime.toLocaleTimeString()}</span>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e]"></span>
                        </span>
                      </p>
                    </div>
                    <p className="text-[10px] font-bold text-[#9ca3af] uppercase tracking-[0.2em] mono">
                      Total Records: <span className="text-white bg-white/5 px-2 py-0.5 rounded ml-2">{filteredData.length}</span>
                    </p>
                  </div>
                )}
                
                {isCompactMode && (
                  <div style={{ contentVisibility: 'auto' }}>
                    <MemoizedSKUCountCharts data={filteredData} mapping={config.mapping || DEFAULT_MAPPING} />
                  </div>
                )}

                {!isCompactMode && (
                  <>
                    <div style={{ contentVisibility: 'auto' }}>
                      <MemoizedSKUDetailsSection skuDetails={skuDetails} />
                    </div>

                    <div className="pb-10 min-h-[500px]" style={{ contentVisibility: 'auto' }}>
                      <MemoizedRejectionDetailsSection 
                        filteredData={filteredData} 
                        allData={data} 
                        mapping={config.mapping || DEFAULT_MAPPING} 
                        headers={headers} 
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {showCopyToast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="px-8 py-4 bg-[#161a23] border border-[#22c55e]/30 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-xl">
            <Check className="w-5 h-5 text-[#22c55e]" />
            <span className="text-sm font-bold text-white uppercase tracking-widest">Report Copied to Clipboard</span>
          </div>
        </div>
      )}

      <MemoizedSettingsMenu config={{...config, mapping: config.mapping || DEFAULT_MAPPING}} headers={headers} onUpdate={handleConfigUpdate} isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} isRefreshing={loading} />
      
      <MemoizedRejectionDrilldownModal 
        isOpen={isRejectionModalOpen} 
        onClose={handleCloseRejection} 
        data={filteredData} 
        mapping={config.mapping || DEFAULT_MAPPING} 
      />

      <MemoizedAcceptedDrilldownModal 
        isOpen={isAcceptedModalOpen} 
        onClose={handleCloseAccepted} 
        data={filteredData} 
        mapping={config.mapping || DEFAULT_MAPPING} 
      />

      <MemoizedWipDrilldownModal 
        isOpen={isWipModalOpen}
        onClose={handleCloseWip}
        data={filteredData}
        headers={headers}
      />
    </div>
  );
};

export default App;