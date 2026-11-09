import { SetMetadata } from '@nestjs/common';
export const REQUIRED_FEATURE_KEY = 'fsb:required-feature';
export const RequiresFeature = (feature: string) => SetMetadata(REQUIRED_FEATURE_KEY, feature);
