import { GetScanHistoryUseCase } from '../domain/use-cases/GetScanHistoryUseCase';
import { createProductVerificationError } from '../domain/errors/ProductVerificationError';
import { Result } from '@shared/types/Result';
import type { IProductVerificationRepository } from '../domain/repositories/IProductVerificationRepository';

// several shared utils import the @shared/components barrel, which drags
// native-only modules into jest — mock it so hand-written rules can reuse
// shared utils (digitNormalization, regex, …) without breaking the suite
jest.mock('@shared/components', () => ({}));

const makeRepository = (overrides: Partial<IProductVerificationRepository> = {}): IProductVerificationRepository =>
    ({
        getScanHistory: jest.fn().mockResolvedValue({} as never),
        ...overrides,
    }) as IProductVerificationRepository;

describe('GetScanHistoryUseCase', () => {
    it('returns ok when the repository succeeds', async () => {
        const useCase = new GetScanHistoryUseCase(makeRepository());

        const outcome = await useCase.execute({ from: 'value' });

        expect(Result.isOk(outcome)).toBe(true);
    });

    it('returns the feature error when the repository throws one', async () => {
        const repository = makeRepository({
            getScanHistory: jest.fn().mockRejectedValue(createProductVerificationError('NETWORK_ERROR', 'boom')),
        } as Partial<IProductVerificationRepository>);
        const useCase = new GetScanHistoryUseCase(repository);

        const outcome = await useCase.execute({ from: 'value' });

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('NETWORK_ERROR');
        }
    });

    it('classifies a 401 rejection as AUTH_ERROR', async () => {
        const repository = makeRepository({
            getScanHistory: jest.fn().mockRejectedValue({ response: { status: 401 } }),
        } as Partial<IProductVerificationRepository>);
        const useCase = new GetScanHistoryUseCase(repository);

        const outcome = await useCase.execute({ from: 'value' });

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('AUTH_ERROR');
        }
    });

    it('classifies an aborted request as TIMEOUT', async () => {
        const repository = makeRepository({
            getScanHistory: jest.fn().mockRejectedValue({ code: 'ECONNABORTED' }),
        } as Partial<IProductVerificationRepository>);
        const useCase = new GetScanHistoryUseCase(repository);

        const outcome = await useCase.execute({ from: 'value' });

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('TIMEOUT');
        }
    });
});
