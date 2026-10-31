import { Service, signal } from '@angular/core';

@Service()
export class ProjectActions {
  private readonly exportRequests = signal(0);
  private readonly openRequests = signal(0);

  readonly task = signal<'export' | 'import' | null>(null);
  readonly canExport = signal(false);
  readonly downloadsBusy = signal(false);
  readonly exportRequest = this.exportRequests.asReadonly();
  readonly openRequest = this.openRequests.asReadonly();

  requestExport(): void {
    if (!this.canExport() || this.task() !== null || this.downloadsBusy()) {
      return;
    }
    this.exportRequests.update((count) => count + 1);
  }

  requestOpen(): void {
    if (this.task() !== null || this.downloadsBusy()) {
      return;
    }
    this.openRequests.update((count) => count + 1);
  }
}
