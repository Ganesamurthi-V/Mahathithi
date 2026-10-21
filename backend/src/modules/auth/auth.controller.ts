import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError } from '../../utils/errors';
import { config } from '../../config';

const authService = new AuthService();

// ============================================================================
// ADMIN PANEL COOKIE SESSION
// ============================================================================
// The admin panel is a browser SPA and authenticates by cookie, not by an
// Authorization header (see authMiddleware, which falls back to
// req.cookies.admin_session). Two cookies are involved:
//
//   admin_session — the short-lived ACCESS token (15 min)
//   admin_refresh — the long-lived REFRESH token
//
// WHY admin_refresh IS NEW, AND WHY THE PANEL USED TO LOG ITSELF OUT
// Login set only admin_session, with maxAge tied to the 15-minute access token.
// The refresh token was returned in the JSON body, but LoginPage reads just
// `enumerator` from that response and drops `tokens` on the floor. /auth/refresh
// required the refresh token in the request body and never set a cookie. So the
// panel had no refresh token, no way to send one, and no way to renew the cookie:
// exactly 15 minutes after signing in, every request 401'd, App.tsx's
// getProfile().catch() left `user` as null, and the operator was bounced to the
// login screen mid-task.
//
// Storing the refresh token in an httpOnly cookie (rather than localStorage)
// keeps it unreadable to JavaScript, so an XSS bug in the panel cannot exfiltrate
// it, and it survives a full page reload.
//
// sameSite:'none' + secure:true are required because the panel (Vercel) and the
// API (Railway) are on different domains; a cross-site cookie must be Secure.
const COOKIE_BASE = {
  httpOnly: true,
  secure: true,          // required whenever sameSite is 'none'
  sameSite: 'none' as const,
  path: '/',
};

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000; // mirrors JWT_ACCESS_EXPIRY

function setSessionCookies(res: Response, accessToken: string, refreshToken?: string): void {
  res.cookie('admin_session', accessToken, {
    ...COOKIE_BASE,
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });

  // Only set when we actually have one. The refresh endpoint is non-rotating and
  // returns the same token back, so re-setting it simply extends the browser-side
  // expiry in step with the server-side sliding session.
  if (refreshToken) {
    res.cookie('admin_refresh', refreshToken, {
      ...COOKIE_BASE,
      maxAge: config.jwt.sessionExpiryDays * 24 * 60 * 60 * 1000,
    });
  }
}

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { loginId, password } = req.body;

      if (!loginId || !password) {
        throw new ValidationError('Login ID and password are required');
      }

      const result = await authService.login(
        loginId,
        password,
        req.headers['user-agent'],
        req.ip
      );

      setSessionCookies(res, result.tokens.accessToken, result.tokens.refreshToken);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Accept the token from either transport:
      //   • request body  — the mobile app, which holds tokens in EncryptedStorage
      //   • admin_refresh cookie — the browser panel, which cannot read httpOnly
      //     cookies from JavaScript and so cannot put the value in a body
      const bodyToken = req.body?.refreshToken;
      const cookieToken = req.cookies?.admin_refresh;
      const refreshToken = bodyToken || cookieToken;

      if (!refreshToken) {
        throw new ValidationError('Refresh token is required');
      }

      const tokens = await authService.refreshToken(refreshToken);

      // Re-issue the cookies whenever the caller was cookie-based, so the browser
      // gets a fresh 15-minute access cookie. Skipped for body-based (mobile)
      // callers, which have no use for Set-Cookie.
      if (cookieToken) {
        setSessionCookies(res, tokens.accessToken, tokens.refreshToken);
      }

      res.json({
        success: true,
        data: { tokens },
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // Prefer the cookie so a browser logout actually invalidates the server-side
      // session. Without this the panel cleared its cookies while the session row
      // stayed valid, leaving a usable refresh token behind.
      const refreshToken = req.body?.refreshToken || req.cookies?.admin_refresh;
      await authService.logout(req.enumerator!.id, refreshToken);

      // clearCookie must repeat the attributes the cookie was set with, or the
      // browser treats it as a different cookie and leaves the original in place.
      res.clearCookie('admin_session', COOKIE_BASE);
      res.clearCookie('admin_refresh', COOKIE_BASE);

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await authService.getProfile(req.enumerator!.id);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }
}
