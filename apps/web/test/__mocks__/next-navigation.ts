export const __mock = {
  pathname: '/',
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
};

export function usePathname() {
  return __mock.pathname;
}

export function useRouter() {
  return {
    push: __mock.push,
    replace: __mock.replace,
    back: __mock.back,
    refresh: __mock.refresh,
    prefetch: __mock.prefetch,
  };
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return {};
}
