import { SetMetadata } from '@nestjs/common';

/**
 * Marks an HTTP endpoint as intentionally public — bypasses the globally-
 * registered `JwtAuthGuard` for this route. Used for auth flows (login,
 * register, OAuth callbacks), unauthenticated catalog/availability reads,
 * webhook receivers (PAY2M, Resend), and operational endpoints (/health).
 *
 * Default posture after this decorator + the global guard land together:
 * every endpoint requires JWT authentication unless it carries `@Public()`.
 * The previous "public by default, opt-in to auth via `@UseGuards(JwtAuthGuard)`"
 * model was fail-open — any new endpoint that the developer forgot to guard
 * would ship as publicly accessible. The new model is fail-closed.
 *
 * Belt-and-suspenders posture: every controller that requires auth still
 * keeps its existing `@UseGuards(JwtAuthGuard)` (or
 * `@UseGuards(JwtAuthGuard, RolesGuard)`) declarations. The per-controller
 * guard becomes redundant with the global guard but provides a second
 * line of defense if the global registration is ever accidentally removed
 * by a refactor.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
