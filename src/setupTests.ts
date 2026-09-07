// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

// jsdom (jest's default test environment) doesn't implement these standard Web APIs, unlike every
// real target browser, so tests need Node's equivalents instead of a jsdom-specific rewrite.
if (typeof globalThis.TextEncoder === "undefined") {
    const { TextEncoder, TextDecoder } = require("util");
    Object.assign(globalThis, { TextEncoder, TextDecoder });
}
