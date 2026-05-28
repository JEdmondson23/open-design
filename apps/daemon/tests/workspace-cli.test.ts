import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  body: unknown;
};

type MockReply = {
  status?: number;
  body?: unknown;
};

async function withWorkspaceServer(
  handler: (request: CapturedRequest) => MockReply,
  run: (baseUrl: string, requests: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method,
        url: req.url,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(captured);
      const reply = handler(captured);
      res.statusCode = reply.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function runWorkspaceCli(baseUrl: string, args: string[]) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return await execFileAsync(
    process.execPath,
    ['--import', 'tsx', cliEntry, 'workspace', ...args, '--daemon-url', baseUrl],
    {
      cwd: daemonRoot,
      env,
      maxBuffer: 1024 * 1024,
    },
  );
}

describe('od workspace CLI', () => {
  it('prints the workspace list as JSON from /api/workspaces', async () => {
    await withWorkspaceServer(
      (request) => {
        expect(request.method).toBe('GET');
        expect(request.url).toBe('/api/workspaces');
        return {
          body: {
            currentWorkspaceId: 'team-ws',
            workspaces: [
              { id: 'local', name: 'Personal Workspace', kind: 'personal', currentUserRole: 'owner' },
              { id: 'team-ws', name: 'Design Team', kind: 'team', currentUserRole: 'admin' },
            ],
          },
        };
      },
      async (baseUrl, requests) => {
        const { stdout, stderr } = await runWorkspaceCli(baseUrl, ['list', '--json']);

        expect(stderr).toBe('');
        expect(requests).toHaveLength(1);
        expect(JSON.parse(stdout)).toMatchObject({
          currentWorkspaceId: 'team-ws',
          workspaces: [{ id: 'local' }, { id: 'team-ws' }],
        });
      },
    );
  });

  it('creates invites through the workspace invites endpoint', async () => {
    await withWorkspaceServer(
      (request) => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe('/api/workspaces/team-ws/invites');
        expect(request.body).toEqual({ role: 'admin', expiresInDays: 3 });
        return {
          body: {
            invite: {
              id: 'invite-1',
              role: 'admin',
              inviteUrl: 'https://open.design/invite/token-1',
            },
          },
        };
      },
      async (baseUrl, requests) => {
        const { stdout, stderr } = await runWorkspaceCli(baseUrl, [
          'invite',
          'team-ws',
          '--role',
          'admin',
          '--expires-in-days',
          '3',
          '--json',
        ]);

        expect(stderr).toBe('');
        expect(requests).toHaveLength(1);
        expect(JSON.parse(stdout)).toMatchObject({
          invite: { id: 'invite-1', role: 'admin' },
        });
      },
    );
  });

  it('keeps positional workspace ids even when they match flag values', async () => {
    await withWorkspaceServer(
      (request) => {
        expect(request.method).toBe('PATCH');
        expect(request.url).toBe('/api/workspaces/same-name');
        expect(request.body).toEqual({ name: 'same-name' });
        return {
          body: {
            workspace: { id: 'same-name', name: 'same-name', kind: 'team' },
          },
        };
      },
      async (baseUrl, requests) => {
        const { stdout, stderr } = await runWorkspaceCli(baseUrl, [
          'rename',
          'same-name',
          '--name',
          'same-name',
          '--json',
        ]);

        expect(stderr).toBe('');
        expect(requests).toHaveLength(1);
        expect(JSON.parse(stdout)).toMatchObject({
          workspace: { id: 'same-name', name: 'same-name' },
        });
      },
    );
  });

  it('updates member roles through the members endpoint', async () => {
    await withWorkspaceServer(
      (request) => {
        expect(request.method).toBe('PATCH');
        expect(request.url).toBe('/api/workspaces/team-ws/members/user-2');
        expect(request.body).toEqual({ role: 'member' });
        return {
          body: {
            member: { userId: 'user-2', role: 'member' },
          },
        };
      },
      async (baseUrl, requests) => {
        const { stdout, stderr } = await runWorkspaceCli(baseUrl, [
          'member-role',
          'team-ws',
          'user-2',
          '--role',
          'member',
          '--json',
        ]);

        expect(stderr).toBe('');
        expect(requests).toHaveLength(1);
        expect(JSON.parse(stdout)).toMatchObject({
          member: { userId: 'user-2', role: 'member' },
        });
      },
    );
  });
});
