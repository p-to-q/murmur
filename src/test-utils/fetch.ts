type FetchMockImplementation = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

export function createFetchMock(implementation: FetchMockImplementation): typeof fetch {
  return Object.assign(implementation, {
    preconnect() {},
  });
}
