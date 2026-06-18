import axios from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';

// Change this to your backend URL
const API_BASE = 'https://mahathithi-test.up.railway.app/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach JWT
api.interceptors.request.use(async (config) => {
  try {
    const token = await EncryptedStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {}
  return config;
});

// Response interceptor — handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = await EncryptedStorage.getItem('refresh_token');
        if (refreshToken) {
          const res = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
          const { accessToken, refreshToken: newRefresh } = res.data.data.tokens;

          await EncryptedStorage.setItem('access_token', accessToken);
          await EncryptedStorage.setItem('refresh_token', newRefresh);

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Force logout
        await EncryptedStorage.removeItem('access_token');
        await EncryptedStorage.removeItem('refresh_token');
        await EncryptedStorage.removeItem('user_data');
      }
    }
    return Promise.reject(error);
  }
);

// ============================================================================
// API SERVICES
// ============================================================================

export const authService = {
  login: (loginId: string, password: string) =>
    api.post('/auth/login', { loginId, password }),
  logout: (refreshToken?: string) =>
    api.post('/auth/logout', { refreshToken }),
  getProfile: () => api.get('/auth/me'),
};

export const stakeholderService = {
  search: (params: Record<string, any>) =>
    api.get('/stakeholders/search', { params }),
  getById: (id: string) =>
    api.get(`/stakeholders/${id}`),
  getAssigned: (since?: string) =>
    api.get('/stakeholders/assigned', { params: { since } }),
  updateStakeholder: (id: string, data: any) =>
    api.patch(`/stakeholders/${id}`, data),
};

export const surveyService = {
  createOrUpdate: (data: any) =>
    api.post('/surveys', data),
  getByStakeholder: (stakeholderId: string) =>
    api.get(`/surveys/stakeholder/${stakeholderId}`),
  complete: (surveyId: string) =>
    api.post(`/surveys/${surveyId}/complete`),
  getMine: () =>
    api.get('/surveys/mine'),
};

export const mediaService = {
  upload: (formData: FormData) =>
    api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 2 min for large uploads
    }),
  getBySurvey: (surveyId: string) =>
    api.get(`/media/survey/${surveyId}`),
};

export const phoneValidationService = {
  create: (data: any) =>
    api.post('/phone-validation', data),
  getByStakeholder: (stakeholderId: string) =>
    api.get(`/phone-validation/stakeholder/${stakeholderId}`),
};

export const syncService = {
  upload: (data: any) =>
    api.post('/sync/upload', data),
  getChanges: (since?: string) =>
    api.get('/sync/changes', { params: { since } }),
};

export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
};

export default api;
