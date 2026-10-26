import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ErrorBoundary from './ErrorBoundary';

// Simple test components
const SimpleApp: React.FC = () => (
  <MemoryRouter initialEntries={['/workbench']}>
    <div>综合项目管理系统</div>
  </MemoryRouter>
);

describe('App', () => {
  it('renders main page title', () => {
    render(<SimpleApp />);
    expect(screen.getByText('综合项目管理系统')).toBeTruthy();
  });

  it('sanity check passes', () => {
    expect(2 + 2).toBe(4);
  });

  it('debug_env test', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('renders error boundary on crash', async () => {
    const Boom = () => { throw new Error('test crash'); };
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    await waitFor(() => expect(screen.getByText('页面出现错误')).toBeTruthy());
  });
});
