import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeartLogo, Icon } from './Icon';

describe('lucide icon API', () => {
  it('maps semantic names to real svg icons without rendering text glyphs', () => {
    const { container } = render(<Icon name="home" size={24} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('home');
  });

  it('keeps the HealthKeep heart logo API on the shared icon library', () => {
    const { container } = render(<HeartLogo size={20} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
