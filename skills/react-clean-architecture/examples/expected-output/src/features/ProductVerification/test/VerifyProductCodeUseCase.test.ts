import { VerifyProductCodeUseCase } from '../domain/usecases/VerifyProductCodeUseCase';
import { createProductVerificationError } from '../domain/errors/ProductVerificationError';
import { Result } from '@shared/types/Result';
import type { IProductVerificationRepository } from '../domain/IRepositories/IProductVerificationRepository';

// several shared utils import the @shared/components barrel, which drags
// native-only modules into jest — mock it so hand-written rules can reuse
// shared utils (digitNormalization, regex, …) without breaking the suite
jest.mock('@shared/components', () => ({}));

const makeRepository = (overrides: Partial<IProductVerificationRepository> = {}): IProductVerificationRepository =>
    ({
        verifyProductCode: jest.fn().mockResolvedValue({} as never),
        ...overrides,
    }) as IProductVerificationRepository;

describe('VerifyProductCodeUseCase', () => {
    it('returns ok when the repository succeeds', async () => {
        const useCase = new VerifyProductCodeUseCase(makeRepository());

        const outcome = await useCase.execute({ scanCode: "1234567890123456", scanCustomerId: 1 });

        expect(Result.isOk(outcome)).toBe(true);
    });

    it('returns the feature error when the repository throws one', async () => {
        const repository = makeRepository({
            verifyProductCode: jest.fn().mockRejectedValue(createProductVerificationError('NETWORK_ERROR', 'boom')),
        } as Partial<IProductVerificationRepository>);
        const useCase = new VerifyProductCodeUseCase(repository);

        const outcome = await useCase.execute({ scanCode: "1234567890123456", scanCustomerId: 1 });

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('NETWORK_ERROR');
        }
    });

    it('classifies a 401 rejection as AUTH_ERROR', async () => {
        const repository = makeRepository({
            verifyProductCode: jest.fn().mockRejectedValue({ response: { status: 401 } }),
        } as Partial<IProductVerificationRepository>);
        const useCase = new VerifyProductCodeUseCase(repository);

        const outcome = await useCase.execute({ scanCode: "1234567890123456", scanCustomerId: 1 });

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('AUTH_ERROR');
        }
    });

    it('classifies an aborted request as TIMEOUT', async () => {
        const repository = makeRepository({
            verifyProductCode: jest.fn().mockRejectedValue({ code: 'ECONNABORTED' }),
        } as Partial<IProductVerificationRepository>);
        const useCase = new VerifyProductCodeUseCase(repository);

        const outcome = await useCase.execute({ scanCode: "1234567890123456", scanCustomerId: 1 });

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('TIMEOUT');
        }
    });

    // TODO(claude): add one test per business rule:
    //   - code required, exactly 16 characters after trimming
});
