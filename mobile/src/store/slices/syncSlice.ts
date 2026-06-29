import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SyncState {
  isSyncing: boolean;
  lastSyncTime: string | null;
  pendingCount: number;
  failedCount: number;
  // SYNC FIX: items that exhausted automatic retries and need a manual
  // "reset and retry" action, kept distinct from failedCount (which now means
  // "still retrying automatically in the background") so the failed badge
  // doesn't look alarming for something that's self-healing.
  deadLetterCount: number;
  syncProgress: number;
  syncErrors: string[];
  
  // Initial Sync State
  isInitialSyncing: boolean;
  initialSyncProgress: number;
  initialSyncMessage: string;
  initialSyncError: string | null;
}

const initialState: SyncState = {
  isSyncing: false,
  lastSyncTime: null,
  pendingCount: 0,
  failedCount: 0,
  deadLetterCount: 0,
  syncProgress: 0,
  syncErrors: [],
  
  isInitialSyncing: false,
  initialSyncProgress: 0,
  initialSyncMessage: '',
  initialSyncError: null,
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
    setDeadLetterCount: (state, action: PayloadAction<number>) => { state.deadLetterCount = action.payload; },
    
    // Initial Sync Reducers
    startInitialSync: (state) => {
      state.isInitialSyncing = true;
      state.initialSyncProgress = 0;
      state.initialSyncMessage = 'Starting download...';
      state.initialSyncError = null;
    },
    updateInitialSyncProgress: (state, action: PayloadAction<{ progress: number, message: string }>) => {
      state.initialSyncProgress = action.payload.progress;
      state.initialSyncMessage = action.payload.message;
    },
    initialSyncComplete: (state) => {
      state.isInitialSyncing = false;
      state.initialSyncProgress = 100;
      state.initialSyncMessage = 'Complete!';
    },
    initialSyncFailed: (state, action: PayloadAction<string>) => {
      // Intentionally NOT setting isInitialSyncing to false here so the modal stays open with the error and retry button
      state.initialSyncError   = action.payload;
    },
  },
});

export const {
  startSync, updateSyncProgress, syncComplete, syncFailed,
  setPendingCount, setFailedCount, setDeadLetterCount,
  startInitialSync, updateInitialSyncProgress, initialSyncComplete, initialSyncFailed
} = syncSlice.actions;
export default syncSlice.reducer;