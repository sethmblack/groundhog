import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OrganizationService } from '@/services/organization-service';
import { OrganizationRepository } from '@/repositories/organization-repository';
import { UserRepository } from '@/repositories/user-repository';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/lib/errors';

// Mock the repositories
vi.mock('@/repositories/organization-repository');
vi.mock('@/repositories/user-repository');

describe('OrganizationService', () => {
  let service: OrganizationService;
  let mockOrgRepo: { [key: string]: Mock };
  let mockUserRepo: { [key: string]: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrgRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listByUser: vi.fn(),
      addMember: vi.fn(),
      removeMember: vi.fn(),
      updateMemberRole: vi.fn(),
      getMembers: vi.fn(),
      getMembership: vi.fn(),
    };

    mockUserRepo = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      getOrganizations: vi.fn(),
    };

    (OrganizationRepository as Mock).mockImplementation(() => mockOrgRepo);
    (UserRepository as Mock).mockImplementation(() => mockUserRepo);

    service = new OrganizationService(
      mockOrgRepo as unknown as OrganizationRepository,
      mockUserRepo as unknown as UserRepository,
      null as never // No auth service for unit tests
    );
  });

  describe('create', () => {
    it('should create an organization', async () => {
      const userId = 'user-123';
      const orgName = 'Test Org';
      const mockUser = { userId, email: 'test@example.com' };
      const mockOrg = {
        orgId: 'org-123',
        name: orgName,
        status: 'ACTIVE',
        subscriptionTier: 'FREE',
        createdAt: new Date().toISOString(),
        createdBy: userId,
        updatedAt: new Date().toISOString(),
      };

      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockOrgRepo.create.mockResolvedValue(mockOrg);
      mockUserRepo.getOrganizations.mockResolvedValue([]);

      const result = await service.create({ name: orgName, createdBy: userId });

      expect(result).toEqual(mockOrg);
      expect(mockOrgRepo.create).toHaveBeenCalledWith({
        name: orgName,
        createdBy: userId,
      });
    });

    it('should throw NotFoundError if user does not exist', async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Test', createdBy: 'nonexistent' })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getById', () => {
    it('should return organization if found', async () => {
      const mockOrg = { orgId: 'org-123', name: 'Test Org' };
      mockOrgRepo.findById.mockResolvedValue(mockOrg);

      const result = await service.getById('org-123');

      expect(result).toEqual(mockOrg);
    });

    it('should throw NotFoundError if not found', async () => {
      mockOrgRepo.findById.mockResolvedValue(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('should update organization', async () => {
      const mockOrg = { orgId: 'org-123', name: 'Old Name' };
      const updatedOrg = { ...mockOrg, name: 'New Name' };

      mockOrgRepo.findById.mockResolvedValue(mockOrg);
      mockOrgRepo.update.mockResolvedValue(updatedOrg);

      const result = await service.update('org-123', { name: 'New Name' }, 'user-123');

      expect(result.name).toBe('New Name');
    });

    it('should throw NotFoundError if org not found', async () => {
      mockOrgRepo.findById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { name: 'Test' }, 'user-123')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should delete organization', async () => {
      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockOrgRepo.delete.mockResolvedValue(undefined);

      await expect(service.delete('org-123', 'user-123')).resolves.not.toThrow();
      expect(mockOrgRepo.delete).toHaveBeenCalledWith('org-123');
    });

    it('should throw NotFoundError if org not found', async () => {
      mockOrgRepo.findById.mockResolvedValue(null);

      await expect(service.delete('nonexistent', 'user-123')).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('addMember', () => {
    it('should add a member to organization', async () => {
      const mockOrg = { orgId: 'org-123', name: 'Test Org' };
      const mockUser = { userId: 'user-456', email: 'member@example.com' };
      const mockMembership = {
        userId: 'user-456',
        orgId: 'org-123',
        role: 'USER',
        joinedAt: new Date().toISOString(),
        invitedBy: 'user-123',
      };

      mockOrgRepo.findById.mockResolvedValue(mockOrg);
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);
      mockOrgRepo.getMembership.mockResolvedValue(null);
      mockOrgRepo.addMember.mockResolvedValue(mockMembership);
      mockUserRepo.getOrganizations.mockResolvedValue([]);

      const result = await service.addMember('org-123', {
        email: 'member@example.com',
        role: 'USER',
        invitedBy: 'user-123',
      });

      expect(result).toEqual(mockMembership);
    });

    it('should throw NotFoundError if org not found', async () => {
      mockOrgRepo.findById.mockResolvedValue(null);

      await expect(
        service.addMember('nonexistent', {
          email: 'test@example.com',
          role: 'USER',
          invitedBy: 'user-123',
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if user not found', async () => {
      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockUserRepo.findByEmail.mockResolvedValue(null);

      await expect(
        service.addMember('org-123', {
          email: 'nonexistent@example.com',
          role: 'USER',
          invitedBy: 'user-123',
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BadRequestError if already a member', async () => {
      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockUserRepo.findByEmail.mockResolvedValue({ userId: 'user-456' });
      mockOrgRepo.getMembership.mockResolvedValue({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'USER',
      });

      await expect(
        service.addMember('org-123', {
          email: 'existing@example.com',
          role: 'USER',
          invitedBy: 'user-123',
        })
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('removeMember', () => {
    it('should remove a member', async () => {
      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockOrgRepo.getMembership.mockResolvedValue({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'USER',
      });
      mockOrgRepo.removeMember.mockResolvedValue(undefined);
      mockUserRepo.getOrganizations.mockResolvedValue([]);

      await expect(
        service.removeMember('org-123', 'user-456', 'user-123')
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenError when removing last admin', async () => {
      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockOrgRepo.getMembership.mockResolvedValue({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'ADMIN',
      });
      mockOrgRepo.getMembers.mockResolvedValue([
        { userId: 'user-456', role: 'ADMIN' },
      ]);

      await expect(
        service.removeMember('org-123', 'user-456', 'user-123')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updateMemberRole', () => {
    it('should update member role', async () => {
      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockOrgRepo.getMembership.mockResolvedValue({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'USER',
      });
      mockOrgRepo.updateMemberRole.mockResolvedValue({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'ADMIN',
      });
      mockUserRepo.getOrganizations.mockResolvedValue([]);

      const result = await service.updateMemberRole(
        'org-123',
        'user-456',
        'ADMIN',
        'user-123'
      );

      expect(result.role).toBe('ADMIN');
    });

    it('should throw ForbiddenError when demoting last admin', async () => {
      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockOrgRepo.getMembership.mockResolvedValue({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'ADMIN',
      });
      mockOrgRepo.getMembers.mockResolvedValue([
        { userId: 'user-456', role: 'ADMIN' },
      ]);

      await expect(
        service.updateMemberRole('org-123', 'user-456', 'USER', 'user-123')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('listForUser', () => {
    it('should return paginated organizations', async () => {
      const mockOrgs = [
        { orgId: 'org-1', name: 'Org 1' },
        { orgId: 'org-2', name: 'Org 2' },
      ];

      mockOrgRepo.listByUser.mockResolvedValue(mockOrgs);

      const result = await service.listForUser('user-123', { page: 1, limit: 10 });

      expect(result.data).toEqual(mockOrgs);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.hasNext).toBe(false);
    });
  });

  describe('getMembers', () => {
    it('should return paginated members', async () => {
      const mockMembers = [
        { userId: 'user-1', orgId: 'org-123', role: 'ADMIN' },
        { userId: 'user-2', orgId: 'org-123', role: 'USER' },
      ];

      mockOrgRepo.findById.mockResolvedValue({ orgId: 'org-123' });
      mockOrgRepo.getMembers.mockResolvedValue(mockMembers);

      const result = await service.getMembers('org-123', { page: 1, limit: 10 });

      expect(result.data).toEqual(mockMembers);
      expect(result.pagination.total).toBe(2);
    });

    it('should throw NotFoundError if org not found', async () => {
      mockOrgRepo.findById.mockResolvedValue(null);

      await expect(
        service.getMembers('nonexistent', { page: 1, limit: 10 })
      ).rejects.toThrow(NotFoundError);
    });
  });
});
