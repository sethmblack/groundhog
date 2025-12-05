import {
  OrganizationRepository,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@/repositories/organization-repository';
import { UserRepository } from '@/repositories/user-repository';
import { AuthService } from '@/services/auth-service';
import { Organization, OrgMembership, Role, PaginatedResponse, Pagination } from '@/types';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface InviteMemberInput {
  email: string;
  role: Role;
  invitedBy: string;
}

export class OrganizationService {
  private orgRepository: OrganizationRepository;
  private userRepository: UserRepository;
  private authService: AuthService | null;

  constructor(
    orgRepository?: OrganizationRepository,
    userRepository?: UserRepository,
    authService?: AuthService
  ) {
    this.orgRepository = orgRepository || new OrganizationRepository();
    this.userRepository = userRepository || new UserRepository();
    this.authService = authService || null;
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    // Verify user exists
    const user = await this.userRepository.findById(input.createdBy);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const organization = await this.orgRepository.create(input);

    // Update user's Cognito claims with new org
    if (this.authService) {
      const memberships = await this.userRepository.getOrganizations(input.createdBy);
      const orgClaims = memberships.map((m) => ({ orgId: m.orgId, role: m.role }));
      await this.authService.updateUserOrgs(input.createdBy, orgClaims);
    }

    logger.info(
      { orgId: organization.orgId, userId: input.createdBy },
      'Organization created'
    );

    return organization;
  }

  async getById(orgId: string): Promise<Organization> {
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }
    return org;
  }

  async update(
    orgId: string,
    input: UpdateOrganizationInput,
    updatedBy: string
  ): Promise<Organization> {
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const updated = await this.orgRepository.update(orgId, input);

    logger.info({ orgId, updatedBy, changes: Object.keys(input) }, 'Organization updated');

    return updated;
  }

  async delete(orgId: string, deletedBy: string): Promise<void> {
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    await this.orgRepository.delete(orgId);

    logger.info({ orgId, deletedBy }, 'Organization deleted');
  }

  async listForUser(
    userId: string,
    pagination: Pagination
  ): Promise<PaginatedResponse<Organization>> {
    const orgs = await this.orgRepository.listByUser(userId);

    // Simple in-memory pagination
    const start = (pagination.page - 1) * pagination.limit;
    const end = start + pagination.limit;
    const paginatedOrgs = orgs.slice(start, end);

    return {
      data: paginatedOrgs,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: orgs.length,
        totalPages: Math.ceil(orgs.length / pagination.limit),
        hasNext: end < orgs.length,
        hasPrev: pagination.page > 1,
      },
    };
  }

  async addMember(
    orgId: string,
    input: InviteMemberInput
  ): Promise<OrgMembership> {
    // Verify org exists
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Find user by email
    const user = await this.userRepository.findByEmail(input.email);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if already a member
    const existingMembership = await this.orgRepository.getMembership(
      user.userId,
      orgId
    );
    if (existingMembership) {
      throw new BadRequestError('User is already a member of this organization');
    }

    // Add membership
    const membership = await this.orgRepository.addMember({
      userId: user.userId,
      orgId,
      role: input.role,
      invitedBy: input.invitedBy,
    });

    // Update user's Cognito claims
    if (this.authService) {
      const memberships = await this.userRepository.getOrganizations(user.userId);
      const orgClaims = memberships.map((m) => ({ orgId: m.orgId, role: m.role }));
      await this.authService.updateUserOrgs(user.userId, orgClaims);
    }

    logger.info(
      { orgId, userId: user.userId, role: input.role, invitedBy: input.invitedBy },
      'Member added to organization'
    );

    return membership;
  }

  async removeMember(
    orgId: string,
    userId: string,
    removedBy: string
  ): Promise<void> {
    // Verify org exists
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check if user is a member
    const membership = await this.orgRepository.getMembership(userId, orgId);
    if (!membership) {
      throw new NotFoundError('User is not a member of this organization');
    }

    // Prevent removing the last admin
    if (membership.role === 'ADMIN') {
      const members = await this.orgRepository.getMembers(orgId);
      const adminCount = members.filter((m) => m.role === 'ADMIN').length;
      if (adminCount <= 1) {
        throw new ForbiddenError('Cannot remove the last admin');
      }
    }

    await this.orgRepository.removeMember(userId, orgId);

    // Update user's Cognito claims
    if (this.authService) {
      const memberships = await this.userRepository.getOrganizations(userId);
      const orgClaims = memberships.map((m) => ({ orgId: m.orgId, role: m.role }));
      await this.authService.updateUserOrgs(userId, orgClaims);
    }

    logger.info({ orgId, userId, removedBy }, 'Member removed from organization');
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    newRole: Role,
    updatedBy: string
  ): Promise<OrgMembership> {
    // Verify org exists
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Check current membership
    const currentMembership = await this.orgRepository.getMembership(userId, orgId);
    if (!currentMembership) {
      throw new NotFoundError('User is not a member of this organization');
    }

    // Prevent demoting the last admin
    if (currentMembership.role === 'ADMIN' && newRole !== 'ADMIN') {
      const members = await this.orgRepository.getMembers(orgId);
      const adminCount = members.filter((m) => m.role === 'ADMIN').length;
      if (adminCount <= 1) {
        throw new ForbiddenError('Cannot demote the last admin');
      }
    }

    const updatedMembership = await this.orgRepository.updateMemberRole(
      userId,
      orgId,
      newRole
    );

    // Update user's Cognito claims
    if (this.authService) {
      const memberships = await this.userRepository.getOrganizations(userId);
      const orgClaims = memberships.map((m) => ({ orgId: m.orgId, role: m.role }));
      await this.authService.updateUserOrgs(userId, orgClaims);
    }

    logger.info({ orgId, userId, newRole, updatedBy }, 'Member role updated');

    return updatedMembership;
  }

  async getMembers(
    orgId: string,
    pagination: Pagination
  ): Promise<PaginatedResponse<OrgMembership>> {
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const members = await this.orgRepository.getMembers(orgId);

    // Simple in-memory pagination
    const start = (pagination.page - 1) * pagination.limit;
    const end = start + pagination.limit;
    const paginatedMembers = members.slice(start, end);

    return {
      data: paginatedMembers,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: members.length,
        totalPages: Math.ceil(members.length / pagination.limit),
        hasNext: end < members.length,
        hasPrev: pagination.page > 1,
      },
    };
  }
}
