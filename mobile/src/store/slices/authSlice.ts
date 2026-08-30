import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import EncryptedStorage from 'react-native-encrypted-storage';
import { authService, ensureFreshToken } from '../../services/api';
import { clearAllData } from '../../database';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: {
    id: string;
    loginId: string;
    name: string;
    isAdmin: boolean;
    districts: { id: string; name: string; state: string }[];
  } | null;
  error: string | null;
}

const initialState: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  user: null,
  error: null,
};

/**
 * Restore the session on app launch.
 *
 * The presence of a stored token and profile is what defines "signed in" — NOT
 * whether that token is currently valid. This matters for two reasons:
 *
 *   1. Enumerators work offline for long stretches. Requiring a successful
 *      network call here would lock them out of their own local data.
 *   2. An expired access token is a routine, recoverable state, not a signed-out
 *      one. The refresh token is what actually governs the session, and it now
 *      slides forward on every use (see auth.service.ts).
 *
 * We kick off a proactive renewal so the burst of requests that follows
 * authentication (initial sync, realtime, dashboard) starts with a live token
 * instead of a stale one. It is awaited so those requests do not race it, but a
 * failure is ignored: offline or server-down must not prevent restoring the
 * session.
 */
export const checkSession = createAsyncThunk('auth/checkSession', async () => {
  const token = await EncryptedStorage.getItem('access_token');
  const userData = await EncryptedStorage.getItem('user_data');

  if (token && userData) {
    // Best-effort; ensureFreshToken never throws and never signs anyone out.
    await ensureFreshToken();
    return JSON.parse(userData);
  }
  throw new Error('No session');
});

// Login
export const login = createAsyncThunk(
  'auth/login',
  async ({ loginId, password }: { loginId: string; password: string }, { rejectWithValue }) => {
    try {
      const response = await authService.login(loginId, password);
      const { tokens, enumerator } = response.data.data;

      // Store tokens securely
      await EncryptedStorage.setItem('access_token', tokens.accessToken);
      await EncryptedStorage.setItem('refresh_token', tokens.refreshToken);
      await EncryptedStorage.setItem('user_data', JSON.stringify(enumerator));
      // Cache credentials for offline login
      await EncryptedStorage.setItem('cached_login_id', loginId);
      await EncryptedStorage.setItem('cached_password', password);

      return enumerator;
    } catch (err: any) {
      // If offline — try cached credentials
      if (err.message === 'Network Error' || err.code === 'ECONNABORTED') {
        try {
          const cachedLoginId = await EncryptedStorage.getItem('cached_login_id');
          const cachedPassword = await EncryptedStorage.getItem('cached_password');
          const userData = await EncryptedStorage.getItem('user_data');

          if (cachedLoginId === loginId && cachedPassword === password && userData) {
            // Credentials match cached — allow offline login
            return JSON.parse(userData);
          }
        } catch {}
        return rejectWithValue('Unable to connect to the server. Please check your internet connection and try again.');
      }

      if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
        return rejectWithValue(err.response.data.error.message);
      }
      if (err.response && err.response.status === 401) {
        return rejectWithValue('Invalid login credentials');
      } else if (err.response && err.response.status >= 500) {
        return rejectWithValue('The server is experiencing issues. Please try again later.');
      }
      return rejectWithValue('An unexpected error occurred during login. Please try again.');
    }
  }
);

// Logout
//
// DATA-LOSS FIX: this thunk is dispatched both by the user tapping "log out" and
// by the `force_logout` event the axios interceptor emits when a token refresh
// is rejected with 401/403 (expired refresh token after idle, revoked session,
// rotated JWT secret). It previously called clearAllData() with no argument,
// which deleted every survey, photo and video on the device — including work
// that had not yet been uploaded.
//
// clearAllData() now defaults to preserving unsynced survey/media rows and the
// sync_queue entries needed to push them, while still clearing the cached
// stakeholder dataset and session state. Pending work resumes on next login.
// Pass `true` only from a deliberate, user-confirmed "discard local data" flow.
export const logout = createAsyncThunk<void, boolean | undefined>('auth/logout', async (discardLocalData) => {
  try {
    const refreshToken = await EncryptedStorage.getItem('refresh_token');
    await authService.logout(refreshToken || undefined);
  } catch (e) {
    // Continue with local logout even if API fails
  }
  await EncryptedStorage.removeItem('access_token');
  await EncryptedStorage.removeItem('refresh_token');
  await EncryptedStorage.removeItem('user_data');
  await EncryptedStorage.removeItem('cached_login_id');
  await EncryptedStorage.removeItem('cached_password');

  await clearAllData(discardLocalData === true);
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkSession.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(checkSession.fulfilled, (state, action) => {
        state.isAuthenticated = true;
        state.user = action.payload;
        state.isLoading = false;
      })
      .addCase(checkSession.rejected, (state) => {
        state.isAuthenticated = false;
        state.isLoading = false;
      })
      .addCase(login.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.isAuthenticated = true;
        state.user = action.payload;
        state.isLoading = false;
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading = false;
        // Use the custom message from rejectWithValue if available
        state.error = (action.payload as string) || action.error.message || 'Login failed. Please try again.';
      })
      .addCase(logout.fulfilled, (state) => {
        state.isAuthenticated = false;
        state.user = null;
      });
  },
});

export const { clearError } = authSlice.actions;
export default authSlice.reducer;
