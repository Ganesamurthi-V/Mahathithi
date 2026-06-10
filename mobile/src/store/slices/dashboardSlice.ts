import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface DashboardState {
  stats: {
    completed: number;
    pending: number;
    inProgress: number;
    inReview: number;
    total: number;
  };
  isLoading: boolean;
}

const initialState: DashboardState = {
  stats: { completed: 0, pending: 0, inProgress: 0, inReview: 0, total: 0 },
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
