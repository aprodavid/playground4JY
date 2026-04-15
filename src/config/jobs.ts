export const BASELINE_STAGES = ['idle', 'queued', 'pfc3', 'exfc5', 'finalize', 'success', 'error', 'stopped'] as const;
export const RIDE_STAGES = ['idle', 'queued', 'ride', 'success', 'error', 'stopped'] as const;

export const BASELINE_ZERO_ITEM_PAGE_LIMIT = 1;
export const BASELINE_INVOCATION_PAGE_BUDGET = 8;
