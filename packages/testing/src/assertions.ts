import type { ApiFailure, ApiResponse, ApiSuccess } from '@engloop/types';

export const expectSuccess = <T>(response: ApiResponse<T>): ApiSuccess<T> => {
  if (!response.success) {
    throw new Error(
      `Expected a success envelope but received ${response.error.code}: ${response.error.message}`,
    );
  }
  return response;
};

export const expectFailure = <T>(response: ApiResponse<T>, code?: string): ApiFailure => {
  if (response.success) {
    throw new Error('Expected a failure envelope but the request succeeded');
  }
  if (code && response.error.code !== code) {
    throw new Error(`Expected error code ${code} but received ${response.error.code}`);
  }
  return response;
};

/** Waits for a predicate to hold; used by queue/worker integration tests. */
export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 5_000, intervalMs = 50 } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
