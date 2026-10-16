import type { StatusCategory } from '../../../../src/shared/contract';

export function StatusLozenge({ status, category }: { status: string; category: StatusCategory }) {
  return <span className={`lozenge lozenge-${category}`}>{status}</span>;
}
