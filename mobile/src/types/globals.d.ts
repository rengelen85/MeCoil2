// React Native provides atob/btoa at runtime via Hermes polyfills.
// TypeScript's RN preset doesn't include the DOM lib, so declare them here.
declare function atob(data: string): string;
declare function btoa(data: string): string;
