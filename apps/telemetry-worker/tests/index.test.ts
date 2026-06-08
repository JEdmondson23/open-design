import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import worker, { type Env } from '../src/index';

const env: Env = {
  LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
  LANGFUSE_SECRET_KEY: 'sk-lf-test',
  LANGFUSE_BASE_URL: 'https://us.cloud.langfuse.com',
};
const objectUploadSecret = 'object-upload-secret';

function makeRequest(body: unknown): Request {
  return new Request('https://telemetry.open-design.ai/api/langfuse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Open-Design-Telemetry': 'langfuse-ingestion-v1',
    },
    body: JSON.stringify(body),
  });
}

function makeRateLimiter(success: boolean) {
  return {
    limit: vi.fn(async () => ({ success })),
  };
}

function signedObjectHeaders(bodyText: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    'Content-Type': 'application/json',
    'X-Open-Design-Telemetry': 'object-ingestion-v1',
    'X-Open-Design-Object-Timestamp': timestamp,
    'X-Open-Design-Object-Signature': `sha256:${createHmac('sha256', objectUploadSecret)
      .update(timestamp)
      .update('\n')
      .update(bodyText)
      .digest('hex')}`,
  };
}

function makeObjectRequest(body: unknown): Request {
  const bodyText = JSON.stringify(body);
  return new Request('https://telemetry.open-design.ai/api/objects/batch', {
    method: 'POST',
    headers: signedObjectHeaders(bodyText),
    body: bodyText,
  });
}

function makeUnsignedObjectRequest(body: unknown): Request {
  return new Request('https://telemetry.open-design.ai/api/objects/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Open-Design-Telemetry': 'object-ingestion-v1',
    },
    body: JSON.stringify(body),
  });
}

function base64(value: string): string {
  return btoa(value);
}

