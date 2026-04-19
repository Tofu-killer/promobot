import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../../src/client/App';

describe('App shell', () => {
  it('renders the PromoBot navigation shell', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('PromoBot');
    expect(html).toContain('Dashboard');
    expect(html).toContain('Projects');
    expect(html).toContain('Discovery Pool');
    expect(html).toContain('Generate Center');
    expect(html).toContain('Social Inbox');
    expect(html).toContain('Competitor Monitor');
    expect(html).toContain('Channel Accounts');
    expect(html).toContain('Settings');
  });
});
