type WaitForOptions = {
  timeout?: number;
  interval?: number;
  message?: string;
};

export async function waitFor<T>(
  fn: () => T | Promise<T>,
  options: WaitForOptions = {}
): Promise<T> {
  const timeout = options.timeout ?? 5000;
  const interval = options.interval ?? 50;
  const start = Date.now();

  while (true) {
    const result = await fn();
    if (result) return result;

    if (Date.now() - start > timeout) {
      throw new Error(options.message || 'Timeout waiting for condition');
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function waitForValue<T>(
  fn: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  options: WaitForOptions = {}
): Promise<T> {
  const timeout = options.timeout ?? 5000;
  const interval = options.interval ?? 50;
  const start = Date.now();

  while (true) {
    const value = await fn();
    if (predicate(value)) return value;

    if (Date.now() - start > timeout) {
      throw new Error(options.message || 'Timeout waiting for value');
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
