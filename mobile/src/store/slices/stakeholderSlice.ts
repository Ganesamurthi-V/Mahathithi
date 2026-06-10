import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface StakeholderState {
  searchResults: any[];
  searchPagination: { page: number; total: number; hasMore: boolean };
  currentStakeholder: any | null;
  searchFilters: Record<string, string>;
  isSearching: boolean;
}

const initialState: StakeholderState = {
  searchResults: [],
  searchPagination: { page: 1, total: 0, hasMore: false },
  currentStakeholder: null,
  searchFilters: {},
  isSearching: false,
};

const stakeholderSlice = createSlice({
  name: 'stakeholder',
  initialState,
  reducers: {
    setSearchResults: (state, action: PayloadAction<{ stakeholders: any[]; pagination: any }>) => {
      state.searchResults = action.payload.stakeholders;
      state.searchPagination = action.payload.pagination;
      state.isSearching = false;
    },
    appendSearchResults: (state, action: PayloadAction<{ stakeholders: any[]; pagination: any }>) => {
      state.searchResults = [...state.searchResults, ...action.payload.stakeholders];
      state.searchPagination = action.payload.pagination;
      state.isSearching = false;
    },
    setCurrentStakeholder: (state, action: PayloadAction<any>) => {
      state.currentStakeholder = action.payload;
    },
    setSearchFilters: (state, action: PayloadAction<Record<string, string>>) => {
      state.searchFilters = action.payload;
    },
    setSearching: (state, action: PayloadAction<boolean>) => {
      state.isSearching = action.payload;
    },
    clearSearch: (state) => {
      state.searchResults = [];
      state.searchPagination = { page: 1, total: 0, hasMore: false };
      state.searchFilters = {};
    },
    removeStakeholder: (state, action: PayloadAction<string>) => {
      state.searchResults = state.searchResults.filter(s => s.id !== action.payload);
    },
  },
});

export const {
  setSearchResults, appendSearchResults, setCurrentStakeholder,
  setSearchFilters, setSearching, clearSearch, removeStakeholder,
} = stakeholderSlice.actions;
export default stakeholderSlice.reducer;
