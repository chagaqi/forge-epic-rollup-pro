import type { ExportFile, ResolverData, ResolverKey, Result } from '../../../src/shared/contract';

export interface UiContext {
  moduleType: 'issuePanel' | 'projectPage';
  issueKey: string | null;
  projectKey: string | null;
  timezone: string | null;
}

/** Everything the UI needs from its host: Forge bridge in Jira, the simulator in the playground. */
export interface Transport {
  getContext(): Promise<UiContext>;
  invoke<K extends ResolverKey>(key: K, payload?: Record<string, unknown>): Promise<Result<ResolverData[K]>>;
}

export function downloadFile(file: ExportFile): void {
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
