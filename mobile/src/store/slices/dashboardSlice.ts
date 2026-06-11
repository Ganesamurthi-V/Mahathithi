import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface DashboardState {
  stats: {
    completed: number;
    open: number;
    total: number;
  };
  isLoading: boolean;
}

const initialState: DashboardState = {
  stats: { completed: 0, open: 0, total: 0 },
  isLoading: false,
};

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    setStats: (state, action: PayloadAction<any>) => {
      state.stats = action.payload;
      state.isLoading = false;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const { setStats, setLoading } = dashboardSlice.actions;
export default dashboardSlice.reducer;
