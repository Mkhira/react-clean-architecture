import { VerifyProductCodeUseCase } from '../domain/usecases/VerifyProductCodeUseCase';
import { createProductVerificationError } from '../domain/errors/ProductVerificationError';
import { Result } from '@shared/types/Result';
import type { IProductVerificationRepository } from '../domain/IRepositories/IProductVerificationRepository';

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

    // TODO(claude): add one test per business rule:
    //   - code required, exactly 16 characters after trimming
});
