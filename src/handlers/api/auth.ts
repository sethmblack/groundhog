import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '@/services/auth-service';
import { BadRequestError } from '@/lib/errors';

// Request schemas
const SignUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  fullName: z.string().min(1).max(200).optional(),
});

const ConfirmSignUpSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(6),
});

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(6),
  newPassword: z.string().min(12),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService
): void {
  // POST /auth/register
  app.post('/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = SignUpSchema.safeParse(request.body);
    if (!validation.success) {
      throw new BadRequestError(validation.error.errors[0].message);
    }

    const result = await authService.signUp({
      email: validation.data.email,
      password: validation.data.password,
      fullName: validation.data.fullName,
    });

    return reply.status(201).send({
      userId: result.userId,
      needsConfirmation: result.needsConfirmation,
      message: result.needsConfirmation
        ? 'Please check your email for confirmation code'
        : 'Account created successfully',
    });
  });

  // POST /auth/confirm
  app.post('/auth/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = ConfirmSignUpSchema.safeParse(request.body);
    if (!validation.success) {
      throw new BadRequestError(validation.error.errors[0].message);
    }

    await authService.confirmSignUp(validation.data);

    return reply.send({
      message: 'Email confirmed successfully',
    });
  });

  // POST /auth/login
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = SignInSchema.safeParse(request.body);
    if (!validation.success) {
      throw new BadRequestError(validation.error.errors[0].message);
    }

    const tokens = await authService.signIn(validation.data);

    return reply.send({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
    });
  });

  // POST /auth/refresh
  app.post('/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = RefreshTokenSchema.safeParse(request.body);
    if (!validation.success) {
      throw new BadRequestError(validation.error.errors[0].message);
    }

    const tokens = await authService.refreshTokens(validation.data);

    return reply.send({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
    });
  });

  // POST /auth/forgot-password
  app.post('/auth/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = ForgotPasswordSchema.safeParse(request.body);
    if (!validation.success) {
      throw new BadRequestError(validation.error.errors[0].message);
    }

    await authService.forgotPassword(validation.data);

    // Always return success to prevent email enumeration
    return reply.send({
      message: 'If an account exists, a reset code has been sent',
    });
  });

  // POST /auth/reset-password
  app.post('/auth/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = ResetPasswordSchema.safeParse(request.body);
    if (!validation.success) {
      throw new BadRequestError(validation.error.errors[0].message);
    }

    await authService.resetPassword(validation.data);

    return reply.send({
      message: 'Password reset successfully',
    });
  });

  // POST /auth/logout (requires auth)
  app.post('/auth/logout', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.headers.authorization?.split(' ')[1];
      if (token) {
        await authService.signOut(token);
      }

      return reply.send({
        message: 'Logged out successfully',
      });
    },
  });
}
