/** Shape of `request.user` after JwtAuthGuard validates the token. */
export interface RequestUser {
  id: string;
  email: string;
  role: string;
  fullName: string;
}
