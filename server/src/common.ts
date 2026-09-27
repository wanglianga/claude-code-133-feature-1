export function now(): string {
  return new Date().toISOString();
}

export function todayCode(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

let seqMap: Record<string, number> = {};
export function seqCode(prefix: string): string {
  const key = `${prefix}-${todayCode()}`;
  seqMap[key] = (seqMap[key] || 0) + 1;
  return `${prefix}${todayCode()}-${String(seqMap[key]).padStart(3, '0')}`;
}

export const YUAN = 100;

export const TICKET_UNIT_PRICE: Record<string, number> = {
  single: 20 * YUAN,
  loop: 35 * YUAN,
  parent_child: 30 * YUAN,
  accessible_priority: 20 * YUAN,
};

export const TICKET_TYPE_LABEL: Record<string, string> = {
  single: '单程票',
  loop: '环线票',
  parent_child: '亲子票',
  accessible_priority: '无障碍优先票',
};

export function ticketPrice(type: string, partySize: number): number {
  return (TICKET_UNIT_PRICE[type] || 20 * YUAN) * partySize;
}

export function fen(n: number): string {
  return (n / 100).toFixed(2);
}

export function waitSeconds(a: string, b: string = now()): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
}