describe('telemetry worker', () => {
  it('returns a health response for browser checks', async () => {
    const response = await worker.fetch(
      new Request('https://telemetry.open-design.ai/api/langfuse'),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'open-design-telemetry-relay',
      configured: true,
      objectRelayConfigured: false,
      upstream: 'https://us.cloud.langfuse.com/api/public/ingestion',
    });
  });

  it('reports unconfigured health without exposing secrets', async () => {
    const response = await worker.fetch(new Request('https://telemetry.open-design.ai/health'), {});

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'open-design-telemetry-relay',
      configured: false,
      objectRelayConfigured: false,
      upstream: 'https://us.cloud.langfuse.com/api/public/ingestion',
    });
  });

  it('forwards valid Langfuse ingestion batches with server-side auth', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ successes: [{ id: 'evt-1' }], errors: [] }), {
        status: 207,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await worker.fetch(
      makeRequest({
        batch: [
          {
            id: 'evt-1',
            type: 'trace-create',
            timestamp: '2026-05-11T00:00:00.000Z',
            body: { id: 'trace-1', name: 'open-design-turn' },
          },
        ],
      }),
      env,
    );

    expect(response.status).toBe(207);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://us.cloud.langfuse.com/api/public/ingestion');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
      'Content-Type': 'application/json',
    });

    fetchSpy.mockRestore();
  });

  it('rejects requests without the Open Design client marker', async () => {
    const response = await worker.fetch(
      new Request('https://telemetry.open-design.ai/api/langfuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: [] }),
      }),
      env,
    );

    expect(response.status).toBe(403);
  });

  it('rate limits validated batches before forwarding', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const limiter = makeRateLimiter(false);
    const response = await worker.fetch(
      makeRequest({
        batch: [
          {
            id: 'evt-1',
            type: 'trace-create',
            timestamp: '2026-05-11T00:00:00.000Z',
            body: {
              id: 'trace-1',
              name: 'open-design-turn',
              userId: 'installation-1',
            },
          },
        ],
      }),
      { ...env, TELEMETRY_CLIENT_RATE_LIMITER: limiter },
    );

    expect(response.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'client:installation-1' });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('rejects malformed batches before forwarding', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(makeRequest({ batch: [{ type: 'bad' }] }), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'body.batch[0].id must be a string',
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('fails closed when Langfuse credentials are absent', async () => {
    const response = await worker.fetch(makeRequest({ batch: [] }), {});
    expect(response.status).toBe(503);
  });

  it('stores object batches through the R2 binding without calling Langfuse', async () => {
    const put = vi.fn(async () => ({}));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      makeObjectRequest({
        client_id: 'installation-1',
        project_id: 'proj-1',
        run_id: 'run-1',
        objects: [
          {
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-1/brief.txt',
            object_class: 'attachment',
            mime: 'text/plain',
            content_base64: base64('hello object'),
          },
        ],
      }),
      {
        ...env,
        TRACE_OBJECT_BUCKET: { put },
        TRACE_OBJECT_PREFIX: 'observability',
        TRACE_OBJECT_UPLOAD_SECRET: objectUploadSecret,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    const putCalls = (put as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(putCalls[0]![0]).toBe(
      'observability/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-1/brief.txt',
    );
    const body = await response.json() as { objects: Array<Record<string, unknown>> };
    expect(body.objects[0]).toMatchObject({
      storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-1/brief.txt',
      status: 'available',
      size_bytes: 12,
    });
    expect(body.objects[0]?.sha256).toEqual(expect.stringMatching(/^sha256:/));

    fetchSpy.mockRestore();
  });

  it('rejects object batches without the object marker', async () => {
    const response = await worker.fetch(
      new Request('https://telemetry.open-design.ai/api/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objects: [] }),
      }),
      { ...env, TRACE_OBJECT_BUCKET: { put: vi.fn() } },
    );

    expect(response.status).toBe(403);
  });

  it('rejects marker-only object batches without upload authority', async () => {
    const put = vi.fn(async () => ({}));
    const response = await worker.fetch(
      makeUnsignedObjectRequest({
        client_id: 'installation-1',
        project_id: 'proj-1',
        run_id: 'run-1',
        objects: [
          {
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-1/brief.txt',
            object_class: 'attachment',
            mime: 'text/plain',
            content_base64: base64('hello object'),
          },
        ],
      }),
      {
        ...env,
        TRACE_OBJECT_BUCKET: { put },
        TRACE_OBJECT_UPLOAD_SECRET: objectUploadSecret,
      },
    );

    expect(response.status).toBe(403);
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects object refs outside the signed project and run namespace', async () => {
    const put = vi.fn(async () => ({}));
    const response = await worker.fetch(
      makeObjectRequest({
        client_id: 'installation-1',
        project_id: 'proj-1',
        run_id: 'run-1',
        objects: [
          {
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-2/runs/run-1/attachment/att-1/brief.txt',
            object_class: 'attachment',
            mime: 'text/plain',
            content_base64: base64('hello object'),
          },
        ],
      }),
      {
        ...env,
        TRACE_OBJECT_BUCKET: { put },
        TRACE_OBJECT_UPLOAD_SECRET: objectUploadSecret,
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'body.objects[0].storage_ref must match the project, run, and object class',
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('reports oversized objects without writing them', async () => {
    const put = vi.fn(async () => ({}));
    const response = await worker.fetch(
      makeObjectRequest({
        client_id: 'installation-1',
        project_id: 'proj-1',
        run_id: 'run-1',
        objects: [
          {
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/artifact/art-1/index.html',
            object_class: 'artifact',
            mime: 'text/html',
            content_base64: base64('too large'),
          },
        ],
      }),
      {
        ...env,
        TRACE_OBJECT_BUCKET: { put },
        TRACE_OBJECT_MAX_BYTES: '4',
        TRACE_OBJECT_UPLOAD_SECRET: objectUploadSecret,
      },
    );

    expect(response.status).toBe(200);
    expect(put).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      objects: [
        {
          storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/artifact/art-1/index.html',
          status: 'unavailable',
          reason: 'object_too_large',
          size_bytes: 9,
        },
      ],
    });
  });
});
