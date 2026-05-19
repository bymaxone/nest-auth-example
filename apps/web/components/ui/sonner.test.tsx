/**
 * @fileoverview Unit tests for the `Toaster` component wrapper.
 *
 * Verifies that the Toaster mounts without errors. The underlying sonner
 * `<Toaster>` is not deeply asserted since it renders a portal outside
 * the test container; we only check the component does not throw.
 *
 * @module components/ui/sonner.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Toaster } from './sonner.js';

describe('Toaster', () => {
  it('mounts without errors', () => {
    /*
     * Scenario: rendering the Toaster in the root layout must not throw so
     * toast notifications can be surfaced across the app.
     * Protects: basic mount path of the Toaster wrapper.
     */
    expect(() => {
      render(<Toaster />);
    }).not.toThrow();
  });

  it('accepts custom props without error', () => {
    /*
     * Scenario: prop spread (ToasterProps) must not cause a type or runtime
     * error when additional props are passed.
     * Protects: prop forwarding to SonnerToaster.
     */
    expect(() => {
      render(<Toaster position="top-center" />);
    }).not.toThrow();
  });
});
