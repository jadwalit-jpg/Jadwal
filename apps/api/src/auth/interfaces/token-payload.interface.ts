export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  /**
   * Session-family id (M5/M6). Ties this access token to the refresh-token
   * family it was issued alongside, so logout / stolen-token-reuse can put the
   * family on a short-lived Redis denylist and JwtStrategy.validate() rejects any
   * still-unexpired access token for it. OPTIONAL: access tokens minted BEFORE
   * this rollout have no sid — they simply aren't denylist-checkable and expire
   * naturally (≤JWT_EXPIRATION), so the change is backward-compatible.
   */
  sid?: string;
}
