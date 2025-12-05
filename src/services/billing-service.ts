import Stripe from 'stripe';
import { OrganizationRepository } from '@/repositories/organization-repository';
import { SubscriptionTier } from '@/types';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface CreateCheckoutSessionInput {
  orgId: string;
  tier: SubscriptionTier;
  successUrl: string;
  cancelUrl: string;
}

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  status: string;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
}

const PRICE_IDS: Record<SubscriptionTier, string> = {
  FREE: '',
  PRO: process.env['STRIPE_PRO_PRICE_ID'] || 'price_pro',
  ENTERPRISE: process.env['STRIPE_ENTERPRISE_PRICE_ID'] || 'price_enterprise',
};

const TIER_FEATURES: Record<SubscriptionTier, { apiKeys: number; storage: number }> = {
  FREE: { apiKeys: 1, storage: 100 }, // 100 MB
  PRO: { apiKeys: 5, storage: 1000 }, // 1 GB
  ENTERPRISE: { apiKeys: 25, storage: 10000 }, // 10 GB
};

export class BillingService {
  private stripe: Stripe;
  private orgRepository: OrganizationRepository;

  constructor(orgRepository?: OrganizationRepository) {
    const stripeKey = process.env['STRIPE_SECRET_KEY'] || 'sk_test_placeholder';
    this.stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });
    this.orgRepository = orgRepository || new OrganizationRepository();
  }

  async createCustomer(orgId: string, email: string, name: string): Promise<string> {
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        orgId,
      },
    });

    await this.orgRepository.update(orgId, {
      stripeCustomerId: customer.id,
    });

    logger.info({ orgId, customerId: customer.id }, 'Stripe customer created');

    return customer.id;
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput
  ): Promise<{ sessionId: string; url: string }> {
    const org = await this.orgRepository.findById(input.orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    if (input.tier === 'FREE') {
      throw new BadRequestError('Cannot create checkout for FREE tier');
    }

    const priceId = PRICE_IDS[input.tier];
    if (!priceId) {
      throw new BadRequestError('Invalid subscription tier');
    }

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      // Create customer first
      customerId = await this.createCustomer(input.orgId, '', org.name);
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        orgId: input.orgId,
        tier: input.tier,
      },
    });

    logger.info(
      { orgId: input.orgId, tier: input.tier, sessionId: session.id },
      'Checkout session created'
    );

    return {
      sessionId: session.id,
      url: session.url || '',
    };
  }

  async handleWebhook(
    payload: string,
    signature: string,
    webhookSecret: string
  ): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      logger.error({ error }, 'Webhook signature verification failed');
      throw new BadRequestError('Invalid webhook signature');
    }

    logger.info({ eventType: event.type, eventId: event.id }, 'Processing Stripe webhook');

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionCanceled(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.debug({ eventType: event.type }, 'Unhandled webhook event type');
    }
  }

  async cancelSubscription(orgId: string): Promise<void> {
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    if (!org.stripeSubscriptionId) {
      throw new BadRequestError('No active subscription');
    }

    await this.stripe.subscriptions.update(org.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    logger.info({ orgId }, 'Subscription cancellation scheduled');
  }

  async getSubscriptionInfo(orgId: string): Promise<SubscriptionInfo> {
    const org = await this.orgRepository.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    if (!org.stripeSubscriptionId) {
      return {
        tier: org.subscriptionTier,
        status: 'active',
        cancelAtPeriodEnd: false,
      };
    }

    const subscription = await this.stripe.subscriptions.retrieve(
      org.stripeSubscriptionId
    );

    return {
      tier: org.subscriptionTier,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };
  }

  getTierFeatures(tier: SubscriptionTier): { apiKeys: number; storage: number } {
    return TIER_FEATURES[tier];
  }

  private async handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
    const orgId = session.metadata?.orgId;
    const tier = session.metadata?.tier as SubscriptionTier;

    if (!orgId || !tier) {
      logger.warn({ sessionId: session.id }, 'Checkout session missing metadata');
      return;
    }

    await this.orgRepository.update(orgId, {
      subscriptionTier: tier,
      stripeSubscriptionId: session.subscription as string,
    });

    logger.info({ orgId, tier }, 'Subscription activated');
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
    const customerId = subscription.customer as string;

    // Find org by customer ID
    // In production, you'd have an index for this
    logger.info(
      { customerId, status: subscription.status },
      'Subscription updated'
    );
  }

  private async handleSubscriptionCanceled(subscription: Stripe.Subscription): Promise<void> {
    const customerId = subscription.customer as string;

    logger.info({ customerId }, 'Subscription canceled - downgrade to FREE');
    // In production, find org and downgrade to FREE
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;

    logger.warn({ customerId, invoiceId: invoice.id }, 'Payment failed');
    // In production, send notification and potentially suspend account
  }
}
