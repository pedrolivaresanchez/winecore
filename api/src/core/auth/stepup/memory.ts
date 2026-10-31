import { clearChallenges } from './challenges';
import { clearRateLimits } from './rate-limit';
import { clearPendingTotp } from './totp';

/** Drops in-memory challenges, lockouts and TOTP enrollments. Tests only. */
export function clearAuthEphemeralState(): void {
  clearChallenges();
  clearRateLimits();
  clearPendingTotp();
}
