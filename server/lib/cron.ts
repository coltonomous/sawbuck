import { CronExpressionParser } from 'cron-parser';

export function isValidCron(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

export function msUntilNext(expression: string): number {
  const parsed = CronExpressionParser.parse(expression);
  const next = parsed.next().toDate();
  return Math.max(0, next.getTime() - Date.now());
}
