/**
 * @jest-environment node
 */

import { createCreditService } from "../lib/credits/service";

function repositoryStub(overrides = {}) {
  return {
    getWallet: jest.fn(async () => ({ totalPoints: 100 })),
    consume: jest.fn(async () => ({ allowed: true, wallet: { totalPoints: 99 } })),
    refreshSubscription: jest.fn(async () => ({ ok: true })),
    grantPurchased: jest.fn(async () => ({ ok: true })),
    refund: jest.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("credit service feature gates", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.CREDITS_ENABLED;
    delete process.env.CREDITS_ENFORCEMENT_ENABLED;
    delete process.env.NEXT_PUBLIC_CREDITS_ENABLED;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  test("disabled mode bypasses charging without touching the repository", async () => {
    const repository = repositoryStub();
    const service = createCreditService(repository);

    const result = await service.charge({
      userCode: "ABC123",
      action: "ai_grading",
      idempotencyKey: "grading:req-1",
    });

    expect(result).toMatchObject({ enabled: false, enforcementEnabled: false, charged: false, bypassed: true, points: 1 });
    expect(repository.consume).not.toHaveBeenCalled();
  });

  test("infrastructure-only mode remains non-blocking", async () => {
    process.env.CREDITS_ENABLED = "true";
    process.env.CREDITS_ENFORCEMENT_ENABLED = "false";
    const repository = repositoryStub();
    const service = createCreditService(repository);

    const result = await service.charge({
      userCode: "ABC123",
      action: "speech_transcription",
      usage: { seconds: 31 },
      idempotencyKey: "speech:req-1",
    });

    expect(result).toMatchObject({ enabled: true, enforcementEnabled: false, bypassed: true, points: 2 });
    expect(repository.consume).not.toHaveBeenCalled();
  });

  test("enforcement mode delegates an idempotent charge to the atomic repository", async () => {
    process.env.CREDITS_ENABLED = "true";
    process.env.CREDITS_ENFORCEMENT_ENABLED = "true";
    const repository = repositoryStub();
    const service = createCreditService(repository);

    const result = await service.charge({
      userCode: "abc123",
      action: "ai_grading",
      idempotencyKey: "grading:req-2",
      metadata: { task: "email" },
    });

    expect(result.charged).toBe(true);
    expect(repository.consume).toHaveBeenCalledWith({
      userCode: "ABC123",
      points: 1,
      action: "ai_grading",
      idempotencyKey: "grading:req-2",
      metadata: { task: "email" },
    });
  });

  test("an insufficient balance is returned without claiming a charge", async () => {
    process.env.CREDITS_ENABLED = "true";
    process.env.CREDITS_ENFORCEMENT_ENABLED = "true";
    const repository = repositoryStub({ consume: jest.fn(async () => ({ allowed: false, requiredPoints: 1 })) });
    const service = createCreditService(repository);

    const result = await service.charge({
      userCode: "ABC123",
      action: "ai_grading",
      idempotencyKey: "grading:req-3",
    });

    expect(result.charged).toBe(false);
    expect(result.result.allowed).toBe(false);
  });

  test("planned actions cannot consume points when enforcement is on", async () => {
    process.env.CREDITS_ENABLED = "true";
    process.env.CREDITS_ENFORCEMENT_ENABLED = "true";
    const repository = repositoryStub();
    const service = createCreditService(repository);

    await expect(service.charge({
      userCode: "ABC123",
      action: "user_bank_openai_tts",
      usage: { seconds: 30 },
      idempotencyKey: "tts:req-1",
    })).rejects.toMatchObject({ code: "CREDITS_ACTION_NOT_READY" });
    expect(repository.consume).not.toHaveBeenCalled();
  });

  test("wallet reads are also inert while infrastructure is disabled", async () => {
    const repository = repositoryStub();
    const result = await createCreditService(repository).getBalance("ABC123");
    expect(result).toEqual({ enabled: false, enforcementEnabled: false, wallet: null });
    expect(repository.getWallet).not.toHaveBeenCalled();
  });

  test("grants cannot mutate a wallet until infrastructure is enabled", async () => {
    const service = createCreditService(repositoryStub());
    await expect(service.grantPurchased({
      userCode: "ABC123",
      points: 50,
      idempotencyKey: "purchase:order-1",
    })).rejects.toMatchObject({ code: "CREDITS_DISABLED" });
  });
});
