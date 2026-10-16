import { privacy } from '@forge/api';
import { kvsStore } from '../storage/kvsStore';
import { runPersonalDataReport } from './personalData';

/** Weekly scheduled trigger (manifest: personal-data-report). */
export async function reportPersonalData(): Promise<void> {
  const summary = await runPersonalDataReport(kvsStore, (accounts) => privacy.reportPersonalData(accounts), new Date());
  console.log(`Personal data report: ${summary.reported} accounts reported, ${summary.closed.length} closed, ${summary.entriesCleaned} entries erased`);
}
