export type EditorSaveProgress = { percentage: number; detail: string };
export const savePercentage = (completed: number, total: number, start: number, end: number) => Math.round(start + (total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0) * (end - start));
