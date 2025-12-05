import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GlobalSignOutCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserRepository, CreateUserInput } from '@/repositories/user-repository';
import { User, Role } from '@/types';
import { BadRequestError, UnauthorizedError, ConflictError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface AuthConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
}

export interface ConfirmSignUpInput {
  email: string;
  code: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
}

export interface RefreshTokenInput {
  refreshToken: string;
}

export class AuthService {
  private cognitoClient: CognitoIdentityProviderClient;
  private userRepository: UserRepository;
  private config: AuthConfig;

  constructor(config: AuthConfig, userRepository?: UserRepository) {
    const endpoint = process.env['AWS_ENDPOINT'];
    this.cognitoClient = new CognitoIdentityProviderClient({
      ...(endpoint ? { endpoint } : {}),
      region: config.region,
    });
    this.config = config;
    this.userRepository = userRepository || new UserRepository();
  }

  async signUp(input: SignUpInput): Promise<{ userId: string; needsConfirmation: boolean }> {
    try {
      // Check if user already exists
      const existingUser = await this.userRepository.findByEmail(input.email);
      if (existingUser) {
        throw new ConflictError('User with this email already exists');
      }

      // Sign up with Cognito
      const response = await this.cognitoClient.send(
        new SignUpCommand({
          ClientId: this.config.clientId,
          Username: input.email,
          Password: input.password,
          UserAttributes: [
            { Name: 'email', Value: input.email },
            ...(input.fullName ? [{ Name: 'name', Value: input.fullName }] : []),
          ],
        })
      );

      const cognitoSub = response.UserSub!;

      // Create user record in our database
      await this.userRepository.create({
        email: input.email,
        fullName: input.fullName,
        cognitoSub,
      });

      logger.info({ email: input.email }, 'User signed up');

      return {
        userId: cognitoSub,
        needsConfirmation: !response.UserConfirmed,
      };
    } catch (error) {
      if (error instanceof ConflictError) {
        throw error;
      }

      const cognitoError = error as Error;
      if (cognitoError.name === 'UsernameExistsException') {
        throw new ConflictError('User with this email already exists');
      }
      if (cognitoError.name === 'InvalidPasswordException') {
        throw new BadRequestError('Password does not meet requirements');
      }
      if (cognitoError.name === 'InvalidParameterException') {
        throw new BadRequestError(cognitoError.message);
      }

      logger.error({ error, email: input.email }, 'Sign up failed');
      throw error;
    }
  }

  async confirmSignUp(input: ConfirmSignUpInput): Promise<void> {
    try {
      await this.cognitoClient.send(
        new ConfirmSignUpCommand({
          ClientId: this.config.clientId,
          Username: input.email,
          ConfirmationCode: input.code,
        })
      );

      logger.info({ email: input.email }, 'Sign up confirmed');
    } catch (error) {
      const cognitoError = error as Error;
      if (cognitoError.name === 'CodeMismatchException') {
        throw new BadRequestError('Invalid confirmation code');
      }
      if (cognitoError.name === 'ExpiredCodeException') {
        throw new BadRequestError('Confirmation code expired');
      }
      if (cognitoError.name === 'UserNotFoundException') {
        throw new BadRequestError('User not found');
      }

      logger.error({ error, email: input.email }, 'Confirm sign up failed');
      throw error;
    }
  }

