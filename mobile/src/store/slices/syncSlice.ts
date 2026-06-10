import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SyncState {
  isSyncing: boolean;
  lastSyncTime: string | null;
  pendingCount: number;
  failedCount: number;
  syncProgress: number;
  syncErrors: string[];
}

const initialState: SyncState = {
  isSyncing: false,
  lastSyncTime: null,
  pendingCount: 0,
  failedCount: 0,
  syncProgress: 0,
  syncErrors: [],
};

const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    startSync: (state) => { state.isSyncing = true; state.syncProgress = 0; state.syncErrors = []; },
    updateSyncProgress: (state, action: PayloadAction<number>) => { state.syncProgress = action.payload; },
    syncComplete: (state, action: PayloadAction<{ timestamp: string }>) => {
      state.isSyncing = false;
      state.lastSyncTime = action.payload.timestamp;
      state.syncProgress = 100;
    },
    syncFailed: (state, action: PayloadAction<string>) => {
      state.isSyncing = false;
      state.syncErrors.push(action.payload);
    },
    setPendingCount: (state, action: PayloadAction<number>) => { state.pendingCount = action.payload; },
    setFailedCount: (state, action: PayloadAction<number>) => { state.failedCount = action.payload; },
  },
});

export const {
  startSync, updateSyncProgress, syncComplete, syncFailed,
  setPendingCount, setFailedCount,
} = syncSlice.actions;
export default syncSlice.reducer;
