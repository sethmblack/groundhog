import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BillingService } from '@/services/billing-service';
import { requireOrg, requireAdmin } from '@/middleware/auth';
import { BadRequestError } from '@/lib/errors';
import { SubscriptionTierSchema } from '@/types';

const CreateCheckoutSchema = z.object({
  tier: SubscriptionTierSchema.exclude(['FREE']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export function registerBillingRoutes(
  app: FastifyInstance,
  billingService: BillingService
): void {
  // GET /organizations/:orgId/billing - Get subscription info
  app.get('/organizations/:orgId/billing', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };

      const subscriptionInfo = await billingService.getSubscriptionInfo(orgId);
      const features = billingService.getTierFeatures(subscriptionInfo.tier);

      return reply.send({
        ...subscriptionInfo,
        features,
      });
    },
  });

  // POST /organizations/:orgId/billing/checkout - Create checkout session
  app.post('/organizations/:orgId/billing/checkout', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const validation = CreateCheckoutSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const session = await billingService.createCheckoutSession({
        orgId,
        tier: validation.data.tier,
        successUrl: validation.data.successUrl,
        cancelUrl: validation.data.cancelUrl,
      });

      return reply.send(session);
    },
  });

  // POST /organizations/:orgId/billing/cancel - Cancel subscription
  app.post('/organizations/:orgId/billing/cancel', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };

      await billingService.cancelSubscription(orgId);

      return reply.send({
        message: 'Subscription will be canceled at the end of the billing period',
      });
    },
  });

  // POST /webhooks/stripe - Stripe webhook handler
  app.post('/webhooks/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = request.headers['stripe-signature'] as string;
    if (!signature) {
      throw new BadRequestError('Missing stripe-signature header');
    }

    const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'] || '';
    const payload = JSON.stringify(request.body);

    await billingService.handleWebhook(payload, signature, webhookSecret);

    return reply.send({ received: true });
  });
}
