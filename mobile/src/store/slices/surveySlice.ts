import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SurveyState {
  currentSurvey: any | null;
  photos: any[];
  video: any | null;
  phoneVerification: any | null;
  gpsData: { latitude: number; longitude: number; accuracy: number } | null;
  isDirty: boolean;
}

const initialState: SurveyState = {
  currentSurvey: null,
  photos: [],
  video: null,
  phoneVerification: null,
  gpsData: null,
  isDirty: false,
};

const surveySlice = createSlice({
  name: 'survey',
  initialState,
  reducers: {
    setCurrentSurvey: (state, action: PayloadAction<any>) => {
      state.currentSurvey = action.payload;
    },
    updateSurveyField: (state, action: PayloadAction<{ field: string; value: any }>) => {
      if (state.currentSurvey) {
        state.currentSurvey[action.payload.field] = action.payload.value;
        state.isDirty = true;
      }
    },
    addPhoto: (state, action: PayloadAction<any>) => {
      if (state.photos.length < 5) {
        state.photos.push(action.payload);
        state.isDirty = true;
      }
    },
    removePhoto: (state, action: PayloadAction<number>) => {
      state.photos.splice(action.payload, 1);
      state.isDirty = true;
    },
    setVideo: (state, action: PayloadAction<any>) => {
      state.video = action.payload;
      state.isDirty = true;
    },
    setPhoneVerification: (state, action: PayloadAction<any>) => {
      state.phoneVerification = action.payload;
    },
    setGpsData: (state, action: PayloadAction<{ latitude: number; longitude: number; accuracy: number }>) => {
      state.gpsData = action.payload;
    },
    resetSurvey: (state) => {
      state.currentSurvey = null;
      state.photos = [];
      state.video = null;
      state.phoneVerification = null;
      state.gpsData = null;
      state.isDirty = false;
    },
  },
});

export const {
  setCurrentSurvey, updateSurveyField, addPhoto, removePhoto,
  setVideo, setPhoneVerification, setGpsData, resetSurvey,
} = surveySlice.actions;
export default surveySlice.reducer;
