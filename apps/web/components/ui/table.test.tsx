/**
 * @fileoverview Unit tests for the Table UI primitives.
 *
 * Verifies that Table, TableHeader, TableBody, TableFooter, TableHead,
 * TableRow, TableCell, and TableCaption all mount without errors and render
 * semantic HTML structure.
 *
 * @module components/ui/table.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from './table.js';

describe('Table primitives', () => {
  it('renders a full table structure without errors', () => {
    /*
     * Scenario: composing all table sub-components into a valid HTML table
     * must not throw and must produce the expected aria roles.
     * Protects: all Table primitives render valid semantic HTML.
     */
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alice</TableCell>
            <TableCell>alice@example.com</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell>1</TableCell>
          </TableRow>
        </TableFooter>
        <TableCaption>User list</TableCaption>
      </Table>,
    );

    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('User list')).toBeDefined();
  });

  it('merges className on Table', () => {
    /*
     * Scenario: custom className must appear on the table element.
     * Protects: cn() merging in Table.
     */
    render(
      <Table className="my-table">
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('table').className).toContain('my-table');
  });
});
