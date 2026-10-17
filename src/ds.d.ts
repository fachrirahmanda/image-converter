// Basis design system, loaded at runtime from VITE_DS_URL (see index.html).
// Optional because the app should keep working if the script fails to load.
interface Window {
  DS?: {
    version: string;
    getTheme(): 'light' | 'dark' | 'system';
    setTheme(theme: 'light' | 'dark' | 'system', persist?: boolean): void;
    syncRange(input?: HTMLInputElement): void;
    openDialog(target: string | HTMLDialogElement): HTMLDialogElement | null;
    closeDialog(target: string | HTMLDialogElement, returnValue?: string): void;
    selectTab(tab: HTMLElement): void;
    toast(message: string, options?: {
      variant?: 'info' | 'success' | 'warning' | 'danger';
      duration?: number;
      action?: { label: string; onClick: () => void };
    }): { dismiss(): void };
  };
}
