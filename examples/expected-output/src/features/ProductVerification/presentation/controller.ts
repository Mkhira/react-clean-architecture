import React from 'react';
import { useTranslation } from 'react-i18next';
import { createLogger } from '@core/logging/LoggerService';
import { useTheme } from '@core/theme/ThemeContext';
import { TOKENS } from '@core/di/tokens';
import { useResolve } from '@shared/hooks/useResolve';
import { Result } from '@shared/types/Result';
import type { VerifyProductCodeResult, VerifyProductCodeInput } from '../domain/entities/VerifyProductCodeResult';
import type { ProductVerificationError } from '../domain/errors/ProductVerificationError';
import { createStyles } from './styles';

const logger = createLogger('ProductVerification');

export function useController() {
    const verifyProductCodeUseCase = useResolve(TOKENS.VerifyProductCodeUseCase);
    // const { data: getScanHistoryResult } = useGetScanHistoryQuery(/* input */);
    const theme = useTheme();
    const styles = React.useMemo(() => createStyles(theme), [theme]);
    const { t } = useTranslation();
    const [result, setResult] = React.useState<VerifyProductCodeResult | null>(null);
    const [error, setError] = React.useState<ProductVerificationError | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);

    const verifyProductCode = React.useCallback(async (input: VerifyProductCodeInput) => {
        setIsLoading(true);
        setError(null);
        const outcome = await verifyProductCodeUseCase.execute(input);
        if (Result.isOk(outcome)) {
            setResult(outcome.data);
        } else {
            // third arg = data → shows in the console (the second only reaches crash reporting)
            logger.error('verifyProductCode failed', outcome.error, outcome.error);
            setError(outcome.error);
        }
        setIsLoading(false);
    }, [verifyProductCodeUseCase]);

    return { styles, t, theme, result, error, isLoading, verifyProductCode };
}
