import { configureStore } from '@reduxjs/toolkit';
import authSlice from './slices/authSlice';
import stakeholderSlice from './slices/stakeholderSlice';
import surveySlice from './slices/surveySlice';
import syncSlice from './slices/syncSlice';
import dashboardSlice from './slices/dashboardSlice';

export const store = configureStore({
  reducer: {
    auth: authSlice,
    stakeholder: stakeholderSlice,
    survey: surveySlice,
    sync: syncSlice,
    dashboard: dashboardSlice,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
