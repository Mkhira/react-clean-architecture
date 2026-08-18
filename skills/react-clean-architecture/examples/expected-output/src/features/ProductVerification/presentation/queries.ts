/**
 * ProductVerification — React Query bindings.
 *
 * The presentation layer owns all server-state hooks; each hook resolves its
 * use case through DI and unwraps the Result so react-query owns error state.
 */

import QUERIES_KEYS from '@data/services/keys';
import { useApiQuery } from '@shared/hooks/useApiQuery';
import { useResolve } from '@shared/hooks/useResolve';
import { TOKENS } from '@core/di/tokens';
import { Result } from '@shared/types/Result';
import type { GetScanHistoryInput } from '../domain/entities/GetScanHistoryResult';

export const useGetScanHistoryQuery = (input: GetScanHistoryInput, options?: { enabled?: boolean }) => {
    const getScanHistoryUseCase = useResolve(TOKENS.GetScanHistoryUseCase);

    return useApiQuery(
        [QUERIES_KEYS.PRODUCT_VERIFICATION_GET_SCAN_HISTORY, input],
        async () => {
            const outcome = await getScanHistoryUseCase.execute(input);
            if (Result.isErr(outcome)) throw outcome.error;
            return outcome.data;
        },
        { enabled: options?.enabled ?? true }
    );
};
