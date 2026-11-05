/**
 * Warning (doc 12): issue() and cancel() as plain functions over the shared Warning
 * shape. Class A = reclaim control (R28.1), Class B = driver disengagement (R28.2).
 * Ids come from the owning HFDS instance so every run numbers them the same way
 * (determinism). Class B escalation (R29–R31) is added in M4.
 */
import type { AlertLevel, Warning, WarningClass, WarningReason } from '../../shared/domain';

export function issueWarning(
  id: number,
  warningClass: WarningClass,
  reason: WarningReason,
  message: string,
  t: number,
  reqs: string[],
  level: AlertLevel | null = null,
): Warning {
  return { id, warningClass, level, reason, message, issuedAt: t, isActive: true, reqs };
}

export function cancelWarning(w: Warning): Warning {
  return { ...w, isActive: false };
}
