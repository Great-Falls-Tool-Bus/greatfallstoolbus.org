import { createToaster } from '@skeletonlabs/skeleton-svelte';

// Shared Skeleton/Zag toast store. The layout owns the single <Toast.Group>.
export const toaster = createToaster({ placement: 'bottom-end' });
