import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (loginId: string, password: string) => {
  console.log('--- ADMIN LOGIN REQUEST STARTED ---');
  console.log(`URL: ${api.defaults.baseURL || API_BASE}/auth/login`);
  console.log(`Method: POST`);
  console.log(`Payload:`, { loginId, password: '***' }); // hiding password in logs for security
  return api.post('/auth/login', { loginId, password })
    .then(res => {
      console.log('--- ADMIN LOGIN SUCCESS ---');
      console.log('Response Status:', res.status);
      console.log('Response Data:', res.data);
      return res;
    })
    .catch(err => {
      console.log('--- ADMIN LOGIN FAILED ---');
      console.log('Error:', err.message);
      if (err.response) {
        console.log('Response Status:', err.response.status);
        console.log('Response Data:', err.response.data);
      }
      throw err;
    });
};

export const getProfile = () => api.get('/auth/me');

// Admin - Enumerators
export const getEnumerators = () => api.get('/admin/enumerators');
export const createEnumerator = (data: any) => api.post('/admin/enumerators', data);
export const updateEnumerator = (id: string, data: any) => api.patch(`/admin/enumerators/${id}`, data);
export const deleteEnumerator = (id: string) => api.delete(`/admin/enumerators/${id}`);
export const assignDistricts = (id: string, districtIds: string[]) =>
  api.put(`/admin/enumerators/${id}/districts`, { districtIds });

// Admin - Districts
export const getDistricts = () => api.get('/admin/districts');

// Admin - Analytics
export const getAnalytics = () => api.get('/admin/analytics');

// Admin - Audit Logs
export const getAuditLogs = (params?: any) => api.get('/admin/audit-logs', { params });

// Dashboard
export const getDashboardStats = () => api.get('/dashboard/stats');

// Stakeholders
export const searchStakeholders = (params: any) => api.get('/stakeholders/search', { params });
export const getStakeholderById = (id: string) => api.get(`/stakeholders/${id}`);
export const updateStakeholder = (id: string, data: any) => api.patch(`/stakeholders/${id}`, data);

// Surveys
export const getSurveyByStakeholder = (stakeholderId: string) =>
  api.get(`/surveys/stakeholder/${stakeholderId}`);

// Media
export const getMediaBySurvey = (surveyId: string) => api.get(`/media/survey/${surveyId}`);

export default api;
