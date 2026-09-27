/**
 * Registers the DOM matchers for every unit test.
 *
 * `@testing-library/jest-dom` was already a dependency and nothing imported
 * it, so `toBeDisabled`, `toHaveAttribute` and the rest were silently invalid
 * Chai properties — an assertion that reads correctly and checks nothing. The
 * component tests are the first to need them.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom keeps the document between tests in the same file; without this a
// second render finds two of everything.
afterEach(cleanup)
