import type { ContrastResult, WCAGLevel } from '@tummycrypt/tinyland-color-utils';

export const omuxBrandContrast = {
	background: '#faf6ef',
	foreground: '#1e2832',
	requiredLevel: 'AA',
} satisfies {
	background: string;
	foreground: string;
	requiredLevel: Extract<WCAGLevel, 'AA' | 'AAA'>;
};

export type OmuxBrandContrastResult = ContrastResult;
