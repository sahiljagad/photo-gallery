import '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom implements neither of these, and both are called on every route
// change. Without stubs the suite passes but buries real failures under
// hundreds of lines of "Not implemented" stack traces.
window.scrollTo = () => {};

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
