/**
 * Smoke test proving the jest-expo runner executes TypeScript tests,
 * including compile-time type-level assertions. The real contract tests
 * arrive in Task 8.2; this file only verifies the harness works.
 */

// Type-level assertion helpers (compile-time only, erased at runtime).
type Expect<T extends true> = T;
type Equal<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

// A trivial type-level assertion must compile under strict TS.
type _SanityTypeCheck = Expect<Equal<string, string>>;

describe('test harness smoke', () => {
  test('runs a trivial TypeScript assertion', () => {
    expect(true).toBe(true);
  });

  test('evaluates basic TypeScript expressions', () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(2, 3)).toBe(5);
  });
});
