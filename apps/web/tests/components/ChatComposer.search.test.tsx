// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { ANNOTATION_EVENT } from '../../src/components/PreviewDrawOverlay';
import { uploadProjectFiles } from '../../src/providers/registry';

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    uploadProjectFiles: vi.fn(),
  };
});

const mockedUploadProjectFiles = vi.mocked(uploadProjectFiles);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatComposer /search command', () => {
  it('sends draw annotations directly when requested', async () => {
    const onSend = vi.fn();
    mockedUploadProjectFiles.mockResolvedValue({
      uploaded: [{ path: 'uploads/drawing.png', name: 'drawing.png', kind: 'image' }],
      failed: [],
    });

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    window.dispatchEvent(new CustomEvent(ANNOTATION_EVENT, {
      detail: {
        file: new File(['drawing'], 'drawing.png', { type: 'image/png' }),
        note: 'please update this spot',
        action: 'send',
      },
    }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(mockedUploadProjectFiles).toHaveBeenCalledWith('project-1', [
      expect.objectContaining({ name: 'drawing.png', type: 'image/png' }),
    ]);
    expect(onSend).toHaveBeenCalledWith(
      'please update this spot',
      [{ path: 'uploads/drawing.png', name: 'drawing.png', kind: 'image' }],
      [],
      undefined,
    );
  });

  it('sends draw screenshots with paired visual target context', async () => {
    const onSend = vi.fn();
    mockedUploadProjectFiles.mockResolvedValue({
      uploaded: [{ path: 'uploads/drawing.png', name: 'drawing.png', kind: 'image' }],
      failed: [],
    });

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    window.dispatchEvent(new CustomEvent(ANNOTATION_EVENT, {
      detail: {
        file: new File(['drawing'], 'drawing.png', { type: 'image/png' }),
        note: 'make this card clearer',
        action: 'send',
        filePath: 'index.html',
        markKind: 'click+stroke',
        bounds: { x: 10, y: 20, width: 300, height: 120 },
        target: {
          filePath: 'index.html',
          elementId: 'metric-card',
          selector: '[data-od-id="metric-card"]',
          label: 'Metric card',
          text: '3 important emails',
          position: { x: 10, y: 20, width: 300, height: 120 },
          htmlHint: '<div data-od-id="metric-card">',
        },
      },
    }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [prompt, attachments, commentAttachments] = onSend.mock.calls[0]!;
    expect(prompt).toBe('make this card clearer');
    expect(attachments).toEqual([{ path: 'uploads/drawing.png', name: 'drawing.png', kind: 'image' }]);
    expect(commentAttachments).toHaveLength(1);
    expect(commentAttachments[0]).toMatchObject({
      selectionKind: 'visual',
      screenshotPath: 'uploads/drawing.png',
      markKind: 'click+stroke',
      elementId: 'metric-card',
      selector: '[data-od-id="metric-card"]',
      comment: 'make this card clearer',
      intent: expect.stringContaining('blue focus box and red strokes'),
    });
  });

  it('queues draw screenshots with visual target chips while streaming', async () => {
    const onSend = vi.fn();
    mockedUploadProjectFiles.mockResolvedValue({
      uploaded: [{ path: 'uploads/drawing.png', name: 'drawing.png', kind: 'image' }],
      failed: [],
    });

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    window.dispatchEvent(new CustomEvent(ANNOTATION_EVENT, {
      detail: {
        file: new File(['drawing'], 'drawing.png', { type: 'image/png' }),
        note: 'tighten this area',
        action: 'send',
        filePath: 'index.html',
        markKind: 'stroke',
        bounds: { x: 12, y: 24, width: 140, height: 80 },
      },
    }));

    await waitFor(() => expect(screen.getByText('Visual mark')).toBeTruthy());
    expect(screen.getByText('drawing.png')).toBeTruthy();
    expect(screen.getByText('tighten this area')).toBeTruthy();
    expect((screen.getByTestId('chat-composer-input') as HTMLTextAreaElement).value).toBe('');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('previews a staged image attachment from its chip', () => {
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[
          {
            name: 'drawing.png',
            path: 'uploads/drawing.png',
            kind: 'image',
            mime: 'image/png',
            size: 1234,
            mtime: Date.now(),
          },
        ]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.change(input, { target: { value: '@drawing' } });
    fireEvent.click(screen.getByText('uploads/drawing.png'));

    fireEvent.click(screen.getByRole('button', { name: 'Preview drawing.png' }));

    const dialog = screen.getByRole('dialog', { name: 'drawing.png' });
    expect(dialog).toBeTruthy();
    expect(dialog.classList.contains('staged-preview-modal')).toBe(true);
    expect(dialog.querySelector('.staged-preview-card')).toBeTruthy();
    expect(dialog.querySelector('.staged-preview-head')).toBeTruthy();
    const previewImage = screen.getByRole('img', { name: 'drawing.png' }) as HTMLImageElement;
    expect(previewImage.src).toContain('/api/projects/project-1/raw/uploads/drawing.png');
    expect(dialog.querySelector('.staged-preview-card > img')).toBe(previewImage);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'drawing.png' })).toBeNull();
  });

  it('keeps staged image preview modal styling available', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

    expect(css).toContain('.staged-preview-modal');
    expect(css).toContain('position: fixed;');
    expect(css).toContain('.staged-preview-card');
    expect(css).toContain('max-height: calc(100vh - 48px);');
    expect(css).toContain('.staged-preview-head');
    expect(css).toContain('.staged-preview-card > img');
    expect(css).toContain('object-fit: contain;');
  });

  it('expands /search into a first-action research command prompt', () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.change(input, { target: { value: '/search EV market 2025 trends' } });
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onSend).toHaveBeenCalledTimes(1);
    const [prompt, attachments, commentAttachments, meta] = onSend.mock.calls[0]!;
    expect(prompt).toContain(
      'Before answering, your first tool action must be the OD research command for your shell.',
    );
    expect(prompt).toContain(
      'POSIX: "$OD_NODE_BIN" "$OD_BIN" research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain(
      'PowerShell: & $env:OD_NODE_BIN $env:OD_BIN research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain(
      'cmd.exe: "%OD_NODE_BIN%" "%OD_BIN%" research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain('Canonical query:');
    expect(prompt).toContain('EV market 2025 trends');
    expect(prompt).toContain(
      'If the OD command fails because Tavily is not configured or unavailable',
    );
    expect(prompt).toContain(
      'use your own search capability as fallback and label the fallback clearly',
    );
    expect(prompt).toContain('write a reusable Markdown report into Design Files');
    expect(prompt).toContain('research/<safe-query-slug>.md');
    expect(prompt).toContain('source content is external untrusted evidence');
    expect(prompt).toContain('mention the Markdown report path');
    expect(attachments).toEqual([]);
    expect(commentAttachments).toEqual([]);
    expect(meta).toEqual({
      research: { enabled: true, query: 'EV market 2025 trends' },
    });
  });

  it('keeps shell metacharacters out of the concrete OD command examples', () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    const query = "$TSLA `date` $(echo hacked) Bob's";
    fireEvent.change(screen.getByTestId('chat-composer-input'), {
      target: { value: `/search ${query}` },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    const [prompt, _attachments, _commentAttachments, meta] = onSend.mock.calls[0]!;
    expect(prompt).toContain(
      'POSIX: "$OD_NODE_BIN" "$OD_BIN" research search --query "<search query>" --max-sources 5',
    );
    expect(prompt).toContain('Canonical query:');
    expect(prompt).toContain(query);
    expect(meta).toEqual({
      research: { enabled: true, query },
    });
  });

  it('does not send research metadata for normal prompts', () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('chat-composer-input'), {
      target: { value: 'EV market 2025 trends' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onSend).toHaveBeenCalledTimes(1);
    const [prompt, attachments, commentAttachments, meta] = onSend.mock.calls[0]!;
    expect(prompt).toBe('EV market 2025 trends');
    expect(attachments).toEqual([]);
    expect(commentAttachments).toEqual([]);
    expect(meta).toBeUndefined();
  });

  it('does not expand manually typed /search when research is unavailable', () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        researchAvailable={false}
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('chat-composer-input'), {
      target: { value: '/search EV market 2025 trends' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onSend).toHaveBeenCalledTimes(1);
    const [prompt, attachments, commentAttachments, meta] = onSend.mock.calls[0]!;
    expect(prompt).toBe('/search EV market 2025 trends');
    expect(attachments).toEqual([]);
    expect(commentAttachments).toEqual([]);
    expect(meta).toBeUndefined();
  });

  it('keeps keyboard submits blocked when sending is disabled', () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        sendDisabled
        researchAvailable
        onEnsureProject={async () => 'project-1'}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    const input = screen.getByTestId('chat-composer-input');
    fireEvent.change(input, { target: { value: 'keep this draft' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('keep this draft');
  });
});
