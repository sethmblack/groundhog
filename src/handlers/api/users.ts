import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { UserRepository } from '@/repositories/user-repository';
import { BadRequestError } from '@/lib/errors';

const UpdateUserSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
});

export function registerUserRoutes(
  app: FastifyInstance,
  userRepository: UserRepository
): void {
  // GET /users/me - Get current user
  app.get('/users/me', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await userRepository.findById(request.ctx!.userId);
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const orgs = await userRepository.getOrganizations(user.userId);

      return reply.send({
        ...user,
        organizations: orgs,
      });
    },
  });

  // PUT /users/me - Update current user
  app.put('/users/me', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = UpdateUserSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const user = await userRepository.update(request.ctx!.userId, validation.data);
      return reply.send(user);
    },
  });
}
