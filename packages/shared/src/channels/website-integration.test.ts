import { describe, it, expect } from 'vitest';
import { generateEmbedCode } from './website-integration';

describe('generateEmbedCode', () => {
  it('generates iframe, script, and API endpoint', () => {
    const embed = generateEmbedCode({
      tenantId: 'tenant-1',
      apiKey: 'key-123',
      widgetType: 'booking',
      styling: {
        primaryColor: '#4B5EFF',
        fontFamily: 'Inter',
        position: 'bottom-right',
        size: 'standard',
      },
    });

    expect(embed.iframeCode).toContain('booking');
    expect(embed.iframeCode).toContain('key-123');
    expect(embed.scriptCode).toContain('embed.js');
    expect(embed.scriptCode).toContain('key-123');
    expect(embed.apiEndpoint).toContain('/api/booking/key-123');
  });

  it('generates different code for chat widget', () => {
    const embed = generateEmbedCode({
      tenantId: 't1',
      apiKey: 'k1',
      widgetType: 'chat',
      styling: { primaryColor: '#000', fontFamily: 'Arial', position: 'bottom-left', size: 'compact' },
    });
    expect(embed.iframeCode).toContain('chat');
    expect(embed.apiEndpoint).toContain('/api/chat/');
  });
});
