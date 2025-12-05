import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireOrg, requireAdmin, requireSuperuser } from '@/middleware/auth';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';

describe('Auth Middleware', () => {
  describe('requireOrg', () => {
    const createMockRequest = (ctx: unknown, params: Record<string, string> = {}) => ({
      ctx,
      params,
      orgCtx: undefined as unknown,
    });

    const mockReply = {} as never;

    it('should pass for valid member with USER role', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          email: 'test@example.com',
          orgs: [{ orgId: 'org-123', role: 'USER' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireOrg(['USER', 'ADMIN', 'SUPERUSER']);
      await expect(middleware(request as never, mockReply)).resolves.not.toThrow();
      expect(request.orgCtx).toBeDefined();
      expect((request.orgCtx as { role: string }).role).toBe('USER');
    });

    it('should throw UnauthorizedError if no context', async () => {
      const request = createMockRequest(null, { orgId: 'org-123' });

      const middleware = requireOrg();
      await expect(middleware(request as never, mockReply)).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('should throw ForbiddenError if no orgId param', async () => {
      const request = createMockRequest({
        userId: 'user-123',
        orgs: [],
      });

      const middleware = requireOrg();
      await expect(middleware(request as never, mockReply)).rejects.toThrow(
        ForbiddenError
      );
    });

    it('should throw ForbiddenError if not a member', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          orgs: [{ orgId: 'other-org', role: 'USER' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireOrg();
      await expect(middleware(request as never, mockReply)).rejects.toThrow(
        ForbiddenError
      );
    });

    it('should throw ForbiddenError if role not allowed', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          orgs: [{ orgId: 'org-123', role: 'USER' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireOrg(['ADMIN', 'SUPERUSER']);
      await expect(middleware(request as never, mockReply)).rejects.toThrow(
        ForbiddenError
      );
    });
  });

  describe('requireAdmin', () => {
    const createMockRequest = (ctx: unknown, params: Record<string, string> = {}) => ({
      ctx,
      params,
      orgCtx: undefined as unknown,
    });

    const mockReply = {} as never;

    it('should pass for ADMIN role', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          orgs: [{ orgId: 'org-123', role: 'ADMIN' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireAdmin();
      await expect(middleware(request as never, mockReply)).resolves.not.toThrow();
    });

    it('should pass for SUPERUSER role', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          orgs: [{ orgId: 'org-123', role: 'SUPERUSER' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireAdmin();
      await expect(middleware(request as never, mockReply)).resolves.not.toThrow();
    });

    it('should fail for USER role', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          orgs: [{ orgId: 'org-123', role: 'USER' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireAdmin();
      await expect(middleware(request as never, mockReply)).rejects.toThrow(
        ForbiddenError
      );
    });
  });

  describe('requireSuperuser', () => {
    const createMockRequest = (ctx: unknown, params: Record<string, string> = {}) => ({
      ctx,
      params,
      orgCtx: undefined as unknown,
    });

    const mockReply = {} as never;

    it('should pass for SUPERUSER role', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          orgs: [{ orgId: 'org-123', role: 'SUPERUSER' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireSuperuser();
      await expect(middleware(request as never, mockReply)).resolves.not.toThrow();
    });

    it('should fail for ADMIN role', async () => {
      const request = createMockRequest(
        {
          userId: 'user-123',
          orgs: [{ orgId: 'org-123', role: 'ADMIN' }],
        },
        { orgId: 'org-123' }
      );

      const middleware = requireSuperuser();
      await expect(middleware(request as never, mockReply)).rejects.toThrow(
        ForbiddenError
      );
    });
  });
});