  async signIn(input: SignInInput): Promise<AuthTokens> {
    try {
      const response = await this.cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: this.config.clientId,
          AuthParameters: {
            USERNAME: input.email,
            PASSWORD: input.password,
          },
        })
      );

      if (!response.AuthenticationResult) {
        throw new UnauthorizedError('Authentication failed');
      }

      const { AccessToken, RefreshToken, IdToken, ExpiresIn } =
        response.AuthenticationResult;

      if (!AccessToken || !RefreshToken || !IdToken) {
        throw new UnauthorizedError('Authentication failed');
      }

      logger.info({ email: input.email }, 'User signed in');

      return {
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        idToken: IdToken,
        expiresIn: ExpiresIn || 3600,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }

      const cognitoError = error as Error;
      if (
        cognitoError.name === 'NotAuthorizedException' ||
        cognitoError.name === 'UserNotFoundException'
      ) {
        throw new UnauthorizedError('Invalid email or password');
      }
      if (cognitoError.name === 'UserNotConfirmedException') {
        throw new BadRequestError('Please confirm your email first');
      }

      logger.error({ error, email: input.email }, 'Sign in failed');
      throw error;
    }
  }

  async refreshTokens(input: RefreshTokenInput): Promise<AuthTokens> {
    try {
      const response = await this.cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: this.config.clientId,
          AuthParameters: {
            REFRESH_TOKEN: input.refreshToken,
          },
        })
      );

      if (!response.AuthenticationResult) {
        throw new UnauthorizedError('Token refresh failed');
      }

      const { AccessToken, IdToken, ExpiresIn } = response.AuthenticationResult;

      if (!AccessToken || !IdToken) {
        throw new UnauthorizedError('Token refresh failed');
      }

      return {
        accessToken: AccessToken,
        refreshToken: input.refreshToken, // Refresh token doesn't change
        idToken: IdToken,
        expiresIn: ExpiresIn || 3600,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }

      const cognitoError = error as Error;
      if (cognitoError.name === 'NotAuthorizedException') {
        throw new UnauthorizedError('Invalid or expired refresh token');
      }

      logger.error({ error }, 'Token refresh failed');
      throw error;
    }
  }

  async signOut(accessToken: string): Promise<void> {
    try {
      await this.cognitoClient.send(
        new GlobalSignOutCommand({
          AccessToken: accessToken,
        })
      );

      logger.info('User signed out');
    } catch (error) {
      logger.error({ error }, 'Sign out failed');
      throw error;
    }
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    try {
      await this.cognitoClient.send(
        new ForgotPasswordCommand({
          ClientId: this.config.clientId,
          Username: input.email,
        })
      );

      logger.info({ email: input.email }, 'Password reset initiated');
    } catch (error) {
      const cognitoError = error as Error;
      // Don't reveal if user exists
      if (cognitoError.name === 'UserNotFoundException') {
        logger.info({ email: input.email }, 'Password reset for non-existent user');
        return; // Silently succeed
      }

      logger.error({ error, email: input.email }, 'Forgot password failed');
      throw error;
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    try {
      await this.cognitoClient.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.config.clientId,
          Username: input.email,
          ConfirmationCode: input.code,
          Password: input.newPassword,
        })
      );

      logger.info({ email: input.email }, 'Password reset completed');
    } catch (error) {
      const cognitoError = error as Error;
      if (cognitoError.name === 'CodeMismatchException') {
        throw new BadRequestError('Invalid reset code');
      }
      if (cognitoError.name === 'ExpiredCodeException') {
        throw new BadRequestError('Reset code expired');
      }
      if (cognitoError.name === 'InvalidPasswordException') {
        throw new BadRequestError('Password does not meet requirements');
      }

      logger.error({ error, email: input.email }, 'Reset password failed');
      throw error;
    }
  }

  async updateUserOrgs(
    userId: string,
    orgs: Array<{ orgId: string; role: Role }>
  ): Promise<void> {
    try {
      await this.cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.config.userPoolId,
          Username: userId,
          UserAttributes: [
            {
              Name: 'custom:orgs',
              Value: JSON.stringify(orgs),
            },
          ],
        })
      );

      logger.debug({ userId, orgs }, 'Updated user org claims');
    } catch (error) {
      logger.error({ error, userId }, 'Failed to update user org claims');
      throw error;
    }
  }

  async getCurrentUser(accessToken: string): Promise<User | null> {
    try {
      // For now, we'd decode the token to get the sub
      // In a real implementation, we might use GetUser command
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      return this.userRepository.findById(payload.sub);
    } catch (error) {
      logger.error({ error }, 'Failed to get current user');
      return null;
    }
  }
}
